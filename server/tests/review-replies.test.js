import '../../tools/test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import {TestDatabase} from '../database/testing.js';
import {createApp} from '../app.js';
import {readConfig} from '../config.js';
import Book from '../models/Book.js';
import Review from '../models/Review.js';
import ReviewReply from '../models/ReviewReply.js';
import User from '../models/User.js';

test('review replies are authorized, single level, retry safe and cursor paginated',async()=>{
  const db=await TestDatabase.create();
  await mongoose.connect(db.getUri(),{autoIndex:false});
  await ReviewReply.createIndexes();
  const config=readConfig({APP_ENV:'test',DATABASE_URL:db.getUri(),JWT_SECRET:crypto.randomBytes(48).toString('hex')});
  const server=createApp(config).listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`,jar=new Map();
  async function request(path,method='GET',body,headers={}) {
    const r=await fetch(base+path,{method,headers:{cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; '),'content-type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
    for(const c of r.headers.getSetCookie()){const [k,...v]=c.split(';')[0].split('=');jar.set(k,v.join('='));}
    return {status:r.status,data:await r.json(),headers:r.headers};
  }
  async function write(path,body){const csrf=await request('/api/auth/csrf');return request(path,'POST',body,{origin:'http://127.0.0.1:3000','x-csrf-token':csrf.data.csrfToken});}
  try {
    const user=await User.create({username:'回复书友',email:'reply@example.test',password:await bcrypt.hash('Local-test-12345',10)});
    const [book,otherBook]=await Book.create([{title:'回复测试',author_id:user._id},{title:'另一本书',author_id:user._id}]);
    const review=await Review.create({book:book._id,user:user._id,rating:4,content:'一本值得分享的书'});
    const endpoint=`/api/books/${book.id}/reviews/${review.id}/replies`;
    const body={content:'我也喜欢这本书 😊',requestId:crypto.randomUUID()};
    assert.equal((await request(endpoint,'POST',body)).status,403);
    assert.equal((await write(endpoint,body)).status,401);
    assert.equal((await write('/api/auth/signin',{email:user.email,password:'Local-test-12345'})).status,200);
    for(const data of [{...body,user:user.id},{...body,replyTo:user.id},{...body,content:' '},{...body,content:'字'.repeat(1001)},{...body,requestId:'x'}])assert.equal((await write(endpoint,data)).status,400);
    assert.equal((await write(endpoint.replace(book.id,otherBook.id),body)).status,404);
    const saved=await write(endpoint,body);assert.equal(saved.status,201);assert.equal(saved.data.total,1);
    assert.equal(saved.data.reply.user.username,user.username);assert(!('email' in saved.data.reply.user));assert(Number.isFinite(Date.parse(saved.data.reply.createdAt)));
    const repeated=await write(endpoint,body);assert.deepEqual(repeated.data,saved.data);
    assert.equal((await write(endpoint,{...body,content:'改过的文字'})).status,409);
    assert.equal((await write(endpoint.replace(review.id,saved.data.reply._id),{...body,requestId:crypto.randomUUID()})).status,404);
    await ReviewReply.insertMany(Array.from({length:13},(_,i)=>({book:book._id,review:review._id,user:user._id,content:`后续回复 ${i}`,createdAt:new Date(Date.now()+1000)})));
    const first=await request(endpoint);assert.equal(first.data.items.length,10);assert.equal(first.data.total,14);assert(first.data.cursor);
    const second=await request(endpoint+'?cursor='+first.data.cursor);assert.equal(second.data.items.length,4);assert.equal(second.data.cursor,null);
    assert.equal(new Set([...first.data.items,...second.data.items].map(row=>row._id)).size,14);
    assert.equal((await request(endpoint+'?cursor=invalid')).status,400);
    const previews=await request(`/api/books/${book.id}/reviews?limit=10`);assert.equal(previews.data[0].replyCount,14);assert(previews.data[0].replyPreview.content.startsWith('后续回复'));
    assert.equal(previews.data[0].replyPreview.user._id,user.id);
    assert.equal(previews.data[0].replyPreview.user.username,user.username);
    const matchingReply=[...first.data.items,...second.data.items].find(row=>row._id===previews.data[0].replyPreview._id);
    assert.deepEqual(previews.data[0].replyPreview.user,matchingReply.user,'Preview and full thread must resolve the same author');
    assert(!('likedBy' in previews.data[0]));
    const formerUser=await User.create({username:'已离开的书友',email:'former@example.test',password:await bcrypt.hash('Local-test-12345',10)});
    const formerReply=await ReviewReply.create({book:book._id,review:review._id,user:formerUser._id,content:'保留的回复',createdAt:new Date(Date.now()+2000)});
    await User.deleteOne({_id:formerUser._id});
    const afterDeletion=await request(`/api/books/${book.id}/reviews?limit=10`);
    assert.equal(afterDeletion.data[0].replyPreview._id,formerReply.id);
    assert.deepEqual(afterDeletion.data[0].replyPreview.user,{_id:'',username:'已注销用户',isDeleted:true});
    const tail=await request(endpoint+'?cursor='+first.data.cursor);
    assert.deepEqual(tail.data.items.find(row=>row._id===formerReply.id).user,afterDeletion.data[0].replyPreview.user);
    await Review.updateOne({_id:review._id},{$set:{user:formerUser._id}});
    const deletedReviewAuthor=await request(`/api/books/${book.id}/reviews?limit=10`);
    assert.equal(deletedReviewAuthor.data[0].user.isDeleted,true);
    await Book.updateOne({_id:book._id},{$set:{deletedAt:new Date()}});
    assert.equal((await request(endpoint)).status,404);assert.equal((await write(endpoint,{...body,requestId:crypto.randomUUID()})).status,404);
  }finally{await new Promise(resolve=>server.close(resolve));await mongoose.disconnect();await db.stop();}
});
