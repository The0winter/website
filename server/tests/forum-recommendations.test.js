import '../../tools/test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import {TestDatabase} from '../database/testing.js';
import {readConfig} from '../config.js';
import {createApp} from '../app.js';
import Book from '../models/Book.js';
import User from '../models/User.js';
import Post from '../models/ForumPost.js';
import Reply from '../models/ForumReply.js';
import Bookmark from '../models/Bookmark.js';
import {RecommendationItem as Item,RecommendationEvent as Event,RecommendationTrend as Trend} from '../models/ForumRecommendation.js';
import {syncForumCatalog,publicRecommendationItems} from '../services/forum-recommendation-catalog.js';
import {personalizedForumFeed,saveRecommendationPreference,removeRecommendationPreference,recommendationReadReceipt,
  acceptRecommendationEvents,recordRecommendationEvent,updateRecommendationSettings,verifyRecommendation} from '../services/forum-recommendations.js';
import {DAY,rankRecommendations,interestProfile,trendScore} from '../services/forum-recommendation-ranking.js';

test('ranking balances interests, exploration, time decay and non-relaxable exclusions',()=>{
  const now=Date.now(),interests={books:new Map(),topics:new Map([['科幻',8],['历史',4]]),authors:new Map()};
  const candidates=Array.from({length:120},(_,i)=>({_id:String(i),post:String(Math.floor(i/2)),book:String(Math.floor(i/2)),
    author:'author-'+Math.floor(i/4),topic:['科幻','历史','情感关系','推理悬疑','现实社会'][Math.floor(i/2)%5],
    topics:[['科幻','历史','情感关系','推理悬疑','现实社会'][Math.floor(i/2)%5]],quality:.8,length:1000,
    fingerprint:String(i),publishedAt:new Date(now-10*DAY),createdAt:new Date(now)}));
  const options={interests,seed:'stable',now,limit:60};
  const ranked=rankRecommendations(candidates,options);
  assert.equal(ranked.length,60);
  assert.deepEqual(ranked.map(row=>row._id),rankRecommendations(candidates,options).map(row=>row._id));
  for(let i=0;i<ranked.length;i++) {
    const window=ranked.slice(Math.max(0,i-19),i+1);
    assert.equal(new Set(window.map(row=>row.post)).size,window.length,'question diversity must cross page boundaries');
    assert.ok(window.filter(row=>row.author===ranked[i].author).length<=2);
  }
  assert.ok(new Set(ranked.slice(0,5).map(row=>row.topic)).size>=3);
  assert.ok(ranked.slice(0,20).some(row=>row.reason==='探索相邻兴趣'));
  const blocked=candidates[0],read=candidates[1],seen=candidates[2];
  const suppressed=rankRecommendations(candidates,{...options,preferences:[{entry:blocked._id,reason:'dislike'}],
    events:[{entry:read._id,read:true,at:new Date(now-2*DAY)},
      {entry:seen._id,impression:true,day:'yesterday',at:new Date(now-2*DAY)},
      {entry:seen._id,impression:true,day:'today',at:new Date(now-1.1*DAY)}]});
  assert.ok(!suppressed.some(row=>[blocked._id,read._id,seen._id].includes(row._id)));
  assert.ok(trendScore({heat24:10,heat7:10,at:new Date(now)},now)>trendScore({heat24:10,heat7:10,at:new Date(now-3*DAY)},now));
  const profile=interestProfile([{book:'x',read:true,at:new Date(now-2*DAY),topics:['科幻']}],[],[],{enabled:false},now);
  assert.equal(profile.books.size,0);
  assert.equal(rankRecommendations(candidates,{...options,tab:'follow'}).length,0);
});

test('fast queues retain exploration and search beyond lookahead before relaxing diversity',()=>{
  const now=Date.now(),interests={books:new Map(),authors:new Map(),topics:new Map([['科幻',8],['情感关系',8],['游戏竞技',8]])};
  const rows=Array.from({length:200},(_,i)=>{
    const topic=i<150?['科幻','情感关系','游戏竞技'][i%3]:['历史','文学写作','幽默日常','现实社会'][i%4];
    return {_id:String(i).padStart(8,'0'),post:'post-'+i,book:'book-'+i,author:'author-'+i,topic,topics:[topic],
      length:1000,quality:.8,publishedAt:new Date(now-DAY),fingerprint:'body-'+i};
  });
  const options={interests,seed:'independent-exploration',now,limit:20};
  assert.equal(rankRecommendations(rows,options).filter(row=>row.affinity<.12).length,4);
  assert.equal(rankRecommendations(rows,{...options,exploration:'more'}).filter(row=>row.affinity<.12).length,8);
  const crowded=[...rows.slice(0,100).map(row=>({...row,book:'shared',author:'shared-author'})),...rows.slice(150,190)];
  const varied=rankRecommendations(crowded,options);
  assert.equal(varied.length,20);
  assert.ok(varied.filter(row=>row.author==='shared-author').length<=2);
});

