import '../../tools/test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import {TestDatabase} from '../database/testing.js';
import {createApp} from '../app.js';
import {readConfig} from '../config.js';
import Book from '../models/Book.js';
import Review from '../models/Review.js';

test('review cursors retain order across tied timestamps and new comments',async()=>{
  const db=await TestDatabase.create();
  const config=readConfig({APP_ENV:'test',DATABASE_URL:db.getUri(),JWT_SECRET:crypto.randomBytes(48).toString('hex')});
  await mongoose.connect(config.uri,{autoIndex:false});
  const server=createApp(config).listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    const book=await Book.create({title:'评论游标测试',author_id:new mongoose.Types.ObjectId()});
    const ids=Array.from({length:26},(_,i)=>(i+1).toString(16).padStart(24,'0'));
    for(const id of ids)await Review.create({_id:id,book:book._id,user:new mongoose.Types.ObjectId(),rating:4,content:id,createdAt:new Date('2026-09-01T10:00:00Z')});
    const first=await fetch(`${base}/api/books/${book.id}/reviews?limit=2`);
    const seen=(await first.json()).map(row=>row._id);assert.equal(seen.length,2);
    let cursor=first.headers.get('x-next-cursor');assert(cursor);
    await Review.create({book:book._id,user:new mongoose.Types.ObjectId(),rating:5,content:'后来新增的评论'});
    const queries=[];
    while(cursor){
      const response=await fetch(`${base}/api/books/${book.id}/reviews?limit=5&cursor=${cursor}`);
      assert.equal(response.status,200);const rows=await response.json();assert(rows.length<=5);
      seen.push(...rows.map(row=>row._id));queries.push(rows.length);cursor=response.headers.get('x-next-cursor');
    }
    assert.deepEqual(seen,ids);assert.equal(new Set(seen).size,26);assert.deepEqual(queries,[5,5,5,5,4]);
    const foreign=Buffer.from(JSON.stringify({book:String(new mongoose.Types.ObjectId()),time:'2026-09-01',id:ids[0]})).toString('base64url');
    for(const bad of ['invalid',foreign])assert.equal((await fetch(`${base}/api/books/${book.id}/reviews?cursor=${bad}`)).status,400);
    const page=await fetch(`${base}/api/books/${book.id}/reviews?page=2&limit=20`);
    assert.equal((await page.json()).length,7);
  }finally{await new Promise(resolve=>server.close(resolve));await mongoose.disconnect();await db.stop();}
});
