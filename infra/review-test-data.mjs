import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import bcrypt from '../server/node_modules/bcryptjs/index.js';
import mongoose from '../server/node_modules/mongoose/index.js';
import {connectDatabase} from '../server/database/index.js';
import Book from '../server/models/Book.js';
import User from '../server/models/User.js';
import Review from '../server/models/Review.js';
import {combinedRating} from '../server/services/book-statistics.js';

const idFor = (batch, key) => crypto.createHash('sha256').update(`review-test-v1:${batch}:${key}`).digest('hex').slice(0,24);

export function validatePlan(input) {
  if (!input || !/^[a-f\d]{24}$/.test(input.bookId) || !/^[a-z0-9-]{8,64}$/.test(input.batch)
    || typeof input.title !== 'string' || typeof input.author !== 'string'
    || !Array.isArray(input.drafts) || input.drafts.length < 1 || input.drafts.length > 50) throw Error('Invalid review test plan');
  const keys=new Set(), names=new Set();
  const rows=input.drafts.map((draft,index)=>{
    if (!draft || typeof draft.id !== 'string' || !/^[a-z0-9-]+$/.test(draft.id) || keys.has(draft.id)
      || typeof draft.displayName !== 'string' || !draft.displayName.trim()
      || !Number.isInteger(draft.rating) || draft.rating<1 || draft.rating>5 || typeof draft.content !== 'string' || !draft.content.trim()) throw Error('Invalid test draft');
    keys.add(draft.id);
    const username=draft.displayName.trim()+'（测试）', content='【测试】'+draft.content.trim();
    if (username.length>40 || names.has(username) || Array.from(content).length>140) throw Error('Duplicate name or oversized test draft');
    names.add(username);
    return {userId:idFor(input.batch,'user:'+draft.id),reviewId:idFor(input.batch,'review:'+draft.id),username,content,rating:draft.rating,
      profileTheme:['apricot','sage','mist','rose'][index%4]};
  });
  return {batch:input.batch,bookId:input.bookId,title:input.title,author:input.author,rows};
}

