import '../../tools/test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import {TestDatabase} from '../database/testing.js';
import {createApp} from '../app.js';
import {readConfig} from '../config.js';
import User from '../models/User.js';
import Book from '../models/Book.js';
import Chapter from '../models/Chapter.js';
import Bookmark from '../models/Bookmark.js';
import {milestoneNumber, milestoneThresholds} from '../../shared/book-milestones.mjs';

test('milestones: real thresholds, transactional first attainment, deduplication, history and access', async () => {
  const database = await TestDatabase.create();
  const config = readConfig({APP_ENV:'test', DATABASE_URL:database.getUri(), JWT_SECRET:crypto.randomBytes(48).toString('hex')});
  await mongoose.connect(config.uri, {autoIndex:false});
  for (const model of Object.values(mongoose.models)) await model.createIndexes();
  const server = createApp(config).listen(0,'127.0.0.1');
  await new Promise(resolve => server.once('listening',resolve));
  const base = `http://127.0.0.1:${server.address().port}`, jar = new Map();
  async function request(path, method='GET', body) {
    const headers = {};
    if (method !== 'GET') {const csrf = await request('/api/auth/csrf'); headers['x-csrf-token']=csrf.data.csrfToken; headers.origin='http://127.0.0.1:3000';}
    headers.cookie=[...jar].map(([k,v])=>`${k}=${v}`).join('; ');
    if(body)headers['content-type']='application/json';
    const response=await fetch(base+path,{method,headers,body:body?JSON.stringify(body):undefined});
    for(const cookie of response.headers.getSetCookie()){const [k,...v]=cookie.split(';')[0].split('=');jar.set(k,v.join('='));}
    return {status:response.status,data:await response.json()};
  }
  try {
    assert.equal(milestoneNumber(300),'三百'); assert.equal(milestoneNumber(10000),'一万'); assert.equal(milestoneNumber(200000),'二十万'); assert.equal(milestoneNumber(100000000),'一亿');
    assert.deepEqual(milestoneThresholds.favorites.slice(0,6),[300,500,1000,3000,5000,10000]);
    const user=await User.create({username:'milestone-reader',email:'milestones@example.test',password:await bcrypt.hash('Test-password-123',10)});
    const book=await Book.create({title:'Milestone boundaries',views:9999});
    const chapter=await Chapter.create({bookId:book._id,title:'First chapter',chapter_number:1,content:'Milestone testing content'});
    const root=`/api/books/${book._id}`, shelf=`/api/users/${user._id}/bookmarks`;
    await Bookmark.insertMany(Array.from({length:299},()=>({bookId:book._id,user_id:new mongoose.Types.ObjectId()})));
    let result=await request(root+'/milestones');
    assert.equal(result.status,200); assert.deepEqual(result.data.counts,{favorites:299,views:9999}); assert.equal(result.data.events.length,0);
    assert.deepEqual(result.data.next,{favorites:300,views:10000});
    assert.equal((await request('/api/auth/signin','POST',{email:user.email,password:'Test-password-123'})).status,200);
    const start=Date.now();
    const adds=await Promise.all(Array.from({length:3},()=>request(shelf,'POST',{bookId:String(book._id)})));
    assert.ok(adds.every(result=>result.status===200),JSON.stringify(adds));
    result=await request(root+'/milestones');
    assert.equal(result.data.counts.favorites,300); assert.equal(result.data.events.length,1);
    const favoriteDate=result.data.events[0].achievedAt; assert.ok(+new Date(favoriteDate)>=start);
    assert.equal(result.data.next.favorites,500);
    const read=await request(root+'/views','POST',{chapterId:String(chapter._id)}); assert.equal(read.data.counted,true);
    assert.equal((await request(root+'/views','POST',{chapterId:String(chapter._id)})).data.counted,false);
    result=await request(root+'/milestones'); assert.equal(result.data.counts.views,10000); assert.equal(result.data.events.length,2);
    assert.equal(result.data.events[0].kind,'views'); assert.ok(result.data.events.every(event=>event.achievedAt));
    await request(shelf+'/'+book._id,'DELETE');
    result=await request(root+'/milestones'); assert.equal(result.data.counts.favorites,299); assert.equal(result.data.events.length,2);
    await request(shelf,'POST',{bookId:String(book._id)});
    result=await request(root+'/milestones'); assert.equal(result.data.events.length,2); assert.equal(result.data.events.find(event=>event.kind==='favorites').achievedAt,favoriteDate);
    // A legacy count has no reliable date. Snapshot it before removing anything.
    const legacy=await Book.create({title:'Legacy',views:50000});
    await Bookmark.insertMany(Array.from({length:300},(_,i)=>({bookId:legacy._id,user_id:i?new mongoose.Types.ObjectId():user._id})));
    result=await request(`/api/books/${legacy._id}/milestones`); assert.equal(result.data.events.length,3); assert.ok(result.data.events.every(event=>event.achievedAt===null));
    await request(shelf+'/'+legacy._id,'DELETE');
    result=await request(`/api/books/${legacy._id}/milestones`); assert.equal(result.data.events.length,3); assert.equal(result.data.counts.favorites,299);
    const privateBook=await Book.create({title:'Private',visibility:'private',author_id:new mongoose.Types.ObjectId(),views:100000});
    assert.equal((await request(`/api/books/${privateBook._id}/milestones`)).status,404);
    await Book.updateOne({_id:book._id},{$set:{deletedAt:new Date()}});
    assert.equal((await request(root+'/milestones')).status,404);
    assert.equal((await request('/api/books/not-an-id/milestones')).status,400);
    // A failed transaction must not leave a phantom achievement.
    const before=await Book.findById(legacy._id).lean();
    await assert.rejects(mongoose.connection.transaction(async session=>{await Book.updateOne({_id:legacy._id},{$set:{views:1000000,milestoneHistory:[]}},{session});throw Error('rollback');}));
    const after=await Book.findById(legacy._id).lean(); assert.deepEqual(after.milestoneHistory,before.milestoneHistory); assert.equal(after.views,before.views);
  } finally {await new Promise(resolve=>server.close(resolve));await mongoose.disconnect();await database.stop();}
});
