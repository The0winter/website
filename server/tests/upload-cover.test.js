import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import sharp from 'sharp';
import {MongoMemoryReplSet} from 'mongodb-memory-server';
import Book from '../models/Book.js';
import Media from '../models/Media.js';
import User from '../models/User.js';
import {lockBook} from '../services/content.js';
import {claimMedia} from '../services/media-reference.js';
import {prepareCover,createCoverStorage} from '../services/cover-storage.js';
import {parseArgs,uploadCover} from '../../infra/upload-cover.mjs';

test('cover CLI requires one exact selector and rejects ambiguous or unsafe arguments',()=>{
  const options=parseArgs(['--book=同名书','--author=甲','--image=F:/封面/a b.png','--apply']);
  assert.equal(options.book,'同名书');assert.equal(options.apply,true);assert.equal(options.image,'F:/封面/a b.png');
  assert.equal(parseArgs(['--book-id='+'a'.repeat(24),'--image=a.png']).apply,false);
  for(const args of [[],['--book=x','--book-id='+'a'.repeat(24),'--image=a.png'],['--book=x','--book=y','--image=a.png'],['--book=x','--image=a.png','--host=-oProxyCommand=bad'],['--book=x','--image=a.png','--site=https://user:secret@example.test'],['--book=x','--image=a.png','--unknown=y']]) assert.throws(()=>parseArgs(args));
});

