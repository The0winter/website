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
import Review from '../models/Review.js';
import {manageReviewTestData,validatePlan} from '../../infra/review-test-data.mjs';

test('test review batches are visible, isolated from reader scores, idempotent and removable',async()=>{
  const database=await TestDatabase.create();
  const config=readConfig({APP_ENV:'test',DATABASE_URL:database.getUri(),JWT_SECRET:crypto.randomBytes(48).toString('hex')});
  await mongoose.connect(config.uri,{autoIndex:false});
  for(const model of Object.values(mongoose.models))await model.createIndexes();
  const server=createApp(config).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`,jar=new Map();
  async function request(url,body,method='GET'){
    const csrf=method==='GET'?null:(await request('/api/auth/csrf')).body.csrfToken;
    const response=await fetch(base+url,{method,headers:{cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; '),...(csrf?{'content-type':'application/json','x-csrf-token':csrf,origin:'http://127.0.0.1:3000'}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    for(const cookie of response.headers.getSetCookie()){const [key,...value]=cookie.split(';')[0].split('=');jar.set(key,value.join('='));}
    return {status:response.status,headers:response.headers,body:await response.json()};
  }
  try{
    const user=await User.create({username:'真实测试操作者',email:'operator@example.test',password:await bcrypt.hash('Local-test-12345',10)});
    const book=await Book.create({title:'功能测试作品',author:'测试作者',author_id:user._id,statisticsSeed:{runId:'test',source:'test',rating:5,ratingWeight:2,views:0,favorites:0,initializedAt:new Date()}});
    await Review.create({book:book._id,user:user._id,rating:4,content:'保留的正式评论'});
    const plan={batch:'review-fixture-test',bookId:book.id,title:book.title,author:book.author,drafts:Array.from({length:21},(_,i)=>({id:`draft-${i+1}`,displayName:`书友${i+1}`,rating:i%5+1,content:`第${i+1}条演示内容。`}))};
    const audit=[],writeAudit=async row=>audit.push(row);
    const preview=await manageReviewTestData(plan);
    assert.equal(await User.countDocuments(),1);
    assert.throws(()=>validatePlan({...plan,drafts:[{...plan.drafts[0],content:'字'.repeat(137)}]}));
    const before=(await request(`/api/books/${book.id}/reviews`)).headers.get('x-rating-summary');
    assert.equal((await manageReviewTestData(plan,{mode:'apply',writeAudit})).changed,true);
    assert.equal((await manageReviewTestData(plan,{mode:'apply',writeAudit})).changed,false);
    assert.equal(await User.countDocuments(),22);
    const listing=await request(`/api/books/${book.id}/reviews?limit=20`);
    assert.equal(listing.headers.get('x-total-count'),'22');
    assert.equal(listing.headers.get('x-rating-summary'),before);
    assert.equal(listing.body.length,20);
    assert.equal((await request(`/api/books/${book.id}/reviews?page=2&limit=20`)).body.length,2);
    assert(listing.body.some(row=>row.isTestData && row.content.startsWith('【测试】') && row.user.username.endsWith('（测试）')));
    assert(!JSON.stringify(listing.body).includes('testBatch'));
    const sample=preview.rows[0];
    const profile=(await request(`/api/users/${sample.userId}/profile`)).body;
    assert.equal(profile.isTestAccount,true);assert(!('email' in profile));assert(!('testBatch' in profile));
    assert.equal((await request('/api/auth/signin',{username:sample.username,password:'guess'},'POST')).status,403);
    assert.equal((await request('/api/auth/signin',{username:user.username,password:'Local-test-12345'},'POST')).status,200);
    assert.equal((await request(`/api/books/${book.id}/reviews/${sample.reviewId}/reaction`,{reaction:'like'},'PUT')).body.likes,1);
    assert.equal((await request(`/api/books/${book.id}/reviews`,{rating:5,content:'正式评论更新'},'POST')).status,201);
    assert.equal((await request(`/api/books/${book.id}/reviews`,{rating:1,isTestData:true},'POST')).status,400);
    const summary=JSON.parse((await request(`/api/books/${book.id}/reviews`)).headers.get('x-rating-summary'));
    assert.equal(summary.readerCount,1);assert.equal(summary.rating,5);
    assert.equal((await Book.findById(book._id)).rating,5);
    const smaller={...plan,previousDrafts:plan.drafts,drafts:plan.drafts.slice(0,7).map(row=>({...row,content:'更简短的测试观点。'}))};
    const replacement=await manageReviewTestData(smaller,{mode:'replace',writeAudit});
    assert.equal(replacement.count,7);assert.equal(replacement.after.rating,5);
    assert.equal(await Review.countDocuments(),8);assert.equal(await User.countDocuments(),8);
    assert.equal((await manageReviewTestData(smaller,{mode:'replace',writeAudit})).changed,false);
    assert.equal((await request(`/api/books/${book.id}/review-reactions?ids=${sample.reviewId}`)).body[0].likes,1);
    const updatedSample=validatePlan(smaller).rows[0];
    await Review.updateOne({_id:sample.reviewId},{$set:{content:'外部改动'}});
    await assert.rejects(manageReviewTestData(smaller,{mode:'cleanup',writeAudit}),/changed/);
    assert.equal(await Review.countDocuments(),8);
    await Review.updateOne({_id:sample.reviewId},{$set:{content:updatedSample.content}});
    assert.equal((await manageReviewTestData(smaller,{mode:'cleanup',writeAudit})).changed,true);
    assert.equal((await manageReviewTestData(smaller,{mode:'cleanup',writeAudit})).changed,false);
    assert.equal(await User.countDocuments(),1);assert.equal(await Review.countDocuments(),1);
    assert.equal((await Review.findOne({user:user._id})).content,'正式评论更新');
    assert.equal((await Book.findById(book._id)).numReviews,1);
    assert(audit.some(row=>row.phase==='completed' && row.mode==='cleanup'));
  }finally{await new Promise(resolve=>server.close(resolve));await mongoose.disconnect();await database.stop();}
});
