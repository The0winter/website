import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createApp } from '../app.js';
import { readConfig } from '../config.js';
import User from '../models/User.js';
import Book from '../models/Book.js';
import Chapter from '../models/Chapter.js';
import VerificationCode from '../models/VerificationCode.js';
import { capturedMail } from '../utils/sendEmail.js';
import { safeHtml } from '../security.js';
import { dayKey } from '../services/content.js';
import sharp from 'sharp';
import Media from '../models/Media.js';
import { updateStatistics } from '../jobs/statistics.js';
import Job from '../models/Job.js';
import ForumPost from '../models/ForumPost.js';
import ForumReply from '../models/ForumReply.js';
import ForumComment from '../models/ForumReplyComment.js';
import UserDaily from '../models/UserDaily.js';

test('real MongoDB: CSRF, ownership, revocation and signup',async t => {
  const repl = await MongoMemoryReplSet.create({binary:{version:'7.0.40'},replSet:{count:1,storageEngine:'wiredTiger'}});
  const config = readConfig({APP_ENV:'test',MONGO_URI:repl.getUri('test1_test'),JWT_SECRET:crypto.randomBytes(48).toString('hex')});
  await mongoose.connect(config.uri,{autoIndex:false,serverSelectionTimeoutMS:5000});
  for (const model of Object.values(mongoose.models)) await model.createIndexes();
  const server=createApp(config).listen(0,'127.0.0.1');
  await new Promise(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  function client() {
    const jar = new Map();
    async function request(path,method='GET',body,extra={}) {
      const headers = {cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; '),...extra};
      if(body !== undefined) headers['content-type']='application/json';
      const response=await fetch(base+path,{method,headers,body:body === undefined?undefined:JSON.stringify(body)});
      for(const c of response.headers.getSetCookie()){const [k,...v]=c.split(';')[0].split('=');jar.set(k,v.join('='));}
      return {status:response.status,data:await response.json(),headers:response.headers};
    }
    async function write(path,method,body){const csrf=await request('/api/auth/csrf');return request(path,method,body,{'origin':'http://127.0.0.1:3000','x-csrf-token':csrf.data.csrfToken});}
    return {request,write,jar};
  }
  try {
    const hash=await bcrypt.hash('Test-password-123',10);
    const [a,b,admin]=await User.create([{username:'owner',email:'owner@example.test',password:hash},{username:'other',email:'other@example.test',password:hash},{username:'admin',email:'admin@example.test',password:hash,role:'admin'}]);
    const book=await Book.create({title:'Controlled book',author_id:a._id});
    const chapter=await Chapter.create({bookId:book._id,title:'One',content:'Controlled content',chapter_number:1});
    const owner=client(),other=client(),administrator=client(),guest=client();
    await t.test('anonymous write and cross-origin login rejected',async()=>{
      assert.equal((await guest.request('/api/books/'+book._id,'PATCH',{title:'attack'})).status,403);
      assert.equal((await guest.write('/api/books/'+book._id,'PATCH',{title:'attack'})).status,401);
      assert.equal((await guest.request('/api/auth/signin','POST',{email:a.email,password:'Test-password-123'},{origin:'https://attacker.test'})).status,403);
    });
    for(const [c,u] of [[owner,a],[other,b],[administrator,admin]]) assert.equal((await c.write('/api/auth/signin','POST',{email:u.email,password:'Test-password-123'})).status,200);
    await t.test('other users cannot change books, chapters or shelves; fields cannot elevate',async()=>{
      for(const [path,method,body] of [[`/api/books/${book._id}`,'PATCH',{title:'attack'}],[`/api/books/${book._id}`,'DELETE',{}],[`/api/chapters/${chapter._id}`,'PATCH',{content:'attack'}],[`/api/chapters/${chapter._id}`,'DELETE',{}],['/api/chapters','POST',{bookId:String(book._id),title:'attack',content:'attack',chapter_number:2}],[`/api/users/${a._id}/bookmarks`,'POST',{bookId:String(book._id)}]]) assert.equal((await other.write(path,method,body)).status,403,path);
      assert.equal((await other.request(`/api/users/${a._id}/bookmarks`)).status,403);
      assert.equal((await owner.write(`/api/books/${book._id}`,'PATCH',{author_id:String(b._id),views:999})).status,400);
      assert.equal((await Book.findById(book._id)).title,'Controlled book');
      assert.equal((await Chapter.findById(chapter._id)).content,'Controlled content');
      assert.equal(await Chapter.countDocuments(),1);
      assert.equal((await owner.write(`/api/books/${book._id}`,'PATCH',{title:'Edited'})).status,200);
    });
    await t.test('media validates bytes, ownership and active references',async()=>{
      async function upload(bytes,type){
        const csrf=await owner.request('/api/auth/csrf');const form=new FormData();form.append('file',new Blob([bytes],{type}),'cover.png');
        const response=await fetch(base+'/api/upload/cover',{method:'POST',headers:{cookie:[...owner.jar].map(([k,v])=>`${k}=${v}`).join('; '),origin:'http://127.0.0.1:3000','x-csrf-token':csrf.data.csrfToken},body:form});
        return {status:response.status,data:await response.json()};
      }
      assert.equal((await upload(Buffer.from('<svg onload="alert(1)"></svg>'),'image/png')).status,400);
      const bytes=await sharp({create:{width:4,height:4,channels:3,background:'#4488ff'}}).png().toBuffer();
      const image=await upload(bytes,'image/png');assert.equal(image.status,201);
      assert.equal((await other.write('/api/upload/cover','DELETE',{url:image.data.url})).status,403);
      assert.equal((await owner.write(`/api/users/${a._id}`,'PATCH',{avatar:image.data.url})).status,200);
      assert.equal((await owner.write('/api/upload/cover','DELETE',{url:image.data.url})).status,409);
      assert.equal((await owner.write(`/api/users/${a._id}`,'PATCH',{avatar:''})).status,200);
      assert.equal((await owner.write('/api/upload/cover','DELETE',{url:image.data.url})).status,200);
      assert.equal((await Media.findById(image.data.url.split('/').pop())).deleted,true);
      assert.equal((await owner.write('/api/upload/cover','DELETE',{url:'https://res.cloudinary.com/old/image/upload/a.jpg'})).status,403);
    });
    await t.test('login failures accumulate and expired lock resets',async()=>{
      const bad=client();
      for(let i=0;i<5;i++)assert.equal((await bad.write('/api/auth/signin','POST',{email:b.email,password:'Wrong-password'})).status,401);
      assert.equal((await User.findById(b._id)).loginAttempts,5);
      assert.equal((await bad.write('/api/auth/signin','POST',{email:b.email,password:'Test-password-123'})).status,403);
      await User.updateOne({_id:b._id},{$set:{lockUntil:Date.now()-1}});
      assert.equal((await bad.write('/api/auth/signin','POST',{email:b.email,password:'Test-password-123'})).status,200);
      assert.equal((await User.findById(b._id)).loginAttempts,0);
    });
    await t.test('concurrent chapter retry, quota rollback, ratings and soft delete',async()=>{
      const newChapter={bookId:String(book._id),title:'Two',content:'same content',chapter_number:2};
      const replies=await Promise.all(Array.from({length:8},()=>owner.write('/api/chapters','POST',newChapter)));
      assert.ok(replies.every(r=>r.status===201),JSON.stringify(replies.map(r=>r.data)));
      assert.equal(await Chapter.countDocuments({bookId:book._id,chapter_number:2}),1);
      assert.equal((await owner.write('/api/chapters','POST',{...newChapter,content:'different'})).status,409);
      await User.updateOne({_id:a._id},{$set:{uploadDay:dayKey(),daily_upload_words:99990}});
      const quota=await Promise.all([3,4].map(n=>owner.write('/api/chapters','POST',{...newChapter,title:'quota',chapter_number:n,content:'1234567890'})));
      assert.deepEqual(quota.map(r=>r.status).sort(),[201,429]);
      assert.equal((await User.findById(a._id)).daily_upload_words,100000);
      assert.equal(await Chapter.countDocuments({bookId:book._id}),3);
      const ratings=await Promise.all([[owner,5],[other,1]].map(([c,rating])=>c.write(`/api/books/${book._id}/reviews`,'POST',{rating,content:'Controlled review'})));
      assert.ok(ratings.every(r=>r.status===201),JSON.stringify(ratings));
      const summary=await Book.findById(book._id);assert.equal(summary.rating,3);assert.equal(summary.numReviews,2);
      assert.equal((await owner.write(`/api/books/${book._id}/reviews`,'POST',{rating:2.5,content:'invalid'})).status,400);
      assert.equal((await owner.write(`/api/books/${book._id}`,'DELETE',{})).status,200);
      assert.equal((await owner.request(`/api/chapters/${chapter._id}`)).status,404);
      assert.equal(await Chapter.countDocuments({bookId:book._id}),3);
      assert.equal((await administrator.write(`/api/books/${book._id}/restore`,'POST',{})).status,200);
      assert.equal((await owner.request(`/api/chapters/${chapter._id}`)).status,200);
    });
    await t.test('reading GET stays read-only; account dedupe survives visitor changes and concurrent reports',async()=>{
      const before=(await Book.findById(book._id)).views;
      for(let i=0;i<3;i++)assert.equal((await guest.request(`/api/chapters/${chapter._id}`)).status,200);
      assert.equal((await Book.findById(book._id)).views,before);
      const reports=await Promise.all(Array.from({length:4},()=>owner.write(`/api/books/${book._id}/views`,'POST',{chapterId:String(chapter._id)})));
      assert.ok(reports.every(r=>r.status===200),JSON.stringify(reports));
      assert.equal(reports.filter(r=>r.data.counted).length,1);
      owner.jar.delete('visitor');
      assert.equal((await owner.write(`/api/books/${book._id}/views`,'POST',{chapterId:String(chapter._id)})).data.counted,false);
      assert.equal((await other.write(`/api/books/${book._id}/views`,'POST',{chapterId:String(chapter._id)})).data.counted,true);
      assert.equal((await Book.findById(book._id)).views,before+2);
      assert.equal((await guest.request('/api/books?author_id=invalid')).status,400);
    });
    await t.test('statistics single worker, natural calendar totals and preserved cumulative count',async()=>{
      const before=await Book.findById(book._id);
      const now=new Date(),day=dayKey(now);
      const results=await Promise.all([updateStatistics(now),updateStatistics(now)]);
      assert.equal(results.filter(r=>r.claimed).length,1);
      const updated=await Book.findById(book._id);
      assert.equal(updated.views,before.views);
      assert.equal(updated.daily_views,2);
      assert.equal(updated.weekly_views,2);
      assert.equal(updated.monthly_views,2);
      assert.equal((await updateStatistics(now)).claimed,false);
      assert.equal((await Job.findById('statistics')).status,'done');
      const activity=await UserDaily.findOne({userId:a._id,day});
      assert.equal(activity.views,1);assert.equal(activity.uploads,2);
      const accountStats=await User.findById(a._id);assert.equal(accountStats.stats.today_views,1);assert.equal(accountStats.weekly_score,101);
      const daily=await mongoose.connection.collection('readdailies').findOne({_id:`${book._id}:${day}`});
      assert.ok(daily.expiresAt > new Date(Date.now()+60*86400000));
      // A later month must clear period counters without clearing lifetime views.
      const nextMonth=new Date(day.slice(0,7)+'-01T12:00:00Z');nextMonth.setUTCMonth(nextMonth.getUTCMonth()+2);
      assert.equal((await updateStatistics(nextMonth)).claimed,true);
      const cleared=await Book.findById(book._id);
      assert.equal(cleared.monthly_views,0);assert.equal(cleared.weekly_views,0);assert.equal(cleared.daily_views,0);
      assert.equal(cleared.views,before.views);
      assert.deepEqual(cleared.statisticsLegacy,updated.statisticsLegacy);
      const clearedAccount=await User.findById(a._id);assert.equal(clearedAccount.weekly_score,0);assert.equal(clearedAccount.stats.today_uploads,0);assert.deepEqual(clearedAccount.statisticsLegacy,accountStats.statisticsLegacy);
    });
    await t.test('forum concurrent writes preserve counters, hierarchy and current cookie liked state',async()=>{
      assert.equal((await guest.write('/api/forum/posts','POST',{title:'问题？',content:'测试'})).status,401);
      assert.equal((await owner.write('/api/forum/posts','POST',{title:'问题？',content:'测试',author:String(b._id)})).status,400);
      const posts=await Promise.all([1,2].map(()=>owner.write('/api/forum/posts','POST',{title:'并发问题？',content:'<p>测试<script>alert(1)</script></p>'})));
      assert.deepEqual(posts.map(r=>r.status).sort(),[201,429]);
      const post=posts.find(r=>r.status===201).data;
      const replies=await Promise.all([1,2].map(()=>other.write(`/api/forum/posts/${post.id}/replies`,'POST',{content:'并发回答'})));
      assert.deepEqual(replies.map(r=>r.status).sort(),[201,429]);
      assert.equal((await ForumPost.findById(post.id)).replyCount,1);
      const reply=replies.find(r=>r.status===201).data;
      const comments=await Promise.all([1,2].map(()=>owner.write(`/api/forum/replies/${reply.id}/comments`,'POST',{content:'并发评论'})));
      assert.deepEqual(comments.map(r=>r.status).sort(),[201,429]);
      const parent=comments.find(r=>r.status===201).data;
      const child=await other.write(`/api/forum/replies/${reply.id}/comments`,'POST',{content:'第二层',parentCommentId:parent.id});assert.equal(child.status,201);
      assert.equal((await owner.write(`/api/forum/replies/${reply.id}/comments`,'POST',{content:'第三层',parentCommentId:child.data.id})).status,400);
      assert.equal((await ForumReply.findById(reply.id)).comments,2);
      assert.equal((await ForumComment.findById(parent.id)).replyCount,1);
      const likes=await Promise.all(Array.from({length:6},()=>owner.write(`/api/forum/posts/${post.id}/like`,'POST',{liked:true})));
      assert.ok(likes.every(r=>r.status===200&&r.data.votes===1));
      const detail=await owner.request(`/api/forum/posts/${post.id}`);
      assert.equal(detail.data.hasLiked,true);assert.match(detail.headers.get('cache-control'),/no-store/);
      assert.equal((await guest.request(`/api/forum/posts/${post.id}`)).data.hasLiked,false);
      assert.equal((await other.write(`/api/forum/posts/${post.id}/like`,'POST',{liked:true})).data.votes,2);
      assert.equal((await owner.write(`/api/forum/posts/${post.id}/like`,'POST',{liked:false})).data.votes,1);
      const saved=await ForumPost.findById(post.id);assert.equal(saved.likes,saved.likedBy.length);assert.doesNotMatch(saved.content,/script/);
    });
    await t.test('import dry-run, repeated batches, conflicts and stable ownership never claim an existing title',async()=>{
      const previous=process.env.IMPORT_SECRET;process.env.IMPORT_SECRET=crypto.randomBytes(32).toString('hex');
      const payload={title:'Edited',sourceUrl:'https://source.example.test/controlled',chapters:[{chapter_number:1,title:'Imported',content:'Original imported bytes'}]};
      const headers={'x-import-secret':process.env.IMPORT_SECRET};
      try{
        const count=await Book.countDocuments();
        assert.equal((await guest.request('/api/admin/upload-book','POST',payload)).status,403);
        assert.equal((await guest.request('/api/admin/upload-book','POST',{...payload,dryRun:true},headers)).status,200);
        assert.equal(await Book.countDocuments(),count);
        const inserted=await guest.request('/api/admin/upload-book','POST',payload,headers);assert.equal(inserted.status,200);
        const importedId=inserted.data.bookId;assert.notEqual(importedId,String(book._id));
        const repeated=await guest.request('/api/admin/upload-book','POST',payload,headers);assert.equal(repeated.data.unchanged,1);
        assert.equal((await Book.findById(book._id)).author_id.toString(),String(a._id));
        const original=await Chapter.findOne({bookId:importedId});
        const conflict={...payload,chapters:[{chapter_number:2,title:'Tentative',content:'Must roll back'},{...payload.chapters[0],content:'Changed bytes'}]};
        assert.equal((await guest.request('/api/admin/upload-book','POST',conflict,headers)).status,409);
        assert.equal(await Chapter.countDocuments({bookId:importedId}),1);
        assert.equal((await Chapter.findById(original._id)).content,'Original imported bytes');
        await Chapter.updateOne({_id:original._id},{$set:{deletedAt:new Date()}});
        assert.equal((await guest.request('/api/admin/upload-book','POST',payload,headers)).status,409);
        assert.equal((await other.write(`/api/chapters/${original._id}/restore`,'POST',{})).status,403);
        assert.equal((await administrator.write(`/api/chapters/${original._id}/restore`,'POST',{})).status,200);
        assert.equal((await Chapter.findById(original._id)).content,'Original imported bytes');
      }finally{if(previous===undefined)delete process.env.IMPORT_SECRET;else process.env.IMPORT_SECRET=previous;}
    });
    await t.test('book creation retry preserves ID and rejects conflicting reuse',async()=>{
      const key=crypto.randomUUID(),data={title:'Idempotent work',category:'玄幻'};
      const csrf=await owner.request('/api/auth/csrf'),headers={origin:'http://127.0.0.1:3000','x-csrf-token':csrf.data.csrfToken,'Idempotency-Key':key};
      const results=await Promise.all([1,2].map(()=>owner.request('/api/books','POST',data,headers)));
      assert.ok(results.every(r=>r.status===201));assert.equal(results[0].data.id,results[1].data.id);
      assert.equal((await owner.request('/api/books','POST',{title:'Changed title'},headers)).status,409);
      assert.equal(await Book.countDocuments({title:data.title}),1);
    });
    await t.test('logout and ban revoke previously valid cookies',async()=>{
      const oldCookie=owner.jar.get('session');
      assert.equal((await owner.write('/api/auth/logout','POST',{})).status,200);
      owner.jar.set('session',oldCookie);
      assert.equal((await owner.request('/api/auth/session')).status,401);
      assert.equal((await administrator.write(`/api/admin/users/${b._id}/ban`,'PATCH',{isBanned:true})).status,200);
      assert.equal((await other.request('/api/auth/session')).status,401);
      assert.equal((await administrator.write(`/api/admin/users/${b._id}/ban`,'PATCH',{isBanned:false})).status,200);
      assert.equal((await other.request('/api/auth/session')).status,401);
    });
    await t.test('captured mail, hashed single-use code and cookie signup',async()=>{
      const signup=client(),email='new@example.test';
      assert.equal((await signup.write('/api/auth/send-code','POST',{email})).status,200);
      assert.equal((await signup.write('/api/auth/send-code','POST',{email})).status,429);
      const code=capturedMail.find(m=>m.email===email).code;
      assert.notEqual((await VerificationCode.findOne({email})).code,code);
      const response=await signup.write('/api/auth/signup','POST',{email,username:'new',password:'Test-password-123',code});
      assert.equal(response.status,201,JSON.stringify(response.data));
      assert.equal(response.data.token,undefined);
      assert.equal((await signup.request('/api/auth/session')).status,200);
      assert.equal((await signup.write('/api/auth/signup','POST',{email,username:'new2',password:'Test-password-123',code})).status,400);
      assert.equal((await signup.write('/api/auth/change-password','POST',{oldPassword:'Test-password-123',newPassword:'New-password-123'})).status,200);
      assert.equal((await signup.request('/api/auth/session')).status,401);
    });
    await t.test('public profile hides private account fields and HTML is allowlisted',async()=>{
      const profile=(await guest.request(`/api/users/${a._id}/profile`)).data;
      for(const key of ['email','password','loginAttempts','lockUntil']) assert.equal(profile[key],undefined);
      const html=safeHtml('<p onclick="alert(1)">Hi <b>there</b></p><svg onload="alert(1)"></svg><a href="jav&#x61;script:alert(1)">link</a>');
      assert.equal(html,'<p>Hi <b>there</b></p><a>link</a>');
    });
  } finally { await new Promise(r=>server.close(r));await mongoose.disconnect();await repl.stop(); }
});
