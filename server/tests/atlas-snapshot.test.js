import '../../tools/test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import mongoose from 'mongoose';
import {nativeTestDatabase} from '../database/testing.js';
import {decode} from '../database/codec.js';
import {unpackSnapshot} from '../database/snapshot.js';
import {writeMongoArchive} from '../../infra/atlas-backup.mjs';

test('backup reads all collections at one snapshot despite concurrent writes, without a long transaction',async t=>{
  const repl=await nativeTestDatabase();
  const client=new mongoose.mongo.MongoClient(repl.getUri(),{monitorCommands:true});
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'atlas-snapshot-'));
  t.after(async()=>{await client.close();await repl.stop();assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));await fs.rm(directory,{recursive:true,force:true});});
  await client.connect();const db=client.db();
  await db.collection('alpha').insertOne({_id:'first',value:'before'});
  await db.collection('omega').insertOne({_id:'last',value:'before'});
  const commands=[];client.on('commandStarted',e=>{if(e.commandName==='find')commands.push(e.command);});
  let changed=false;
  const wrapped={startSession:options=>client.startSession(options),db:()=>({
    databaseName:db.databaseName,listCollections:(...args)=>db.listCollections(...args),
    collection:name=>({indexes:()=>db.collection(name).indexes(),find:(...args)=>{
      const cursor=db.collection(name).find(...args);
      return {async *[Symbol.asyncIterator](){
        for await(const doc of cursor)yield doc;
        if(name==='alpha'){
          await db.collection('omega').updateOne({_id:'last'},{$set:{value:'after'}});
          await db.collection('omega').insertOne({_id:'new',value:'after'});changed=true;
        }
      },close:()=>cursor.close()};
    }})
  })};
  const file=path.join(directory,'snapshot.json.gz');
  await writeMongoArchive(wrapped,file);
  const snapshot=unpackSnapshot(await fs.readFile(file));
  assert.equal(changed,true);
  assert.deepEqual(snapshot.collections.map(c=>[c.name,c.documents.map(r=>decode(r.document))]),[
    ['alpha',[{_id:'first',value:'before'}]],['omega',[{_id:'last',value:'before'}]],
  ]);
  assert.equal(commands.length,2);
  assert.ok(commands.every(c=>c.readConcern.level==='snapshot'&&!c.startTransaction&&c.autocommit===undefined));
  assert.ok(commands[1].readConcern.atClusterTime,'the second collection reuses the first snapshot timestamp');
  assert.equal((await db.collection('omega').findOne({_id:'last'})).value,'after');
});
