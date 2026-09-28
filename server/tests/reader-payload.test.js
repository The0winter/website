import '../../tools/test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import {TestDatabase} from '../database/testing.js';
import {connectDatabase} from '../database/index.js';
import {createApp} from '../app.js';
import {readConfig} from '../config.js';
import Book from '../models/Book.js';
import Chapter from '../models/Chapter.js';
import User from '../models/User.js';
import Session from '../models/Session.js';
import {bookReadingIndex} from '../services/book-reading-index.js';

test('reader bundle preserves content and live metadata, projects before transfer, and rechecks private access', async () => {
  const db = await TestDatabase.create();
  await connectDatabase(db.getUri());
  const config = readConfig({APP_ENV: 'test', DATABASE_URL: db.getUri(), JWT_SECRET: crypto.randomBytes(48).toString('hex')});
  const app = createApp(config), server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const users = await User.create(['owner', 'stranger', 'admin'].map((name, i) => ({username: name,
      email: name + '@reader.test', password: 'unused', role: i === 2 ? 'admin' : 'reader'})));
    const cookies = await Promise.all(users.map(async user => {
      const sid = crypto.randomBytes(32).toString('hex');
      await Session.create({_id: sid, userId: user._id, authVersion: 0, expiresAt: new Date(Date.now() + 3600000)});
      return 'session=' + jwt.sign({id: String(user._id), sid}, config.jwtSecret, {expiresIn: 3600});
    }));
    const book = await Book.create({title: 'Readable book', author: 'Author', author_id: users[0]._id,
      description: '长简介'.repeat(1000), cover_image: '/cover.png',
      statisticsSeed: {runId: 'audit'.repeat(500), views: 900, favorites: 100, rating: 4, ratingWeight: 20, initializedAt: new Date()}});
    const chapter = await Chapter.create({bookId: book._id, title: '正文', content: '完整的章节正文。\n第二段。', chapter_number: 7, word_count: 14});
    const bookPath = `/books/${book._id}`, bodyPath = `/chapters/${chapter._id}?navigation=1`, bundlePath = bodyPath + '&reader=1';
    const request = async (path, status = 200, cookie = '') => {
      const response = await fetch(base + path, {headers: {cookie}});
      const data = await response.json();
      assert.equal(response.status, status, JSON.stringify(data));
      return data;
    };
    const plain = await request(bodyPath);
    const client = mongoose.connection.transport ? null : mongoose.connection.getClient(), commands = [], replies = [];
    const started = event => commands.push(event.command);
    const succeeded = event => replies.push(mongoose.mongo.BSON.calculateObjectSize(event.reply));
    client?.on('commandStarted', started); client?.on('commandSucceeded', succeeded);
    let bundle;
    try {bundle = await request(bundlePath);} finally {client?.off('commandStarted', started); client?.off('commandSucceeded', succeeded);}
    assert.deepEqual(bundle.chapter, plain);
    assert.deepEqual(bundle.book, {id: String(book._id), title: book.title, author: book.author,
      cover_image: book.cover_image, category: book.category, status: book.status, writeVersion: 0});
    assert.deepEqual(await request(bookPath + '?fields=reader'), bundle.book);
    if (client) {
      assert.equal(commands.length, 1, 'warm bundle uses one database command');
      const projection = commands[0].pipeline.find(stage => stage.$lookup).$lookup.pipeline[0].$project;
      assert.ok(projection.title && projection.writeVersion && projection.visibility);
      assert.equal(projection.description, undefined); assert.equal(projection.statisticsSeed, undefined);
      assert.ok(replies[0] < 2000, 'large book detail/audit fields never leave MongoDB for reading');
    }
    assert.equal((await request(bookPath)).description, book.description, 'full details remain available');
    // Metadata changes do not always advance writeVersion; never cache them with the index.
    await Book.updateOne({_id: book._id}, {$set: {title: 'Live title', author: 'Live author'}});
    assert.equal((await request(bundlePath)).book.title, 'Live title');
    assert.equal((await request(bookPath + '?fields=reader')).author, 'Live author');
    await Book.updateOne({_id: book._id}, {$set: {visibility: 'private'}});
    for (const path of [bodyPath, bundlePath, bookPath + '?fields=reader']) {
      await request(path, 404); await request(path, 404, cookies[1]);
      await request(path, 200, cookies[0]); await request(path, 200, cookies[2]);
    }
    await User.updateOne({_id: users[0]._id}, {$set: {isBanned: true}});
    await request(bundlePath, 404, cookies[0]);
    await Chapter.updateOne({_id: chapter._id}, {$set: {deletedAt: new Date()}});
    await request(bundlePath, 404, cookies[2]);
    await Chapter.updateOne({_id: chapter._id}, {$set: {deletedAt: null}});
    await Book.updateOne({_id: book._id}, {$set: {visibility: 'public', deletedAt: new Date()}});
    await request(bundlePath, 404); await request(bookPath + '?fields=reader', 404);
    await Book.deleteOne({_id: book._id});
    await request(bundlePath, 404);
    await request(`/chapters/${new mongoose.Types.ObjectId()}?reader=1`, 404);
  } finally {
    app.locals.stopWritingCleanup(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); await db.stop();
  }
});

test('packed MongoDB navigation preserves order across chunks with less than half the previous reply bytes', {skip: process.env.TEST_DATABASE_BACKEND !== 'mongodb'}, async () => {
  const db = await TestDatabase.create(); await connectDatabase(db.getUri());
  try {
    await Book.createIndexes(); await Chapter.createIndexes();
    const book = await Book.create({title: 'Packed navigation'});
    await Chapter.insertMany(Array.from({length: 2201}, (_, i) => ({bookId: book._id,
      title: 'Chapter ' + i, chapter_number: i * 2 + 1, content: '内容',
      word_count: i % 7, deletedAt: i % 17 === 0 ? new Date() : null})));
    const client = mongoose.connection.getClient(); let bytes = 0;
    const measure = event => {bytes += mongoose.mongo.BSON.calculateObjectSize(event.reply);};
    client.on('commandSucceeded', measure);
    try {
      const rows = await Chapter.find({bookId: book._id, deletedAt: null}).select('_id word_count').sort({chapter_number: 1}).lean();
      const previousBytes = bytes; bytes = 0;
      const packed = await bookReadingIndex(book._id, 0), packedBytes = bytes;
      assert.deepEqual(packed.ids, rows.map(row => String(row._id)));
      assert.equal(packed.totalWords, rows.reduce((total, row) => total + row.word_count, 0));
      for (const [i, id] of packed.ids.entries()) assert.equal(packed.indices.get(id), i);
      assert.ok(packedBytes < previousBytes / 2, `${packedBytes} vs ${previousBytes}`);
      bytes = 0; await bookReadingIndex(book._id, 0); assert.equal(bytes, 0, 'warm index requires no transfer');
    } finally {client.off('commandSucceeded', measure);}
  } finally {await mongoose.disconnect(); await db.stop();}
});
