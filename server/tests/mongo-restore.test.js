import '../../tools/test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {nativeTestDatabase} from '../database/testing.js';
import {encode,decode} from '../database/codec.js';
import {snapshotMongo} from '../database/snapshot.js';
import {migrationSchemas} from '../database/migration-schemas.js';
import {mongoDocuments,restoreMongoSnapshot,verifyMongoSnapshot,activateMongoTtl} from '../database/mongo-restore.js';
import {configureChapterStorage,createChapterStorage,readChapterBody} from '../services/chapter-storage.js';
import Chapter from '../models/Chapter.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {writeMongoArchive} from '../../infra/atlas-backup.mjs';
import {unpackSnapshot} from '../database/snapshot.js';

test('native Mongo restore preserves typed relationships and R2, refuses divergent targets and defers TTL',async t=>{
  const repl=await nativeTestDatabase();
  t.after(async()=>{await mongoose.disconnect();await repl.stop();});
  await mongoose.connect(repl.getUri(),{autoIndex:false,autoCreate:false});
  const db=mongoose.connection.db,schemas=await migrationSchemas();
  const id=()=>new mongoose.Types.ObjectId(),user=id(),book=id(),chapter=id(),nested=id(),hex='a'.repeat(24);
  const source={collections:[
    {name:'users',indexes:[{name:'email_1',key:{email:1},unique:true}],documents:[{_id:user,email:'synthetic@example.test',password:'unchanged-hash',stats:{history:[{_id:nested,date:new Date(0),views:3}]},legacy:hex}]},
    {name:'books',indexes:[],documents:[{_id:book,author_id:user,title:'迁移测试',writeVersion:8}]},
    {name:'chapters',indexes:[{name:'bookId_1_chapter_number_1',key:{bookId:1,chapter_number:1},unique:true}],documents:[{_id:chapter,bookId:book,title:'原章节',chapter_number:1,contentKey:'chapters/sha256/'+'0'.repeat(64)+'.txt',contentSha256:'0'.repeat(64)}]},
    {name:'writerdrafts',indexes:[],documents:[{_id:hex,owner:user,targetChapterId:chapter,draftId:hex,work:'b_'+book,createdAt:new Date(0),contentKey:'draft-ref'}]},
    {name:'sessions',indexes:[{name:'expiresAt_1',key:{expiresAt:1},expireAfterSeconds:0}],documents:[{_id:hex,userId:user,expiresAt:new Date(0)}]},
  ].map(c=>({...c,documents:c.documents.map(doc=>({id:String(doc._id),document:encode(doc)}))}))};
  const converted=mongoDocuments(source,schemas);
  assert.ok(converted[0].values[0].stats.history[0]._id instanceof mongoose.Types.ObjectId);
  assert.equal(converted[0].values[0].legacy,hex);
  assert.equal(converted[3].values[0]._id,hex);
  assert.equal(converted[3].values[0].draftId,hex);
  await assert.rejects(restoreMongoSnapshot(db,source,schemas),/inactive target/);
  const result=await restoreMongoSnapshot(db,source,schemas,{inactiveTarget:db.databaseName});
  assert.equal(result.verified,true);
  assert.equal(result.ttlIndexesDeferred.length,1);
  assert.ok(await db.collection('chapters').findOne({_id:chapter,bookId:book}));
  assert.equal((await db.collection('sessions').indexes()).some(i=>i.expireAfterSeconds!==undefined),false);
  assert.equal((await restoreMongoSnapshot(db,source,schemas,{inactiveTarget:db.databaseName})).verified,true);
  await db.collection('users').updateOne({_id:user},{$set:{password:'different'}});
  await assert.rejects(restoreMongoSnapshot(db,source,schemas,{inactiveTarget:db.databaseName}),/Target differs/);
  assert.equal((await db.collection('users').findOne({_id:user})).password,'different');
  await db.collection('users').updateOne({_id:user},{$set:{password:'unchanged-hash'}});
  await assert.rejects(db.collection('users').insertOne({_id:id(),email:'synthetic@example.test'}),e=>e.code===11000);
  const backup=await snapshotMongo(repl.getUri());
  assert.ok(backup.collections.find(c=>c.name==='chapters').documents[0].bson.includes('$oid'));
  assert.equal((await verifyMongoSnapshot(db,backup,schemas)).verified,true);
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'mongo-stream-'));
  try {
    const file=path.join(directory,'snapshot.json.gz');
    await writeMongoArchive(mongoose.connection.getClient(),file);
    const streamed=unpackSnapshot(await fs.readFile(file));
    assert.equal((await verifyMongoSnapshot(db,streamed,schemas)).verified,true);
  } finally {assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));await fs.rm(directory,{recursive:true,force:true});}
  await activateMongoTtl(db,source);
  assert.equal((await db.collection('sessions').indexes()).find(i=>i.name==='expiresAt_1').expireAfterSeconds,0);

  const objects=new Map(),storage=createChapterStorage({bucket:'test',client:{async send(command){
    const {Key,Body}=command.input;if(Body!==undefined){objects.set(Key,Body);return {};}
    return {Body:{transformToString:async()=>objects.get(Key)}};
  }}});
  configureChapterStorage(storage);process.env.CHAPTER_STORAGE='r2';
  t.after(()=>{configureChapterStorage(undefined);delete process.env.CHAPTER_STORAGE;});
  const session=await mongoose.startSession();
  try {await session.withTransaction(async()=>{
    await Chapter.create([{bookId:book,title:'新章节',chapter_number:2,content:'事务内保存的完整正文。'}],{session});
  });}finally{await session.endSession();}
  const created=await Chapter.findOne({bookId:book,chapter_number:2}).lean();
  assert.equal(created.content,undefined);assert.ok(created.contentKey);
  assert.equal(await readChapterBody(created),'事务内保存的完整正文。');
  assert.equal(decode(encode(created)).bookId,String(book));
});