test('fast selection postpones a repeated question without losing it and excludes near-duplicate bodies',()=>{
  const now=Date.now(),rows=Array.from({length:23},(_,i)=>({_id:String(i),post:'post-'+i,book:'book-'+i,author:'author-'+i,
    topic:['科幻','历史','情感关系'][i%3],topics:[['科幻','历史','情感关系'][i%3]],length:1000,quality:1-i*.01,
    publishedAt:new Date(now-DAY),fingerprint:'body-'+i}));
  rows[1]={...rows[1],post:rows[0].post,book:rows[0].book};
  const duplicate={...rows[22],_id:'near-duplicate',fingerprint:'different-exact-hash',nearSignature:'0123456789abcdef'};
  rows[22].nearSignature=duplicate.nearSignature;
  const ranked=rankRecommendations([...rows,duplicate],{seed:'question-window',now});
  assert.equal(ranked.length,23);
  const repeated=ranked.flatMap((row,i)=>row.post===rows[0].post?[i]:[]);
  assert.equal(repeated.length,2);
  assert.ok(repeated[1]-repeated[0]>=20);
  assert.equal(ranked.filter(row=>row.book===duplicate.book).length,1);
});

test('personalized feed persists snapshots, protects identities/visibility and learns only verified events',async()=>{
  const database=await TestDatabase.create();
  const key=crypto.randomBytes(48).toString('hex');
  const config=readConfig({APP_ENV:'test',DATABASE_URL:database.getUri(),JWT_SECRET:key});
  await mongoose.connect(config.uri,{autoIndex:false});
  const server=createApp(config).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  try {
    const [u1,u2]=await User.create([{username:'推荐读者甲',email:'reco-a@example.test',password:'synthetic'},
      {username:'推荐读者乙',email:'reco-b@example.test',password:'synthetic'}]);
    const books=await Book.insertMany(Array.from({length:50},(_,i)=>({title:`推荐作品${i}`,author:`作品作者${i}`,
      category:['科幻','历史','情感','推理','奇幻'][i%5],...(i===49?{visibility:'private'}:{})})));
    const posts=await Post.insertMany(books.map((book,i)=>({title:`如何评价推荐作品${i}？`,content:'问题补充',type:'question',
      bookId:book._id,author:u1._id,replyCount:2,tags:[book.title,'读后感','含剧透']})));
    const replies=await Reply.insertMany(posts.flatMap((post,i)=>[0,1].map(j=>({postId:post._id,author:u1._id,
      content:`<p>作品${i}回答${j}：${books[i].category}讨论。</p>`+'<p>这篇合成书评完整讨论人物、情节与作品背景。</p>'.repeat(12),
      source:{author:`原作者${i}`,url:`https://example.test/book/${i}#review-${j}`,publishedAt:new Date('2020-01-01')},
      ...(i===48&&j===1?{curation:{status:'withheld'}}:{})}))));
    const article=await Post.create({title:'独立文章',content:'<p>独立文章关于另一种生活体验。</p>'.repeat(10),type:'article',author:u1._id});
    const comment=await Reply.create({postId:article._id,author:u1._id,content:'文章评论不推荐'});
    const result=await syncForumCatalog({batches:10});assert.ok(result.items>=90);
    assert.equal(await Item.exists({_id:String(comment._id)}),null);
    assert.equal(await Item.exists({_id:String(replies[99]._id)}),null);
    assert.equal(await Item.exists({_id:String(replies[97]._id)}),null);
    const identity={actor:'actor-a',userId:String(u1._id)},other={actor:'actor-b',userId:String(u2._id)};
    await Bookmark.create({user_id:u1._id,bookId:books[0]._id});
    await Bookmark.create({user_id:u2._id,bookId:books[1]._id});
    const first=await personalizedForumFeed({identity,key,limit:5});
    assert.equal(first.items.length,5);assert.equal(first.algorithm,'balanced-fast-v2');
    assert.equal(first.items[0].bookId,String(books[0]._id));
    const secondUser=await personalizedForumFeed({identity:other,key,limit:5});
    assert.equal(secondUser.items[0].bookId,String(books[1]._id));
    const cursor=first.nextCursor;
    const second=await personalizedForumFeed({identity,key,limit:5,cursor});
    assert.deepEqual((await personalizedForumFeed({identity,key,limit:5,cursor})).items.map(row=>row.entryId),second.items.map(row=>row.entryId));
    assert.equal(new Set([...first.items,...second.items].map(row=>row.id)).size,10);
    await assert.rejects(personalizedForumFeed({identity:other,key,limit:5,cursor}),/更新/);
    await assert.rejects(personalizedForumFeed({identity,key,tab:'hot',cursor}),/游标/);
    await assert.rejects(personalizedForumFeed({identity,key,cursor:cursor+'x'}),/更新/);
    const selected=second.items[0];
    await Book.updateOne({_id:selected.bookId},{$set:{visibility:'private'}});
    const afterPrivate=await personalizedForumFeed({identity,key,limit:5,cursor});
    assert.ok(!afterPrivate.items.some(row=>row.bookId===selected.bookId));
    await Book.updateOne({_id:selected.bookId},{$set:{visibility:'public'}});
    const blocked=first.items[0];
    const saved=await saveRecommendationPreference(identity.actor,blocked.entryId,'book');
    assert.ok(!(await personalizedForumFeed({identity,key})).items.some(row=>row.bookId===blocked.bookId));
    await removeRecommendationPreference(other.actor,saved.rows[0].id);
    assert.ok(!(await personalizedForumFeed({identity,key})).items.some(row=>row.bookId===blocked.bookId),'another identity cannot remove a preference');
    await removeRecommendationPreference(identity.actor,saved.rows[0].id);
    await saveRecommendationPreference(identity.actor,blocked.entryId,'followBook');
    const follow=await personalizedForumFeed({identity,key,tab:'follow'});
    assert.ok(follow.items.length>0 && follow.items.every(row=>row.bookId===blocked.bookId));
    assert.equal((await personalizedForumFeed({identity:other,key,tab:'follow'})).items.length,0);
    const follows=await saveRecommendationPreference(identity.actor,secondUser.items[0].entryId,'followBook');
    const followedPage=await personalizedForumFeed({identity,key,tab:'follow',limit:1});
    assert.ok(followedPage.nextCursor);
    for(const preference of follows.rows)if(preference.reason==='followBook')await removeRecommendationPreference(identity.actor,preference.id);
    assert.equal((await personalizedForumFeed({identity,key,tab:'follow',cursor:followedPage.nextCursor})).items.length,0,'unfollowing applies to existing cursor pages');
    const now=Date.now();
    const receipt=await recommendationReadReceipt(identity.actor,blocked.entryId,key,now-60000);
    await assert.rejects(acceptRecommendationEvents(identity,[{type:'read',token:receipt.token,activeMs:1000,depth:1}],key,now),/有效条件/);
    await assert.rejects(acceptRecommendationEvents(other,[{type:'read',token:receipt.token,activeMs:50000,depth:1}],key,now),/更新/);
    assert.equal((await acceptRecommendationEvents(identity,[{type:'read',token:receipt.token,activeMs:50000,depth:.5}],key,now)).recorded,1);
    assert.equal((await acceptRecommendationEvents(identity,[{type:'read',token:receipt.token,activeMs:50000,depth:.5}],key,now)).recorded,0);
    const afterRead=await personalizedForumFeed({identity,key});assert.ok(!afterRead.items.some(row=>row.entryId===blocked.entryId));
    const beforeHeat=(await Trend.findById(blocked.entryId).lean()).heat24;
    assert.ok(beforeHeat>0);
    await recordRecommendationEvent(identity,blocked.entryId,'like');
    await recordRecommendationEvent(identity,blocked.entryId,'like');
    assert.equal((await Trend.findById(blocked.entryId).lean()).likes,1);
    assert.ok((await Trend.findById(blocked.entryId).lean()).heat24>beforeHeat);
    await updateRecommendationSettings(identity.actor,{enabled:false});
    const disabled=await personalizedForumFeed({identity,key});
    assert.ok(!disabled.items.some(row=>row.recommendation.reason==='与你的阅读兴趣相关'));
    // HTTP guest state uses an HttpOnly first-party cookie, never x-user-id.
    const base=`http://127.0.0.1:${server.address().port}`,jar=new Map();
    const request=async(path,method='GET',body)=>{
      const csrf=method!=='GET'?(await request('/api/auth/csrf')).data.csrfToken:undefined;
      const response=await fetch(base+path,{method,headers:{cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; '),
        ...(csrf?{origin:'http://127.0.0.1:3000','x-csrf-token':csrf,'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
      for(const cookie of response.headers.getSetCookie()){const [name,...value]=cookie.split(';')[0].split('=');jar.set(name,value.join('='));}
      return {status:response.status,data:await response.json(),headers:response.headers};
    };
    assert.equal((await request('/api/forum/preferences')).status,200);assert.ok(jar.has('forum_visitor'));
    const wire=await request('/api/forum/posts?view=answers&format=page&limit=5');
    assert.equal(wire.status,200);assert.equal(wire.headers.get('cache-control'),'private, no-store');
    assert.equal(wire.data.items.length,5);
    assert.equal((await request('/api/forum/preferences','POST',{entry:wire.data.items[0].entryId,reason:'author'})).status,200);
    assert.equal((await request('/api/forum/recommendations/events','POST',{events:[{type:'read',token:'forged'}]})).status,409);
    assert.ok((await Event.countDocuments())<=2,'fetching and preloading never count as impressions or reads');
    // The faster learning sample may be truncated; exclusions must still cover
    // older reads outside it, including when an expanded recall is necessary.
    const allItems=await Item.find({}).select('_id').lean(),busyActor='reader-beyond-learning-sample';
    await Event.insertMany([
      ...allItems.map((row,i)=>({_id:'older-read-'+i,actor:busyActor,entry:row._id,read:true,day:'older',at:new Date(now-2*DAY),expiresAt:new Date(now+60*DAY)})),
      ...Array.from({length:400},(_,i)=>({_id:'recent-unrelated-'+i,actor:busyActor,entry:new mongoose.Types.ObjectId().toString(),
        impression:true,day:'today',at:new Date(now),expiresAt:new Date(now+60*DAY)})),
    ]);
    const exhausted=await personalizedForumFeed({identity:{actor:busyActor,userId:null},key});
    assert.equal(exhausted.items.length,0,'read cooldown survives truncation and wider recall');
    assert.throws(()=>verifyRecommendation(receipt.token,identity.actor,key,now+7*3600000),/更新/);
    await Reply.updateOne({_id:blocked.entryId},{$set:{'curation.status':'withheld'}});
    assert.equal((await publicRecommendationItems([blocked.entryId])).length,0);
    // Stale public candidates can become private between catalog passes. The
    // small pool is deliberately dominated by them; wider recall must recover
    // public supply and persist its new order before returning a first cursor.
    const hiddenBooks=books.slice(0,32).map(book=>String(book._id));
    await Item.updateMany({},{$set:{quality:.1,bucket:0,createdAt:new Date(now-90*DAY)}});
    await Item.updateMany({book:{$in:hiddenBooks}},{$set:{quality:.95,createdAt:new Date(now)}});
    await Book.updateMany({_id:{$in:hiddenBooks}},{$set:{visibility:'private'}});
    const visitor={actor:'visibility-fallback',userId:null};
    const recovered=await personalizedForumFeed({identity:visitor,key,limit:5});
    assert.equal(recovered.items.length,5,'live visibility filtering must not turn a small pool into a false empty feed');
    assert.ok(recovered.items.every(row=>!hiddenBooks.includes(row.bookId)));
    assert.ok(recovered.nextCursor);
    const nextRecovered=await personalizedForumFeed({identity:visitor,key,limit:5,cursor:recovered.nextCursor});
    assert.equal(new Set([...recovered.items,...nextRecovered.items].map(row=>row.id)).size,10);
    assert.deepEqual((await personalizedForumFeed({identity:visitor,key,limit:5,cursor:recovered.nextCursor})).items.map(row=>row.entryId),nextRecovered.items.map(row=>row.entryId));
  } finally {await new Promise(resolve=>server.close(resolve));await mongoose.disconnect();await database.stop();}
});
