import '../../tools/test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import {MongoMemoryServer} from 'mongodb-memory-server';
import {createTrafficStore,trafficSigner} from '../services/traffic-observation.js';
import {scoreTraffic} from '../services/traffic-scoring.js';

const secret='cache-regression-'.repeat(4),signer=trafficSigner(secret);
const open=()=>({kind:'open',id:crypto.randomUUID(),type:'chapter',target:'a'.repeat(24)});
const cookies=response=>({visitorCookie:response.visitorCookie,sessionCookie:response.sessionCookie});
const update=(event,response,visibleMs=10000)=>({kind:'update',id:event.id,token:response.token,visibleMs,interactions:2,interactionSpan:visibleMs,complete:true});
test('Mongo: observation cache preserves durable evidence, concurrent sessions, summaries, retries and bounded memory',async t=>{
  const mongo=await MongoMemoryServer.create({binary:{version:'7.0.40'}}),client=new mongoose.mongo.MongoClient(mongo.getUri('test1_test'));
  await client.connect();t.after(async()=>{await client.close();await mongo.stop();});
  let now=Date.parse('2026-09-29T15:59:50Z'),sequence=0;
  function fixture(options={}) {
    const prefix='case'+(++sequence),raw=client.db().collection(prefix+'_raw'),summary=client.db().collection(prefix+'_summary');
    const db={collection:name=>name==='traffic_observation_sessions'?raw:summary};
    return {raw,summary,store:createTrafficStore(db,secret,{clock:()=>now,...options}),make:extra=>createTrafficStore(db,secret,{clock:()=>now,...extra})};
  }
  await t.test('every acknowledged heartbeat is saved immediately, with no full-session reread on cache hits',async()=>{
    const {raw,summary,store,make}=fixture(),event=open(),response=await store.accept(event),jar=cookies(response);
    for(let i=1;i<=12;i++){
      now+=10000;await store.accept(update(event,response,i*10000),jar);
      const saved=await raw.findOne({});assert.equal(saved.pages[0].visibleMs,i*10000);assert.equal(saved.lastAt,now);
      const rows=await summary.find().toArray();assert.ok(rows.every(row=>row.observationRevision===saved.observationRevision&&row.updatedAt.getTime()===now));
    }
    assert.equal(store.snapshot().reads,1);assert.equal(store.snapshot().cacheHits,12);assert.equal(store.snapshot().writes,13);
    assert.equal((await summary.countDocuments({})),2,'cross-midnight summaries remain immediate');
    assert.doesNotMatch(JSON.stringify(store.snapshot()),new RegExp(signer.unpack(response.sessionCookie).slice(2)));
    const restarted=make();now+=10000;await restarted.accept(update(event,response,130000),jar);
    assert.equal((await raw.findOne({})).pages[0].visibleMs,130000);assert.equal(restarted.snapshot().reads,1);
  });
  await t.test('independent writers merge simultaneous tabs and duplicate opens without overwriting each other',async()=>{
    const {raw,summary,store,make}=fixture(),event=open(),first=await store.accept(event),jar=cookies(first),other=make();
    now+=10000;await other.accept(update(event,first),jar);await store.accept(update(event,first),jar);
    const events=Array.from({length:12},open);
    await Promise.all(events.map((event,i)=>(i%2?store:other).accept(event,jar)));
    const duplicate=open();await Promise.all([store.accept(duplicate,jar),other.accept(duplicate,jar)]);
    await Promise.all([store.drain(),other.drain()]);
    const saved=await raw.findOne({});assert.equal(saved.pageCount,14);assert.equal(new Set(saved.pages.map(p=>p.id)).size,14);
    assert.ok(store.snapshot().conflicts+other.snapshot().conflicts>0);
    const row=await summary.findOne({});assert.equal(row.observationRevision,saved.observationRevision);assert.equal(row.pages,14);assert.equal(row.score,scoreTraffic(saved).score);
  });
  await t.test('a delayed older summary cannot replace the newer writer assessment',async t=>{
    const {raw,summary,store,make}=fixture(),event=open(),first=await store.accept(event),jar=cookies(first);
    let release,reached;const paused=new Promise(r=>{reached=r;}),gate=new Promise(r=>{release=r;});
    const original=summary.updateOne.bind(summary);let delayed=false;
    t.mock.method(summary,'updateOne',async(filter,value,options)=>{
      if(value.$set.observationRevision===2&&!delayed){delayed=true;reached();await gate;}
      return original(filter,value,options);
    });
    now+=10000;const older=store.accept(update(event,first,10000),jar);await paused;
    now+=10000;await make().accept(update(event,first,20000),jar);release();await older;
    const saved=await raw.findOne({}),row=await summary.findOne({});assert.equal(saved.observationRevision,3);assert.equal(row.observationRevision,3);assert.equal(row.updatedAt.getTime(),now);
  });
  await t.test('failed writes discard speculative cache; saved evidence survives summary failure and idempotent retry',async t=>{
    const {raw,summary,store,make}=fixture(),event=open(),first=await store.accept(event),jar=cookies(first);
    const replace=raw.replaceOne.bind(raw);let failRaw=true;
    t.mock.method(raw,'replaceOne',async(...args)=>{if(failRaw){failRaw=false;throw Error('Injected write failure');}return replace(...args);});
    now+=10000;await assert.rejects(store.accept(update(event,first),jar),/Injected/);assert.equal((await raw.findOne({})).pages[0].visibleMs,0);assert.equal(store.snapshot().entries,0);
    await store.accept(update(event,first),jar);assert.equal((await raw.findOne({})).pages[0].visibleMs,10000);
    const writeSummary=summary.updateOne.bind(summary);let failSummary=true;
    t.mock.method(summary,'updateOne',async(...args)=>{if(failSummary){failSummary=false;throw Error('Injected summary failure');}return writeSummary(...args);});
    const next=open();await assert.rejects(store.accept(next,jar),/Injected/);assert.equal((await raw.findOne({})).pageCount,2);assert.equal(store.snapshot().entries,0);
    await make().accept(next,jar);const saved=await raw.findOne({});assert.equal(saved.pageCount,2);assert.equal((await summary.findOne({})).observationRevision,saved.observationRevision);
  });
  await t.test('legacy rows upgrade on use, deleted evidence is not resurrected, cache expiry and eviction lose no data',async()=>{
    const {raw,summary,store,make}=fixture({maxCacheEntries:2,cacheMs:100}),event=open(),first=await store.accept(event),jar=cookies(first);
    await raw.updateOne({},{$unset:{observationRevision:1}});await summary.updateOne({},{$unset:{observationRevision:1}});
    now+=10;await store.accept(update(event,first,10),jar);assert.equal((await raw.findOne({})).observationRevision,1);assert.ok(store.snapshot().conflicts>=1);
    await store.accept(open());await store.accept(open());assert.equal(store.snapshot().entries,2);assert.ok(store.snapshot().evictions>=1);
    now+=200;const before=store.snapshot().reads;await store.accept(update(event,first,210),jar);assert.equal(store.snapshot().reads,before+1);
    await raw.deleteOne({_id:signer.unpack(first.sessionCookie).slice(2)});
    await assert.rejects(store.accept(update(event,first,210),jar),/expired/);assert.equal(await raw.countDocuments({_id:signer.unpack(first.sessionCookie).slice(2)}),0);
    const renewed=await store.accept(open(),jar);assert.notEqual(renewed.sessionCookie,first.sessionCookie);assert.equal(renewed.visitorCookie,first.visitorCookie);
    const tiny=make({maxCacheBytes:1600});await tiny.accept(open());assert.equal(tiny.snapshot().entries,0);assert.equal(tiny.snapshot().estimatedBytes,0);
  });
});
