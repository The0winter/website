import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {MongoMemoryReplSet} from 'mongodb-memory-server';
import {inventory} from '../migrations/inventory.js';
import Book from '../models/Book.js';
import Chapter from '../models/Chapter.js';
test('migration inventory preserves legacy bytes and reports conflicts before index creation',async()=>{
  const replica=await MongoMemoryReplSet.create({binary:{version:'7.0.40'},replSet:{count:1,storageEngine:'wiredTiger'}});
  await mongoose.connect(replica.getUri('test1_test'),{autoIndex:false,autoCreate:false,serverSelectionTimeoutMS:5000});
  try{
    const clean=await inventory(mongoose.connection,mongoose.models);assert.deepEqual(clean.issues,[]);
    for(const model of Object.values(mongoose.models))await model.createIndexes();
    const indexed=await inventory(mongoose.connection,mongoose.models);assert.deepEqual(indexed.issues,[]);
    for(const model of Object.values(mongoose.models))await model.createIndexes();
    assert.equal((await inventory(mongoose.connection,mongoose.models)).fingerprint,indexed.fingerprint);
    const book=await Book.create({title:'Preserved original'});
    await Chapter.collection.insertOne({bookId:book._id,chapter_number:'old-format',title:'Legacy title',content:'Original bytes'});
    await Chapter.collection.insertOne({bookId:new mongoose.Types.ObjectId(),chapter_number:1,title:'Orphan title',content:'Keep until mapping review'});
    await Book.collection.createIndex({title:1},{unique:true,name:'legacy_unique_title'});
    const before=await Chapter.collection.find().toArray();
    const report=await inventory(mongoose.connection,mongoose.models);
    assert.ok(report.issues.some(i=>i.type==='invalid-chapter-fields'&&i.count===1));
    assert.ok(report.issues.some(i=>i.type==='missing-reference'&&i.collection==='chapters'&&i.count===1));
    assert.ok(report.issues.some(i=>i.type==='index-review'&&i.names.includes('legacy_unique_title')));
    assert.deepEqual(await Chapter.collection.find().toArray(),before);
    assert.ok((await Book.collection.indexes()).some(i=>i.name==='legacy_unique_title'));
  }finally{await mongoose.disconnect();await replica.stop();}
});
