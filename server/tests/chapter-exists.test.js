import '../../tools/test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import {TestDatabase} from '../database/testing.js';
import {connectDatabase} from '../database/index.js';
import {createApp} from '../app.js';
import {readConfig} from '../config.js';
import Book from '../models/Book.js';
import Chapter from '../models/Chapter.js';
import {bookCatalog} from '../services/catalog-volumes.js';

test('chapter document preflight uses one projected lookup and preserves ownership, deletion and private access', async t => {
  const db=await TestDatabase.create();await connectDatabase(db.getUri());
  const config=readConfig({APP_ENV:'test',DATABASE_URL:db.getUri(),JWT_SECRET:crypto.randomBytes(40).toString('hex')});
  const server=createApp(config).listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  try {
    const book=await Book.create({title:'Public',author:'A'}),other=await Book.create({title:'Other',author:'A'});
    const chapter=await Chapter.create({bookId:book._id,title:'Chapter',chapter_number:1,content:'Private body never returned'});
    const query=Chapter.findOne.bind(Chapter);let calls=0;
    t.mock.method(Chapter,'find',()=>{throw Error('Must not load the full catalog');});
    t.mock.method(Chapter,'findOne',(...args)=>{calls++;return query(...args);});
    const get=bookId=>fetch(`http://127.0.0.1:${server.address().port}/api/books/${bookId}/chapter-exists/${chapter._id}`);
    const response=await get(book._id);assert.equal(response.status,200);assert.deepEqual(await response.json(),{exists:true});assert.equal(calls,1);
    assert.equal((await get(other._id)).status,404);
    await Chapter.updateOne({_id:chapter._id},{$set:{deletedAt:new Date()}});assert.equal((await get(book._id)).status,404);
    await Chapter.updateOne({_id:chapter._id},{$set:{deletedAt:null}});
    await Book.updateOne({_id:book._id},{$set:{visibility:'private'}});assert.equal((await get(book._id)).status,404);
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await mongoose.disconnect();await db.stop();}
});

test('chapter preflight reuses a current catalog but rechecks edits and private access', async t => {
  const db=await TestDatabase.create();await connectDatabase(db.getUri());
  const config=readConfig({APP_ENV:'test',DATABASE_URL:db.getUri(),JWT_SECRET:crypto.randomBytes(40).toString('hex')});
  const server=createApp(config).listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  try {
    const book=await Book.create({title:'Cached book',author:'A',writeVersion:0});
    const chapter=await Chapter.create({bookId:book._id,title:'Chapter',chapter_number:1,content:'Body'});
    await bookCatalog(String(book._id),'0');
    const query=Chapter.findOne.bind(Chapter);let calls=0;
    t.mock.method(Chapter,'find',()=>{throw Error('Existence checks must not refresh a full catalog');});
    t.mock.method(Chapter,'findOne',(...args)=>{calls++;return query(...args);});
    const get=id=>fetch(`http://127.0.0.1:${server.address().port}/api/books/${book._id}/chapter-exists/${id}`);
    assert.equal((await get(chapter._id)).status,200);assert.equal(calls,0);
    assert.equal((await get(new mongoose.Types.ObjectId())).status,404);assert.equal(calls,0);
    await Chapter.updateOne({_id:chapter._id},{$set:{deletedAt:new Date()}});
    await Book.updateOne({_id:book._id},{$inc:{writeVersion:1}});
    assert.equal((await get(chapter._id)).status,404);assert.equal(calls,1);
    await Book.updateOne({_id:book._id},{$set:{visibility:'private'}});
    assert.equal((await get(chapter._id)).status,404);assert.equal(calls,1);
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await mongoose.disconnect();await db.stop();}
});
