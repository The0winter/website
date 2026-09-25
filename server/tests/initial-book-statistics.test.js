import '../../tools/test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import {TestDatabase} from '../database/testing.js';
import {createApp} from '../app.js';
import Book from '../models/Book.js';
import Bookmark from '../models/Bookmark.js';
import Review from '../models/Review.js';
import User from '../models/User.js';
import {baselineTargets, ensureBookStatistics, initialStatisticsPlan, needsBookStatistics} from '../services/initial-book-statistics.js';
import {ratingSummary} from '../services/book-statistics.js';
import {dailyPopularityViews} from '../jobs/daily-popularity.js';

test('source levels are deterministic, bounded and do not pretend to be actual Qidian ranks', () => {
  for (let i=1;i<=200;i++) {
    const base={_id:i.toString(16).padStart(24,'0'),title:'Book',author:'Writer'};
    const upper=baselineTargets({...base,sourceUrl:'https://www.banshanren.com/book/1'});
    const other=baselineTargets({...base,sourceUrl:'https://books.example.test/1'});
    assert.deepEqual(upper,baselineTargets({...base,sourceUrl:'https://m.diyibanzhu.click/1'}));
    assert(upper.views>other.views && upper.favorites>other.favorites && upper.rating>other.rating);
    assert(upper.views>=29840 && upper.views<=37520);assert(other.views>=22160 && other.views<=29840);
    const seeded=initialStatisticsPlan({...base,sourceUrl:'https://www.banshanren.com/book/1'});
    assert.equal(seeded.statisticsSeed.qidianRank,undefined);
    assert(seeded.statisticsSeed.ratingSample.votes.every(n=>Number.isInteger(n)&&n>=1&&n<=5));
    assert(seeded.statisticsSeed.ratingSample.votes.length<=50);
    assert.equal(seeded.rating,ratingSummary(seeded).rating);
    assert.equal(needsBookStatistics(seeded),false);
    const upperDaily=dailyPopularityViews({...base,...seeded},'2026-09-25');
    const otherDaily=dailyPopularityViews({...base,...initialStatisticsPlan(base)},'2026-09-25');
    assert(upperDaily>otherDaily);
  }
  assert.equal(baselineTargets({_id:'1',sourceUrl:'https://banshanren.com.example.test/'}).profile,'middle');
  assert.equal(initialStatisticsPlan({_id:'1',visibility:'private'}),null);
});

test('incomplete baselines preserve real totals, existing samples and complete legacy seeds', () => {
  const base={_id:'000000000000000000000111',views:900000,statisticsSeed:{runId:'old',source:'rating-samples-v1',views:0,favorites:0,rating:4.5,ratingWeight:2,ratingSample:{version:1,runId:'old',initializedAt:new Date(),views:500,votes:[4,5]}}};
  const update=initialStatisticsPlan(base,{favorites:6000,readerAverage:2,readerCount:3,comments:1});
  assert.equal(update.views,900000);assert.equal(update.statisticsSeed.views,0);assert.equal(update.statisticsSeed.favorites,0);
  assert.deepEqual(update.statisticsSeed.ratingSample,base.statisticsSeed.ratingSample);
  assert.equal(update.rating,(9+6)/5);assert.equal(update.numRatings,3);assert.equal(update.numReviews,1);
  assert.equal(initialStatisticsPlan({...base,...update}),null);
  assert.equal(initialStatisticsPlan({...base,statisticsSeed:{...base.statisticsSeed,source:'qidian-snapshot'}}),null);
});

