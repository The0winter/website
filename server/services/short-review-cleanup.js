import mongoose from 'mongoose';
import Review from '../models/Review.js';
import Book from '../models/Book.js';
import User from '../models/User.js';
import AdminLog from '../models/AdminLog.js';
import {reviewDigest} from './forum-cleanup.js';

export const shortReviewFingerprint = row => reviewDigest(JSON.stringify({book:String(row.book),rating:row.rating,content:row.content||''}));
const validId = value => /^[a-f\d]{24}$/.test(value||'');

// Upload a locally prepared character-conversion edition. Ratings, author
// identities, source attribution, votes and timestamps are never rewritten.
export async function applyShortReviewCleanup(plan,{apply=false,writeAudit,admin,batchSize=40}={}) {
  if(plan?.version!==1||!/^[a-z\d-]{1,80}$/.test(plan.batch||'')||!Array.isArray(plan.changes)||!plan.changes.length||plan.changes.length>3000)throw Error('短评整理清单无效');
  const ids=new Set();
  for(const row of plan.changes){
    if(!validId(row.id)||!validId(row.bookId)||ids.has(row.id)||!/^[a-f\d]{64}$/.test(row.expected||'')||typeof row.content!=='string'||!row.content.trim()||Array.from(row.content).length>140||!row.reason)throw Error('短评身份或正文无效');
    ids.add(row.id);
  }
  const admins=await User.find({role:'admin',isBanned:{$ne:true},isTestAccount:{$ne:true},...(admin?{username:admin}:{})}).select('_id').limit(2).lean();
  if(admins.length!==1)throw Error('需指定唯一现有管理员');
  async function inspect(changes,session){
    const stored=await Review.find({_id:{$in:changes.map(r=>r.id)}}).select('+likedBy +dislikedBy').session(session).lean();
    const books=await Book.find({_id:{$in:[...new Set(changes.map(r=>r.bookId))]},deletedAt:null,visibility:{$ne:'private'}}).select('_id').session(session).lean();
    const active=[];
    for(const change of changes){
      const before=stored.find(r=>String(r._id)===change.id);
      if(!before||String(before.book)!==change.bookId||!books.some(r=>String(r._id)===change.bookId))throw Error('短评归属或公开状态已变化：'+change.id);
      if(shortReviewFingerprint(before)===shortReviewFingerprint({...before,content:change.content}))continue;
      if(shortReviewFingerprint(before)!==change.expected)throw Error('短评正文或评分已变化：'+change.id);
      active.push({change,before});
    }
    return active;
  }
  const pending=[];
  for(let start=0;start<plan.changes.length;start+=100)pending.push(...await inspect(plan.changes.slice(start,start+100),null));
  const alreadyApplied=plan.changes.length-pending.length;
  if(!apply)return {batch:plan.batch,pending:pending.length,alreadyApplied};
  if(typeof writeAudit!=='function')throw Error('应用前必须提供原文审计备份');
  await writeAudit({version:1,batch:plan.batch,type:'short-reviews',createdAt:new Date().toISOString(),rows:pending.map(({change,before})=>({id:change.id,before,after:{content:change.content}}))});
  for(let start=0;start<pending.length;start+=batchSize){
    const batch=pending.slice(start,start+batchSize).map(r=>r.change);
    await mongoose.connection.transaction(async session=>{
      const active=await inspect(batch,session);
      for(const {change,before}of active){
        const result=await Review.updateOne({_id:before._id,book:before.book,content:before.content,rating:before.rating},{$set:{content:change.content}},{session,runValidators:true,timestamps:false});
        if(result.matchedCount!==1)throw Error('短评发生并发修改：'+change.id);
      }
      if(active.length)await AdminLog.create([{admin_id:admins[0]._id,action:'simplify_short_reviews',details:JSON.stringify({batch:plan.batch,ids:active.map(r=>r.change.id)})}],{session});
    });
  }
  let verified=0;
  for(let start=0;start<plan.changes.length;start+=100){
    const batch=plan.changes.slice(start,start+100),stored=await Review.find({_id:{$in:batch.map(r=>r.id)}}).lean();
    for(const change of batch){if(stored.find(r=>String(r._id)===change.id)?.content!==change.content)throw Error('短评写入后核验失败：'+change.id);verified++;}
  }
  return {batch:plan.batch,changed:pending.length,alreadyApplied,verified};
}
