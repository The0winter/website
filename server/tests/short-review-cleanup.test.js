import '../../tools/test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {TestDatabase} from '../database/testing.js';
import Book from '../models/Book.js';
import User from '../models/User.js';
import Review from '../models/Review.js';
import {shortReviewFingerprint,applyShortReviewCleanup} from '../services/short-review-cleanup.js';

test('local short-review conversion rejects stale content, retains ratings, votes, author and timestamps, and retries safely',async()=>{
 const db=await TestDatabase.create();await mongoose.connect(db.getUri(),{autoIndex:false});
 try{
  for(const model of Object.values(mongoose.models))await model.createIndexes();
  const user=await User.create({username:'短评整理人',email:'script-cleanup@example.test',password:'not-a-login-hash',role:'admin'});
  const book=await Book.create({title:'合成书',author:'合成作者'});
  const row=await Review.create({book:book._id,user:user._id,rating:4,content:'這是書評。',likedBy:[user._id],sourceExcerpt:{platform:'合成',author:'原作者',url:'https://example.test/review'}});
  const before=await Review.findById(row._id).select('+likedBy +dislikedBy').lean();
  const plan={version:1,batch:'simplify-test',changes:[{id:String(row._id),bookId:String(book._id),expected:shortReviewFingerprint(before),content:'这是书评。',reason:'本地字形转换'}]};
  assert.equal((await applyShortReviewCleanup(plan)).pending,1);
  await Review.updateOne({_id:row._id},{$set:{content:'读者的新版本'}},{timestamps:false});
  await assert.rejects(applyShortReviewCleanup(plan,{apply:true,writeAudit:async()=>{throw Error('No backup for a stale plan');}}),/已变化/);
  await Review.updateOne({_id:row._id},{$set:{content:before.content}},{timestamps:false});
  let audit;assert.equal((await applyShortReviewCleanup(plan,{apply:true,writeAudit:async data=>{audit=data;}})).verified,1);
  const after=await Review.findById(row._id).select('+likedBy +dislikedBy').lean();
  assert.deepEqual({...after,content:before.content},before);assert.equal(audit.rows[0].before.content,'這是書評。');
  assert.equal((await applyShortReviewCleanup(plan,{apply:true,writeAudit:async()=>{}})).changed,0);
  await Book.updateOne({_id:book._id},{$set:{visibility:'private'}});await assert.rejects(applyShortReviewCleanup(plan),/公开状态/);
 }finally{await mongoose.disconnect();await db.stop();}
});