test('shared cover upload uses real MongoDB transactions and existing image storage services',async t=>{
  const repl=await MongoMemoryReplSet.create({binary:{version:'7.0.40'},replSet:{count:1,storageEngine:'wiredTiger'}});
  await mongoose.connect(repl.getUri('cover_cli_test'),{autoIndex:false});
  try {
    for(const model of [Book,Media,User]) await model.createCollection();
    const admin=await User.create({username:'cover-admin',email:'cover-admin@example.test',password:'synthetic-only',role:'admin'});
    const first=await Book.create({title:'同名书',author:'甲',description:'Keep description'});
    const bytes=await sharp({create:{width:600,height:800,channels:3,background:'#ded0b8'}}).png().toBuffer();
    const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
    const objects=new Map(),audits=[];
    const config={bucket:'test-covers',baseUrl:'https://images.example.test'};
    let puts=0;
    const storage=createCoverStorage(config,{async send(command){
      const {Key,Body}=command.input;
      if(command.constructor.name==='PutObjectCommand'){puts++;objects.set(Key,Body);return {};}
      if(command.constructor.name==='DeleteObjectCommand'){objects.delete(Key);return {};}
      return {Body:{transformToByteArray:async()=>objects.get(Key)}};
    }});
    const services={mongoose,Book,Media,User,prepareCover,storage,config,lockBook,claimMedia,hash,newId:()=>String(new mongoose.Types.ObjectId()),checkWritable:async()=>{},writeAudit:async record=>{audits.push(structuredClone(record));},verifyImage:async(url,sha)=>assert.equal(hash(objects.get(new URL(url).pathname.slice(1))),sha)};
    const job=overrides=>({runId:'cover-'+crypto.randomUUID(),book:'同名书',author:'甲',apply:true,imageBase64:bytes.toString('base64'),sourceSha256:hash(bytes),...overrides});

    await t.test('preview does not write objects, media, audits or book versions',async()=>{
      const result=await uploadCover(job({apply:false}),services);
      assert.equal(result.status,'preview');assert.equal(puts,0);assert.equal(audits.length,0);assert.equal(await Media.countDocuments(),0);
      assert.equal((await Book.findById(first._id)).writeVersion,0);
    });
    await t.test('upload registers ownership and binds only the selected book',async()=>{
      const result=await uploadCover(job(),services);
      assert.equal(result.status,'bound');assert.equal(puts,2);
      const media=await Media.findOne({publicUrl:result.cover}),book=await Book.findById(first._id);
      assert.equal(String(media.owner),String(admin._id));assert.equal(media.referenceVersion,1);
      assert.equal(book.cover_image,result.cover);assert.equal(book.description,'Keep description');assert.equal(book.writeVersion,1);
      assert.equal(audits.at(-1).status,'bound');assert.equal(audits.at(-1).previousCover,'');
    });
    await t.test('same image is verified without re-upload or database writes',async()=>{
      const before=await Book.findById(first._id).lean(),auditCount=audits.length;
      const result=await uploadCover(job(),services);
      assert.equal(result.status,'unchanged');assert.equal(puts,2);assert.equal(audits.length,auditCount);
      assert.equal(await Media.countDocuments(),1);assert.deepEqual(await Book.findById(first._id).lean(),before);
    });
    const second=await Book.create({title:'同名书',author:'乙'});
    await t.test('duplicate titles require disambiguation; the same command handles another book by ID',async()=>{
      await assert.rejects(uploadCover(job({author:undefined}),services),/同名/);
      const result=await uploadCover(job({book:undefined,bookId:String(second._id),author:undefined}),services);
      assert.equal(result.bookId,String(second._id));assert.equal(result.status,'bound');assert.equal(await Media.countDocuments(),2);
      assert.notEqual((await Book.findById(first._id)).cover_image,result.cover);
    });
    const fresh=await Book.create({title:'新书',author:'丙'});
    const freshJob=()=>job({book:'新书',author:'丙'});
    await t.test('maintenance and byte tampering stop before uploading',async()=>{
      const count=puts;
      await assert.rejects(uploadCover(freshJob(),{...services,checkWritable:async()=>{throw Error('maintenance');}}),/maintenance/);
      await assert.rejects(uploadCover({...freshJob(),sourceSha256:'0'.repeat(64)},services),/字节/);
      assert.equal(puts,count);assert.equal((await Book.findById(fresh._id)).cover_image,'');
    });
    await t.test('public verification failure keeps the original cover',async()=>{
      await assert.rejects(uploadCover(freshJob(),{...services,verifyImage:async()=>{throw Error('CDN mismatch');}}),/CDN mismatch/);
      assert.equal(await Media.countDocuments(),2);assert.equal((await Book.findById(fresh._id)).writeVersion,0);
      assert.equal(audits.at(-1).status,'uploaded');
    });
    await t.test('failed ownership claim rolls back media and book version together',async()=>{
      await assert.rejects(uploadCover(freshJob(),{...services,claimMedia:async()=>null}),/归属/);
      assert.equal(await Media.countDocuments(),2);assert.equal((await Book.findById(fresh._id)).writeVersion,0);
    });
    await t.test('a concurrent cover change is preserved, never overwritten',async()=>{
      const anotherCover='/api/media/'+'a'.repeat(24);
      await assert.rejects(uploadCover(freshJob(),{...services,storage:{async write(...args){
        const stored=await storage.write(...args);
        await Book.updateOne({_id:fresh._id},{$set:{cover_image:anotherCover}});
        return stored;
      }}}),/其他任务/);
      const current=await Book.findById(fresh._id);
      assert.equal(current.cover_image,anotherCover);assert.equal(current.writeVersion,0);assert.equal(await Media.countDocuments(),2);
    });
    await t.test('a replacement keeps the previous media and unrelated book fields',async()=>{
      const before=await Book.findById(first._id).lean();
      const replacement=await sharp({create:{width:600,height:800,channels:3,background:'#536782'}}).png().toBuffer();
      const result=await uploadCover(job({imageBase64:replacement.toString('base64'),sourceSha256:hash(replacement)}),services);
      assert.equal(result.status,'bound');assert.notEqual(result.cover,before.cover_image);
      assert.ok(await Media.exists({publicUrl:before.cover_image,deleted:false}));
      const after=await Book.findById(first._id);
      assert.equal(after.writeVersion,before.writeVersion+1);assert.equal(after.description,before.description);assert.equal(after.author,before.author);
      assert.equal(audits.at(-1).previousCover,before.cover_image);
    });
  } finally {await mongoose.disconnect();await repl.stop();}
});
