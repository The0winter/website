import '../../tools/test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {installSqlDriver} from '../database/driver.js';
import {cleanupExpired} from '../database/index.js';
import {snapshotSql,packSnapshot,unpackSnapshot,restoreSnapshot,snapshotSummary} from '../database/snapshot.js';
import {D1Transport} from '../database/transport.js';

test('D1 snapshot restores IDs, dates, large drafts, unique and expiry indexes without rewriting unchanged rows',async t=>{
  installSqlDriver();
  const Model=mongoose.model('SnapshotFixture',new mongoose.Schema({key:{type:String,unique:true},body:String,expiresAt:{type:Date,expires:0}}));
  await mongoose.connect('sqlite::memory:');t.after(()=>mongoose.disconnect());
  await Model.createIndexes();
  const body='完整的中文正文。'.repeat(15000),date=new Date(Date.now()+86400000);
  const doc=await Model.create({key:'restored',body,expiresAt:date});
  const expired=await Model.create({key:'expired',expiresAt:new Date(0)});
  assert.equal((await mongoose.connection.transport.query('SELECT COUNT(*) AS n FROM _d1_values'))[0].n,0);
  const snapshot=unpackSnapshot(packSnapshot(await snapshotSql(mongoose.connection)));
  await mongoose.disconnect();await mongoose.connect('sqlite::memory:');
  const report=await restoreSnapshot(mongoose.connection,snapshot,{inactiveTarget:true});
  assert.equal(report[0].count,2);
  assert.equal((await Model.findById(doc._id)).body,body);
  assert.equal((await Model.findById(doc._id)).expiresAt.toISOString(),date.toISOString());
  assert.deepEqual(snapshotSummary(await snapshotSql(mongoose.connection)).collections,snapshotSummary(snapshot).collections);
  const unchanged=await restoreSnapshot(mongoose.connection,snapshot,{inactiveTarget:true});assert.equal(unchanged[0].changed,0);
  await assert.rejects(Model.create({key:'restored'}),error=>error.code===11000);
  await cleanupExpired();assert.equal(await Model.exists({_id:expired._id}),null);assert.ok(await Model.exists({_id:doc._id}));
});

test('D1 transport coalesces reads and resolves ambiguous commits only using a persisted receipt',async()=>{
  const calls=[],respond=results=>({ok:true,status:200,json:async()=>({success:true,result:results.map(results=>({success:true,results,meta:{rows_read:1}}))})});
  const transport=new D1Transport({accountId:'a'.repeat(32),databaseId:'a'.repeat(36),token:'synthetic-secret',fetcher:async(_url,options)=>{
    const body=JSON.parse(options.body);calls.push(body);
    if(body.sql.includes('INSERT INTO _d1_commits'))throw new Error('connection lost after commit');
    if(body.sql.startsWith('SELECT id FROM _d1_commits'))return respond([[{id:'present'}]]);
    return respond([[{value:1}],[{value:2}]]);
  }});
  assert.deepEqual(await Promise.all([transport.query('SELECT 1'),transport.query('SELECT 2')]),[[{value:1}],[{value:2}]]);
  assert.equal(calls.length,1);
  await transport.batch(['UPDATE synthetic SET x=1'],{recordCommit:true});
  assert.equal(calls.filter(c=>c.sql.includes('UPDATE synthetic')).length,1);
  transport.fetcher=async()=>{throw new Error('offline with sensitive diagnostic');};
  await assert.rejects(transport.batch(['UPDATE synthetic SET x=2'],{recordCommit:true}),error=>error.code==='D1_OUTCOME_UNKNOWN'&&!error.message.includes('sensitive'));
});