test('both upload paths initialize within the chapter transaction, preserve retries and roll back failures', async () => {
  const database=await TestDatabase.create(), previous=process.env.IMPORT_SECRET;
  process.env.IMPORT_SECRET=crypto.randomBytes(32).toString('hex');let server;
  try {
    await mongoose.connect(database.getUri(),{autoIndex:false});
    for(const model of Object.values(mongoose.models))await model.createIndexes();
    server=createApp({mode:'test',jwtSecret:'x'.repeat(40),origins:['http://127.0.0.1:3000'],trustProxy:'none',writeMode:'readwrite'}).listen(0,'127.0.0.1');
    await new Promise(resolve=>server.once('listening',resolve));
    const upload=async body=>{
      const response=await fetch(`http://127.0.0.1:${server.address().port}/api/admin/upload-book`,{method:'POST',headers:{'content-type':'application/json','x-import-secret':process.env.IMPORT_SECRET},body:JSON.stringify(body)});
      return {status:response.status,data:await response.json()};
    };
    for(const [index,host] of ['www.banshanren.com','m.diyibanzhu.click','other.example.test'].entries()) {
      const body={missingOnly:index!==0,title:`Initialization ${index}`,author:'Writer',sourceUrl:`https://${host}/book/1`,chapters:[{chapter_number:1,title:'Chapter',content:'A complete chapter.'}]};
      assert.equal((await upload({...body,dryRun:true})).status,200);
      assert.equal(await Book.countDocuments({sourceUrl:body.sourceUrl}),0);
      const response=await upload(body);assert.equal(response.status,200,JSON.stringify(response.data));
      const book=await Book.findById(response.data.bookId).lean();
      assert.equal(needsBookStatistics(book),false);
      assert.equal(book.statisticsSeed.baselineProfile,index<2?'upper-middle':'middle');
      const snapshot=JSON.stringify(book.statisticsSeed);
      await Book.updateOne({_id:book._id},{$inc:{views:7}});
      assert.equal((await upload(body)).status,200);
      const again=await Book.findById(book._id).lean();
      assert.equal(again.views,book.views+7);assert.equal(JSON.stringify(again.statisticsSeed),snapshot);
    }
    const unseeded=await Book.create({title:'Preserve existing reader data',author:'Writer',views:100000});
    const user=new mongoose.Types.ObjectId();
    await Review.create({book:unseeded._id,user,rating:1,content:'Real reader'});
    await Bookmark.create({bookId:unseeded._id,user_id:user});
    await assert.rejects(mongoose.connection.transaction(async session=>{
      const book=await Book.findById(unseeded._id).session(session);
      await ensureBookStatistics(book,{session,writeAudit:async()=>{throw Error('Audit unavailable');}});
    }));
    assert.equal((await Book.findById(unseeded._id)).statisticsSeed,undefined);
    await mongoose.connection.transaction(async session=>{
      const book=await Book.findById(unseeded._id).session(session);await ensureBookStatistics(book,{session});
    });
    const saved=await Book.findById(unseeded._id);
    assert.equal(saved.views,100000);assert.equal(saved.numRatings,1);assert.equal(saved.numReviews,1);
    assert.equal(saved.rating,ratingSummary(saved,1,1).rating);
    assert.equal(await Review.countDocuments(),1);assert.equal(await Bookmark.countDocuments(),1);
    assert.equal(+saved.updatedAt,+unseeded.updatedAt);
    const incomplete=await Book.create({title:'Rollback whole transaction',author:'Writer'});
    await assert.rejects(mongoose.connection.transaction(async session=>{
      const book=await Book.findById(incomplete._id).session(session);await ensureBookStatistics(book,{session});throw Error('Later chapter conflict');
    }));
    assert.equal((await Book.findById(incomplete._id)).statisticsSeed,undefined);
    const account=await User.create({username:'baseline-author',email:'baseline@example.test',password:await bcrypt.hash('Test-password-123',10)});
    const origin=`http://127.0.0.1:${server.address().port}`, cookies=new Map();
    async function signed(url,method='GET',body,extra={}) {
      const headers={...extra};
      if(method!=='GET'){headers['x-csrf-token']=(await signed('/api/auth/csrf')).data.csrfToken;headers.origin='http://127.0.0.1:3000';headers['content-type']='application/json';}
      headers.cookie=[...cookies].map(([key,value])=>`${key}=${value}`).join('; ');
      const response=await fetch(origin+url,{method,headers,body:body?JSON.stringify(body):undefined});
      for(const cookie of response.headers.getSetCookie()){const [key,...value]=cookie.split(';')[0].split('=');cookies.set(key,value.join('='));}
      return {status:response.status,data:await response.json()};
    }
    assert.equal((await signed('/api/auth/signin','POST',{email:account.email,password:'Test-password-123'})).status,200);
    const privateWork=await signed('/api/books','POST',{title:'Private then public',visibility:'private'},{'idempotency-key':crypto.randomUUID()});
    assert.equal(privateWork.status,201);assert.equal(privateWork.data.statisticsSeed,undefined);
    const published=await signed('/api/books/'+privateWork.data.id,'PATCH',{visibility:'public'});
    assert.equal(published.status,200);assert.equal(needsBookStatistics(published.data),false);
    assert.equal(published.data.statisticsSeed.baselineProfile,'middle');
    const key=crypto.randomUUID(), data={title:'Public on creation'};
    const created=await signed('/api/books','POST',data,{'idempotency-key':key});
    assert.equal(created.status,201);assert.equal(needsBookStatistics(created.data),false);
    const retry=await signed('/api/books','POST',data,{'idempotency-key':key});
    assert.equal(retry.data.id,created.data.id);assert.deepEqual(retry.data.statisticsSeed,created.data.statisticsSeed);
  } finally {
    if(server)await new Promise(resolve=>server.close(resolve));
    if(previous===undefined)delete process.env.IMPORT_SECRET;else process.env.IMPORT_SECRET=previous;
    await mongoose.disconnect();await database.stop();
  }
});