export async function manageReviewTestData(input,{mode='preview',writeAudit}={}) {
  const plan=validatePlan(input);
  if (!['preview','apply','cleanup','replace'].includes(mode)) throw Error('Invalid mode');
  const previous=mode==='replace'?validatePlan({...input,drafts:input.previousDrafts}):plan;
  if(mode==='replace' && plan.rows.some(row=>!previous.rows.some(old=>old.userId===row.userId && old.username===row.username))) throw Error('Replacement must retain existing test identities');
  const previewBook=await Book.findOne({_id:plan.bookId,deletedAt:null,visibility:{$ne:'private'}}).lean();
  if (!previewBook || previewBook.title!==plan.title || (previewBook.author||'')!==plan.author) throw Error('Book identity changed');
  if (mode==='preview') return {...plan,mode,count:plan.rows.length};
  if (typeof writeAudit!=='function') throw Error('Durable audit is required');
  // No usable credentials are retained or sent. These accounts cannot sign in.
  const password=mode==='apply' ? await bcrypt.hash(crypto.randomBytes(48).toString('base64url'),12) : null;
  let result;
  await mongoose.connection.transaction(async session=>{
    const book=await Book.findOneAndUpdate({_id:plan.bookId,title:plan.title,author:plan.author,deletedAt:null,visibility:{$ne:'private'}},
      {$inc:{milestoneVersion:1}},{new:true,session,timestamps:false});
    if (!book) throw Error('Book changed since preview');
    const users=await User.find({$or:[{_id:{$in:previous.rows.map(row=>row.userId)}},{testBatch:plan.batch}]}).select('_id username isTestAccount created_at +testBatch').session(session).lean();
    const reviews=await Review.find({$or:[{_id:{$in:previous.rows.map(row=>row.reviewId)}},{testBatch:plan.batch}]}).select('+testBatch +likedBy +dislikedBy').session(session).lean();
    const matches=target=>users.length===target.rows.length && reviews.length===target.rows.length && target.rows.every(row=>{
      const user=users.find(user=>String(user._id)===row.userId),review=reviews.find(review=>String(review._id)===row.reviewId);
      return user?.isTestAccount && user.testBatch===plan.batch && user.username===row.username && review?.isTestData && review.testBatch===plan.batch
        && String(review.book)===plan.bookId && String(review.user)===row.userId && review.content===row.content && review.rating===row.rating;
    });
    const alreadyReplaced=mode==='replace' && matches(plan);
    if(mode==='replace' && !alreadyReplaced && !matches(previous))throw Error('Test records changed; preserve data for inspection');
    if (users.length || reviews.length) {
      if(mode!=='replace' && !matches(plan))throw Error('Test records changed; preserve data for inspection');
    }
    const before={rating:book.rating,numRatings:book.numRatings,numReviews:book.numReviews};
    await writeAudit({phase:'prepared',mode,batch:plan.batch,bookId:plan.bookId,before,rows:plan.rows,...(mode==='replace'?{previousReviews:reviews,previousUsers:users}:{})});
    let changed=false;
    if(mode==='apply' && !users.length) {
      for(const row of plan.rows) {
        await User.create([{_id:row.userId,username:row.username,email:`${row.userId}@review-test.invalid`,password,
          role:'reader',isTestAccount:true,testBatch:plan.batch,profileTheme:row.profileTheme}],{session});
        await Review.create([{_id:row.reviewId,book:book._id,user:row.userId,rating:row.rating,content:row.content,isTestData:true,testBatch:plan.batch}],{session});
      }
      changed=true;
    }
    if(mode==='replace' && !alreadyReplaced) {
      const removed=previous.rows.filter(old=>!plan.rows.some(row=>row.userId===old.userId));
      const extra=await Review.countDocuments({user:{$in:removed.map(row=>row.userId)},testBatch:{$ne:plan.batch}}).session(session);
      if(extra)throw Error('Test account has unrelated reviews; preserve it for inspection');
      for(const row of plan.rows)await Review.updateOne({_id:row.reviewId,book:book._id,isTestData:true,testBatch:plan.batch},{$set:{content:row.content,rating:row.rating}},{session,runValidators:true});
      if(removed.length){
        await Review.deleteMany({_id:{$in:removed.map(row=>row.reviewId)},book:book._id,isTestData:true,testBatch:plan.batch},{session});
        await User.deleteMany({_id:{$in:removed.map(row=>row.userId)},isTestAccount:true,testBatch:plan.batch},{session});
      }
      changed=true;
    }
    if(mode==='cleanup' && users.length) {
      const extra=await Review.countDocuments({user:{$in:plan.rows.map(row=>row.userId)},testBatch:{$ne:plan.batch}}).session(session);
      if(extra) throw Error('Test account has unrelated reviews; preserve it for inspection');
      await Review.deleteMany({_id:{$in:plan.rows.map(row=>row.reviewId)},book:book._id,isTestData:true,testBatch:plan.batch},{session});
      await User.deleteMany({_id:{$in:plan.rows.map(row=>row.userId)},isTestAccount:true,testBatch:plan.batch},{session});
      changed=true;
    }
    const [stats]=await Review.aggregate([{$match:{book:book._id,isTestData:{$ne:true}}},{$group:{_id:null,average:{$avg:'$rating'},count:{$sum:1}}}]).session(session);
    const numReviews=await Review.countDocuments({book:book._id,content:/\S/}).session(session);
    const after={rating:combinedRating(book,stats?.average,stats?.count),numRatings:stats?.count||0,numReviews};
    await Book.updateOne({_id:book._id},{$set:after},{session,timestamps:false});
    result={mode,batch:plan.batch,bookId:plan.bookId,count:plan.rows.length,changed,before,after};
  });
  await writeAudit({phase:'completed',...result});
  return result;
}

export async function main(args) {
  const [filename,auditDirectory,flag]=args;
  if(!filename || !auditDirectory || args.length>3 || (flag && !['--apply','--cleanup','--replace'].includes(flag))) throw Error('Usage: node infra/review-test-data.mjs PLAN_JSON AUDIT_DIRECTORY [--apply|--cleanup|--replace]');
  if(flag && process.env.WRITE_MODE!=='readwrite') throw Error('Writable target required');
  const input=JSON.parse(await fs.readFile(filename,'utf8'));
  validatePlan(input);
  await fs.mkdir(auditDirectory,{recursive:true,mode:0o700});
  await connectDatabase();
  const audit=await fs.open(path.join(auditDirectory,input.batch+'.jsonl'),'a',0o600);
  try {
    const result=await manageReviewTestData(input,{mode:flag==='--apply'?'apply':flag==='--cleanup'?'cleanup':flag==='--replace'?'replace':'preview',
      writeAudit:async row=>{await audit.write(JSON.stringify(row)+'\n');await audit.sync();}});
    await fs.writeFile(path.join(auditDirectory,input.batch+'-'+result.mode+'.json'),JSON.stringify(result,null,2),{mode:0o600});
    console.log(JSON.stringify(result.mode==='preview'?{mode:result.mode,batch:result.batch,bookId:result.bookId,count:result.count}:result));
  } finally {await audit.close();await mongoose.disconnect();}
}

if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
