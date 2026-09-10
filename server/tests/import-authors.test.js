import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import {MongoMemoryReplSet} from 'mongodb-memory-server';
import {createApp} from '../app.js';
import Author from '../models/Author.js';
import Book from '../models/Book.js';
import Chapter from '../models/Chapter.js';
import User from '../models/User.js';
import {prepareImport} from '../../infra/import-plan.mjs';

const sample={title:'测试书',author:'同名作者',sourceUrl:'https://example.test/books/1',description:'简介',status:'完结',cover_image:'https://example.test/cover.jpg',chapters:[{chapter_number:1,title:'第一章',content:'测试正文'}]};
test('whole-file preflight catches cross-batch duplicates and bad final chapters',()=>{
 const chapters=Array.from({length:21},(_,i)=>({...sample.chapters[0],chapter_number:i+1}));
 assert.equal(prepareImport({...sample,chapters}).length,2);
 assert.throws(()=>prepareImport({...sample,chapters:[...chapters,chapters[0]]}),/重复/);
 assert.throws(()=>prepareImport({...sample,chapters:[...chapters,{chapter_number:22,title:'bad',content:''}]}),/正文/);
});
test('import attribution, metadata, replay, rollback and account separation',async()=>{
 const repl=await MongoMemoryReplSet.create({binary:{version:'7.0.40'},replSet:{count:1}});
 const oldSecret=process.env.IMPORT_SECRET;process.env.IMPORT_SECRET=crypto.randomBytes(32).toString('hex');
 let server;
 try{
  await mongoose.connect(repl.getUri('test1_test'),{autoIndex:false,autoCreate:false});
  for(const model of Object.values(mongoose.models))await model.createIndexes();
  await User.create({username:sample.author,email:'same@example.test',password:'not-a-login-hash'});
  server=createApp({mode:'test',jwtSecret:'x'.repeat(40),origins:['http://127.0.0.1:3000'],trustProxy:'none',writeMode:'readwrite'}).listen(0,'127.0.0.1');
  await new Promise(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  const send=async body=>{const r=await fetch(base+'/api/admin/upload-book',{method:'POST',headers:{'content-type':'application/json','x-import-secret':process.env.IMPORT_SECRET},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
  assert.equal((await send({...sample,dryRun:true})).status,200);
  assert.equal(await Author.countDocuments(),0);assert.equal(await Book.countDocuments(),0);
  assert.equal((await send(sample)).status,200);
  const book=await Book.findOne();assert.equal(book.author_id,undefined);assert.ok(book.author_profile_id);
  assert.equal(book.description,sample.description);assert.equal(book.status,'完结');assert.equal(book.cover_image,sample.cover_image);
  assert.equal((await send(sample)).data.unchanged,1);
  assert.equal(await Author.countDocuments(),1);assert.equal(await User.countDocuments(),1);assert.equal(await Chapter.countDocuments(),1);
  const profile=await (await fetch(base+'/api/authors/'+book.author_profile_id)).json();assert.equal(profile.username,sample.author);
  const books=await (await fetch(base+'/api/books?author_id='+book.author_profile_id)).json();assert.equal(books.length,1);
  assert.equal((await send({...sample,description:'must rollback',chapters:[{...sample.chapters[0],content:'conflict'}]})).status,409);
  assert.equal((await Book.findById(book._id)).description,sample.description);
  assert.equal((await send({...sample,author:'different'})).status,409);
  await send({...sample,sourceUrl:'https://example.test/books/2'});assert.equal(await Author.countDocuments(),2);
  for(const n of [3,4])assert.equal((await send({...sample,sourceUrl:`https://example.test/books/${n}`,authorSourceUrl:'https://example.test/authors/1'})).status,200);
  assert.equal(await Author.countDocuments(),3);
  assert.equal(await User.countDocuments(),1);
 }finally{
  if(server)await new Promise(r=>server.close(r));await mongoose.disconnect();await repl.stop();
  if(oldSecret===undefined)delete process.env.IMPORT_SECRET;else process.env.IMPORT_SECRET=oldSecret;
 }
});
