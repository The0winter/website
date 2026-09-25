import '../../tools/test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import {MongoMemoryServer} from 'mongodb-memory-server';
import {scoreTraffic} from '../services/traffic-scoring.js';
import {createTrafficStore,prepareTrafficCollections,validateTrafficEvent,trafficSigner} from '../services/traffic-observation.js';
import {readTraffic} from '../../tools/site-monitor/traffic.mjs';
import {createApp} from '../app.js';
import {readConfig} from '../config.js';

const page=(i,overrides={})=>({id:crypto.randomUUID(),type:'chapter',target:i.toString(16).padStart(24,'0'),at:i*1000,visibleMs:1000,interactions:0,interactionSpan:0,complete:true,verified:true,...overrides});
test('评分保留短访问、缺失交互与正常重度阅读；多证据才进入建议剔除',()=>{
  assert.equal(scoreTraffic({pages:[page(0)],requests:[0]}).classification,'retained');
  assert.equal(scoreTraffic({pages:[page(0,{complete:false})],requests:[0]}).classification,'insufficient');
  assert.equal(scoreTraffic({automationDeclared:true,pages:[],requests:[]}).classification,'watch');
  const bot={pages:Array.from({length:40},(_,i)=>page(i)),requests:Array.from({length:40},(_,i)=>i*1000)};
  const result=scoreTraffic(bot);assert.equal(result.score,85);assert.equal(result.classification,'high');assert.deepEqual(result.signals,['speed','regular','noInteraction']);
  const missing={...bot,pages:bot.pages.map(p=>({...p,verified:false}))};assert.equal(scoreTraffic(missing).score,65);assert.equal(scoreTraffic(missing).classification,'watch');
  const reader={automationDeclared:true,pages:[page(1,{visibleMs:45000,interactions:3,interactionSpan:25000}),page(2,{visibleMs:60000,interactions:4,interactionSpan:30000})],requests:[0,90000]};assert.equal(scoreTraffic(reader).score,30);assert.equal(scoreTraffic(reader).classification,'watch');
  const fastReader={...bot,pages:[...bot.pages,...reader.pages]};assert.equal(scoreTraffic(fastReader).classification,'high');assert.ok(!scoreTraffic(fastReader).signals.includes('reading'));
});

test('事件验证和签名拒绝伪造身份、任意路径及无界载荷',()=>{
  const signer=trafficSigner('s'.repeat(48));assert.equal(signer.unpack(signer.pack('v:test')),'v:test');assert.equal(signer.unpack(signer.pack('v:test')+'0'),null);
  assert.throws(()=>validateTrafficEvent({kind:'open',id:crypto.randomUUID(),type:'page',email:'private'}));
  assert.throws(()=>validateTrafficEvent({kind:'open',id:crypto.randomUUID(),type:'chapter',target:'https://evil.test'}));
  assert.throws(()=>validateTrafficEvent({kind:'update',id:crypto.randomUUID(),token:'x',visibleMs:Infinity,interactions:0,interactionSpan:0,complete:true}));
});

