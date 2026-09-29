import '../../tools/test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import mongoose from 'mongoose';
import {observeMongoClient, trackDatabaseRequest} from '../services/mongo-usage.js';

test('usage counts replies by concurrent purpose without retaining sensitive values, and expires old buckets', async () => {
  let now=Date.UTC(2026,8,27), id=0;
  const client=new EventEmitter(), logs=[];
  const usage=observeMongoClient(client,{clock:()=>now,log:row=>logs.push(row)});
  assert.equal(observeMongoClient(client),usage);
  const reply={ok:1,cursor:{firstBatch:[{_id:1,content:'PRIVATE BODY',account:'PRIVATE ACCOUNT'}]}};
  const request=path=>new Promise(resolve=>trackDatabaseRequest({path},{},()=>{
    const event={connectionId:'db',requestId:++id};
    client.emit('commandStarted',{...event,command:{password:'SECRET'}});
    setImmediate(()=>{client.emit('commandSucceeded',{...event,reply});resolve();});
  }));
  await Promise.all([request('/api/books'),request('/api/chapters/abc'),request('/api/books/abc/detail'),request('/api/books/abc/sitemap-chapters'),request('/api/traffic/observe')]);
  const groups=usage.snapshot().buckets[0].purposes;
  for (const purpose of ['list','reading','detail','sitemap','traffic']) {
    assert.equal(groups[purpose].commands,1);
    assert.equal(groups[purpose].estimatedBsonReplyBytes,mongoose.mongo.BSON.calculateObjectSize(reply));
  }
  assert.doesNotMatch(JSON.stringify(usage.snapshot()),/PRIVATE|SECRET|abc/);
  groups.list.commands=999;
  assert.equal(usage.snapshot().buckets[0].purposes.list.commands,1,'snapshots cannot mutate internal counts');
  now+=3600000;
  client.emit('commandStarted',{connectionId:'db',requestId:++id});
  client.emit('commandFailed',{connectionId:'db',requestId:id});
  assert.equal(logs.length,1);
  assert.equal(usage.snapshot().buckets[1].purposes.background.failed,1);
  now+=48*3600000;
  assert.deepEqual(usage.snapshot().buckets,[]);
});
