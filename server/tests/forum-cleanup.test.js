import '../../tools/test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import {TestDatabase} from '../database/testing.js';
import {createApp} from '../app.js';
import {readConfig} from '../config.js';
import Book from '../models/Book.js';
import User from '../models/User.js';
import Post from '../models/ForumPost.js';
import Reply from '../models/ForumReply.js';
import {applyReviewCleanup,reviewFingerprint} from '../services/forum-cleanup.js';

test('local-edition upload detects conflicts, preserves interactions and links, filters withdrawn/duplicate answers, labels guides, and retries safely',async()=>{
 const db=await TestDatabase.create();
 const config=readConfig({APP_ENV:'test',DATABASE_URL:db.getUri(),JWT_SECRET:crypto.randomBytes(48).toString('hex')});
 await mongoose.connect(config.uri,{autoIndex:false});
 for(const model of Object.values(mongoose.models))await model.createIndexes();
 const server=createApp(config).listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const get=async path=>{const r=await fetch(base+path);assert.equal(r.status,200);return r.json();};
 try{
  const admin=await User.create({username:'清理整理人',email:'cleanup@example.test',password:'not-a-login-hash',role:'admin'});
  const book=await Book.create({title:'核验书籍',author:'合成作者'});
  const post=await Post.create({title:'如何评价核验书籍？',content:'<p>讨论。</p>',type:'question',bookId:book._id,author:admin._id,replyCount:4});
  const originals=await Reply.create(Array.from({length:4},(_,i)=>({postId:post._id,author:admin._id,title:'原题'+i,content:'<p>合成原文'+i+'</p>',source:{author:'原作者'+i,title:'原题'+i,url:'https://example.test/review/'+i},likes:3,comments:2,likedBy:[admin._id]})));
  const before=await Reply.find({postId:post._id}).lean();
  const plan={version:1,batch:'cleanup-test',changes:before.map((r,i)=>({id:String(r._id),bookId:String(book._id),postId:String(post._id),expected:reviewFingerprint(r),content:i===2?r.content:i===3?'<p>整理者的导读。</p>':'<p>相同的完整正文。</p>',source:{...r.source,kind:i===3?'guide':'original'},curation:{status:i===1?'duplicate':i===2?'withheld':'active',version:'cleanup-test',...(i===1?{duplicateOf:String(before[0]._id)}:{})},reason:'已核验的本地清理'}))};
  assert.equal((await applyReviewCleanup(plan)).pending,4);
  await Reply.updateOne({_id:before[3]._id},{$set:{content:'<p>用户刚刚改动。</p>'}});
  await assert.rejects(applyReviewCleanup(plan,{apply:true,writeAudit:async()=>{throw Error('Must not write an audit on stale plan');}}),/线上书评已变化/);
  assert.equal((await Reply.findById(before[0]._id)).content,before[0].content);
  await Reply.updateOne({_id:before[3]._id},{$set:{content:before[3].content}},{timestamps:false});
  let backup;
  const result=await applyReviewCleanup(plan,{apply:true,writeAudit:async data=>{backup=data;}});
  assert.equal(result.verified,4);assert.equal(backup.rows.length,4);
  const saved=await Reply.find({postId:post._id}).lean();
  for(const row of saved){assert.equal(row.likes,3);assert.equal(row.comments,2);assert.deepEqual(row.likedBy.map(String),[String(admin._id)]);}
  assert.equal((await Post.findById(post._id)).replyCount,2);
  const normal=await get('/api/forum/posts/'+post._id+'/replies');assert.equal(normal.length,2);
  assert.equal(normal.find(r=>r.source.kind==='guide').author.name,'拾页整理');
  const hidden=await get('/api/forum/posts/'+post._id+'/replies?target='+before[2]._id);assert.equal(hidden.length,1);assert.match(hidden[0].content,/暂不展示/);assert.ok(!hidden[0].content.includes('合成原文'));
  const duplicate=await get('/api/forum/posts/'+post._id+'/replies?target='+before[1]._id);assert.equal(duplicate.length,1);assert.equal(duplicate[0].votes,3);
  assert.equal(hidden[0].archived,true);assert.equal(duplicate[0].archived,true);assert.ok(normal.every(row=>!row.archived));
  const reading=await get('/api/forum/posts/'+post._id+'/reading?answer='+before[1]._id);assert.equal(reading.answer.archived,true);assert.equal(reading.post.comments,2);
  const feed=await get('/api/books/'+book._id+'/discussions');assert.equal(feed.total,2);assert.equal(feed.items.length,2);
  assert.equal((await applyReviewCleanup(plan,{apply:true,writeAudit:async()=>{}})).changed,0);
  await Book.updateOne({_id:book._id},{$set:{visibility:'private'}});
  await assert.rejects(applyReviewCleanup(plan),/归属已变化/);
 }finally{await new Promise(resolve=>server.close(resolve));await mongoose.disconnect();await db.stop();}
});