test('Mongo 实测：去重、跨会话保留、观察边界、原始证据过期和同源 CSRF',async t=>{
  const mongo=await MongoMemoryServer.create({binary:{version:'7.0.40'}});await mongoose.connect(mongo.getUri('test1_test'),{autoIndex:false,autoCreate:false});
  t.after(async()=>{await mongoose.disconnect();await mongo.stop();});const db=mongoose.connection.db;
  const nowBase=Date.parse('2026-09-15T02:00:00Z');let now=nowBase;
  await prepareTrafficCollections(db,new Date('2026-09-01T02:00:00Z'));
  const indexes=await db.collection('traffic_observation_sessions').indexes();assert.ok(indexes.some(i=>i.expireAfterSeconds===0));
  const store=createTrafficStore(db,'s'.repeat(48),{clock:()=>now}),id=crypto.randomUUID(),open={kind:'open',id,type:'chapter',target:'a'.repeat(24)};
  const first=await store.accept(open,{userAgent:'normal-browser'}),cookies={visitorCookie:first.visitorCookie,sessionCookie:first.sessionCookie,userAgent:'normal-browser'};
  await Promise.all([store.accept(open,cookies),store.accept(open,cookies)]);
  assert.equal((await db.collection('traffic_observation_sessions').findOne({})).pageCount,1);
  now+=2000;await store.accept({kind:'update',id,token:first.token,visibleMs:80000,interactions:100,interactionSpan:70000,complete:true},cookies);
  const session=await db.collection('traffic_observation_sessions').findOne({});assert.equal(session.pages[0].visibleMs,2000);assert.equal(session.pages[0].interactionSpan,2000);assert.equal(session.pages[0].interactions,3);
  await assert.rejects(store.accept({kind:'update',id,token:first.token,visibleMs:1,interactions:0,interactionSpan:0,complete:true},{visitorCookie:'forged'}));
  now+=31*60000;await assert.rejects(store.accept({kind:'update',id,token:first.token,visibleMs:1,interactions:0,interactionSpan:0,complete:true},cookies),/expired/);
  const next=await store.accept({...open,id:crypto.randomUUID()},cookies);assert.notEqual(next.sessionCookie,first.sessionCookie);assert.equal(next.visitorCookie,first.visitorCookie);
  const snapshots=await db.collection('traffic_observation_sessions').find().toArray();assert.ok(!JSON.stringify(snapshots).includes('normal-browser'));assert.ok(!JSON.stringify(snapshots).includes(first.visitorCookie));
  const visitor=session.visitor;
  await db.collection('traffic_observation_summaries').insertMany([
    {_id:'bot1',visitor:'bot-only',session:'bot-session',day:'2026-09-15',classification:'high',score:85,signals:['speed','regular','noInteraction'],updatedAt:new Date(now),pages:40},
    {_id:'mixed',visitor,session:'mixed-session',day:'2026-09-15',classification:'high',score:85,signals:['speed','regular','noInteraction'],updatedAt:new Date(now),pages:40},
    {_id:'past-normal',visitor:'future-normal',session:'past-bot',day:'2026-09-13',classification:'high',score:85,signals:[],updatedAt:new Date(now),pages:40},
    {_id:'now-normal',visitor:'future-normal',session:'now-normal',day:'2026-09-15',classification:'retained',score:0,signals:[],updatedAt:new Date(now),pages:1},
  ]);
  const result=await readTraffic(db,{},Date.parse('2026-09-16T03:00:00Z'));
  assert.equal(result.views.raw.rolling[1].activeUsers,3);assert.equal(result.views.retained.rolling[1].activeUsers,2);assert.equal(result.views.retained.rolling[1].newUsers,2);assert.equal(result.views.raw.rolling[1].newUsers,2);assert.equal(result.views.raw.rolling[30].activeUsers,null);assert.equal(result.views.raw.trends.day[0].activeUsers,0);assert.equal(result.views.raw.trends.month.at(-1).activeUsers,null);assert.equal(result.mode,'observe');assert.equal(result.reviewReady,true);assert.ok(!JSON.stringify(result).includes(visitor));assert.ok(!JSON.stringify(result).includes('bot-only'));
  const config=readConfig({APP_ENV:'test',MONGO_URI:mongo.getUri('test1_test'),JWT_SECRET:'t'.repeat(48),TRAFFIC_ANALYTICS:'observe'}),server=createApp(config).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
  const base='http://127.0.0.1:'+server.address().port;
  let response=await fetch(base+'/api/traffic/observe',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://127.0.0.1:3000'},body:JSON.stringify(open)});assert.equal(response.status,403);
  const csrf=await fetch(base+'/api/auth/csrf'),token=(await csrf.json()).csrfToken,cookie=csrf.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  response=await fetch(base+'/api/traffic/observe',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://127.0.0.1:3000','x-csrf-token':token,Cookie:cookie},body:JSON.stringify(open)});assert.equal(response.status,200);assert.ok((await response.json()).token);assert.ok(response.headers.getSetCookie().every(c=>/HttpOnly/i.test(c)&&/SameSite=Lax/i.test(c)));
  response=await fetch(base+'/api/traffic/observe',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.test','x-csrf-token':token,Cookie:cookie},body:JSON.stringify(open)});assert.equal(response.status,403);
});
