import '../../tools/test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {MongoMemoryReplSet} from 'mongodb-memory-server';
import Media from '../models/Media.js';
import Book from '../models/Book.js';
import User from '../models/User.js';
import {claimMedia,claimImportedCover,retireUnreferencedCover} from '../services/media-reference.js';
import {cleanUnusedCovers,finishCoverRetirement} from '../services/cover-retention.js';
import {createCoverStorage} from '../services/cover-storage.js';

test('immediate cover deletion: real transactions, active uploads, reference races and retries',async t=>{
  const repl=await MongoMemoryReplSet.create({binary:{version:'7.0.40'},replSet:{count:1,storageEngine:'wiredTiger'}});
  await mongoose.connect(repl.getUri('cover_retention_test'),{autoIndex:false});
  const config={bucket:'test-covers',baseUrl:'https://img.example.test'};
  const owner=new mongoose.Types.ObjectId(),start=new Date('2027-01-01T00:00:00Z');
  const objects=new Set(),calls=[];let failKey;
  const storage=createCoverStorage(config,{async send(command){
    const {Key,Bucket}=command.input;assert.equal(Bucket,config.bucket);calls.push({type:command.constructor.name,key:Key});
    if(Key===failKey)throw Object.assign(Error('Temporary storage error'),{name:'ServiceUnavailable'});
    if(command.constructor.name==='DeleteObjectCommand'){objects.delete(Key);return {};}
    assert.equal(command.constructor.name,'HeadObjectCommand');
    if(objects.has(Key))return {};
    throw Object.assign(Error('Not found'),{name:'NotFound',$metadata:{httpStatusCode:404}});
  }});
  const run=(now,extra={})=>cleanUnusedCovers({storage,bucket:config.bucket,apply:true,now,...extra});
  const make=async(extra={})=>{
    const id=new mongoose.Types.ObjectId();
    for(const width of [240,480])objects.add(`covers/${id}/${width}.webp`);
    return Media.create({_id:id,owner,storage:'r2',bucket:config.bucket,publicUrl:`${config.baseUrl}/covers/${id}/480.webp`,mime:'image/webp',sha256:'synthetic',unreferencedSince:start,...extra});
  };
  const bind=async(media,book)=>mongoose.connection.transaction(async session=>{
    assert.ok(await claimMedia(media.publicUrl,owner,session));
    await Book.updateOne({_id:book._id},{$set:{cover_image:media.publicUrl}},{session});
  });
  const unbind=async(media,book,now)=>mongoose.connection.transaction(async session=>{
    await Book.updateOne({_id:book._id},{$set:{cover_image:''}},{session});
    await retireUnreferencedCover(media.publicUrl,session,now);
  });
  try {
    for(const model of [Media,Book,User])await model.createCollection();
    await t.test('preview makes no changes and cleanup immediately deletes both objects',async()=>{
      const m=await make();
      const before=await Media.findById(m._id).lean(),count=calls.length;
      const preview=await run(start,{apply:false});
      assert.equal(preview.results.find(r=>r.id===String(m._id)).status,'wouldDelete');
      assert.deepEqual(await Media.findById(m._id).lean(),before);assert.equal(calls.length,count);
      const result=await run(start);
      assert.equal(result.results.find(r=>r.id===String(m._id)).status,'deleted');
      assert.ok((await Media.findById(m._id)).purgedAt);assert.ok(!objects.has(`covers/${m._id}/480.webp`));
    });
    await t.test('legacy unused records are deleted now; referenced books and avatars remain protected',async()=>{
      const m=await make({deleted:true}),active=await make(),removed=await make(),avatar=await make();
      await Media.updateOne({_id:m._id},{$unset:{unreferencedSince:1}});
      await Book.create([{title:'Active',cover_image:active.publicUrl},{title:'Recoverable',cover_image:removed.publicUrl,deletedAt:start}]);
      await User.create({username:'reference-owner',email:'reference@example.test',password:'synthetic',avatar:`/api/media/${avatar._id}`});
      const now=new Date(+start+20*86400000),result=await run(now);
      assert.equal(result.results.find(r=>r.id===String(m._id)).status,'deleted');
      assert.equal(+(await Media.findById(m._id)).unreferencedSince,+now);
      for(const item of [active,removed,avatar]){
        assert.equal((await Media.findById(item._id)).unreferencedSince,null);
        assert.ok(objects.has(`covers/${item._id}/480.webp`));
      }
      const next=await run(now);assert.ok(!next.results.some(r=>[m,active,removed,avatar].some(x=>String(x._id)===r.id)));
    });
    await t.test('shared and reclaimed covers stay active; the last unbind is deleted before returning',async()=>{
      const m=await make(),book=await Book.create({title:'Rebinding'}),other=await Book.create({title:'Shared'});
      await bind(m,book);assert.equal((await Media.findById(m._id)).unreferencedSince,null);
      await unbind(m,book,start);await bind(m,book);
      await run(start);assert.ok(objects.has(`covers/${m._id}/240.webp`));
      await bind(m,other);await unbind(m,book,start);assert.equal((await Media.findById(m._id)).unreferencedSince,null);
      const later=new Date(+start+3*86400000);await unbind(m,other,later);
      assert.equal((await finishCoverRetirement(m._id,{storage})).status,'deleted');
      assert.ok((await Media.findById(m._id)).purgedAt);
      assert.ok(!objects.has(`covers/${m._id}/480.webp`));
      const count=calls.length;
      assert.equal((await finishCoverRetirement(m._id,{storage})).status,'deleted');assert.equal(calls.length,count);
    });
    await t.test('a newly uploaded preview is protected until the user explicitly discards it',async()=>{
      const m=await make({unreferencedSince:null});
      await run(new Date(+start+86400000));assert.ok(objects.has(`covers/${m._id}/480.webp`));
      assert.equal((await finishCoverRetirement(m._id,{storage})).status,'notRequired');
      await Media.updateOne({_id:m._id},{$set:{deleted:true,unreferencedSince:start}});
      assert.equal((await finishCoverRetirement(m._id,{storage})).status,'deleted');
    });
    await t.test('rolled-back book edits also roll back retirement',async()=>{
      const m=await make(),book=await Book.create({title:'Rollback'});await bind(m,book);
      await assert.rejects(mongoose.connection.transaction(async session=>{
        await Book.updateOne({_id:book._id},{$set:{cover_image:''}},{session});
        await retireUnreferencedCover(m.publicUrl,session,start);throw Error('Rollback');
      }),/Rollback/);
      assert.equal((await Book.findById(book._id)).cover_image,m.publicUrl);
      assert.equal((await Media.findById(m._id)).unreferencedSince,null);
    });
    await t.test('committed deletion blocks simultaneous website and import claims',async()=>{
      const m=await make();let entered,release;
      const enteredPromise=new Promise(r=>entered=r),blocked=new Promise(r=>release=r);
      const cleaning=run(start,{storage:{async remove(item){if(String(item._id)===String(m._id)){entered();await blocked;}return storage.remove(item);}}});
      await enteredPromise;
      try {
        await mongoose.connection.transaction(async session=>assert.equal(await claimMedia(m.publicUrl,owner,session),null));
        await assert.rejects(mongoose.connection.transaction(session=>claimImportedCover(m.publicUrl,session)),/正在清理/);
      }finally{release();}
      assert.equal((await cleaning).failed,0);
    });
    await t.test('a claim committed while cleanup waits wins the transaction conflict',async()=>{
      const m=await make(),book=await Book.create({title:'Concurrent claim'});let locked,release;
      const lockedPromise=new Promise(r=>locked=r),wait=new Promise(r=>release=r);
      const binding=mongoose.connection.transaction(async session=>{
        assert.ok(await claimMedia(m.publicUrl,owner,session));locked();await wait;
        await Book.updateOne({_id:book._id},{$set:{cover_image:m.publicUrl}},{session});
      });
      await lockedPromise;
      const cleaning=run(start);
      release();await binding;await cleaning;
      assert.equal((await Book.findById(book._id)).cover_image,m.publicUrl);
      assert.ok(objects.has(`covers/${m._id}/480.webp`));assert.equal((await Media.findById(m._id)).purgedAt,undefined);
    });
    await t.test('partial R2 failures retain the tombstone and retry safely without touching unrelated keys',async()=>{
      const m=await make();failKey=`covers/${m._id}/480.webp`;
      assert.equal((await finishCoverRetirement(m._id,{storage})).status,'retrying');
      assert.ok(!objects.has(`covers/${m._id}/240.webp`));assert.ok(objects.has(failKey));
      const failed=await Media.findById(m._id);assert.equal(failed.purgedAt,undefined);assert.ok(failed.purgeStartedAt);assert.equal(failed.deleted,true);
      failKey=undefined;assert.equal((await run(new Date(+start+1000))).failed,0);
      assert.ok((await Media.findById(m._id)).purgedAt);assert.ok(!objects.has(`covers/${m._id}/480.webp`));
      assert.ok(objects.size>0);
      for(const bad of [{...m.toObject(),bucket:'chapter-bodies'},{...m.toObject(),publicUrl:'https://wrong.test/cover.webp'}])await assert.rejects(storage.remove(bad),/Invalid cover deletion/);
    });
  }finally{await mongoose.disconnect();await repl.stop();}
});
