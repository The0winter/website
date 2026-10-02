import '../../tools/test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import {TestDatabase} from '../database/testing.js';
import {createApp} from '../app.js';
import Book from '../models/Book.js';
import Chapter from '../models/Chapter.js';
import {prepareImport} from '../../infra/import-plan.mjs';
import {validateChapter} from '../services/content.js';
import {createChapterStorage,configureChapterStorage,readChapterBody} from '../services/chapter-storage.js';
import {importedChapterLimit} from '../../shared/chapter-limits.mjs';

test('long imported chapters survive R2 and API readback without relaxing author limits',async()=>{
  const db=await TestDatabase.create(),oldSecret=process.env.IMPORT_SECRET,oldStorage=process.env.CHAPTER_STORAGE;
  const objects=new Map();
  const storage=createChapterStorage({bucket:'synthetic',maxCacheBytes:0,client:{async send(command){
    const {Key,Body}=command.input;
    if(command.constructor.name==='PutObjectCommand'){objects.set(Key,Body);return {};}
    const content=objects.get(Key);return {ContentLength:Buffer.byteLength(content),Body:{transformToString:async()=>content}};
  }}});
  const chapter={chapter_number:1,title:'完整长篇',content:'甲'.repeat(importedChapterLimit)};
  const book={title:'长章测试',author:'合成作者',sourceUrl:'https://example.test/long-chapter',missingOnly:true,chapters:[chapter]};
  let server;
  try{
    process.env.IMPORT_SECRET=crypto.randomBytes(32).toString('hex');process.env.CHAPTER_STORAGE='r2';configureChapterStorage(storage);
    await mongoose.connect(db.getUri(),{autoIndex:false,autoCreate:false});
    for(const model of Object.values(mongoose.models))await model.createIndexes();
    server=createApp({mode:'test',jwtSecret:'x'.repeat(40),origins:['http://127.0.0.1:3000'],trustProxy:'none',writeMode:'readwrite'}).listen(0,'127.0.0.1');
    await new Promise(r=>server.once('listening',r));
    const base=`http://127.0.0.1:${server.address().port}`;
    const send=body=>fetch(base+'/api/admin/upload-book',{method:'POST',headers:{'content-type':'application/json','x-import-secret':process.env.IMPORT_SECRET},body:JSON.stringify(body)});
    assert.equal(prepareImport(book)[0].chapters[0].content,chapter.content);
    assert.throws(()=>validateChapter(chapter));
    assert.equal(validateChapter({...chapter,content:'甲'.repeat(60000)}).word_count,60000);
    assert.equal((await send({...book,missingOnly:false,dryRun:true})).status,200);
    assert.equal((await send({...book,dryRun:true})).status,200);assert.equal(await Book.countDocuments(),0);assert.equal(objects.size,0);
    assert.equal((await send(book)).status,200);
    const saved=await Chapter.findOne();assert.equal(saved.content,undefined);assert.equal(await readChapterBody(saved),chapter.content);
    const response=await fetch(base+'/api/chapters/'+saved._id);assert.equal(response.status,200);assert.equal((await response.json()).content,chapter.content);
    assert.equal((await send(book)).status,200);assert.equal(await Chapter.countDocuments(),1);
    const tooLong={...chapter,content:chapter.content+'乙'};
    assert.throws(()=>prepareImport({...book,chapters:[tooLong]}));
    assert.equal((await send({...book,chapters:[tooLong]})).status,400);
    await assert.rejects(storage.write(tooLong.content));
    objects.set(saved.contentKey,'篡改');await assert.rejects(storage.read(saved,{fresh:true}),/checksum/);
  }finally{
    if(server)await new Promise(r=>server.close(r));await mongoose.disconnect();await db.stop();configureChapterStorage(undefined);
    if(oldSecret===undefined)delete process.env.IMPORT_SECRET;else process.env.IMPORT_SECRET=oldSecret;
    if(oldStorage===undefined)delete process.env.CHAPTER_STORAGE;else process.env.CHAPTER_STORAGE=oldStorage;
  }
});
