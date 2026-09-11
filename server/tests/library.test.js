import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import {MongoMemoryReplSet} from 'mongodb-memory-server';
import {createApp} from '../app.js';
import {readConfig} from '../config.js';
import User from '../models/User.js';
import Book from '../models/Book.js';
import Chapter from '../models/Chapter.js';
import Bookmark from '../models/Bookmark.js';
import ReadingHistory from '../models/ReadingHistory.js';

test('library: durable progress, global sorting, pagination and private management', async () => {
  const repl = await MongoMemoryReplSet.create({binary: {version: '7.0.40'}, replSet: {count: 1, storageEngine: 'wiredTiger'}});
  const config = readConfig({APP_ENV: 'test', MONGO_URI: repl.getUri('test1_test'), JWT_SECRET: crypto.randomBytes(48).toString('hex')});
  await mongoose.connect(config.uri, {autoIndex: false});
  for (const model of Object.values(mongoose.models)) await model.createIndexes();
  const server = createApp(config).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const jar = new Map();
  async function request(path, method = 'GET', body, csrf = true) {
    const headers = {cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ')};
    if (method !== 'GET' && csrf) {
      const token = await request('/api/auth/csrf');
      headers['x-csrf-token'] = token.data.csrfToken; headers.origin = 'http://127.0.0.1:3000';
      headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    }
    if (body) headers['content-type'] = 'application/json';
    const response = await fetch(base + path, {method, headers, body: body ? JSON.stringify(body) : undefined});
    for (const cookie of response.headers.getSetCookie()) {const [k, ...v] = cookie.split(';')[0].split('='); jar.set(k, v.join('='));}
    return {status: response.status, data: await response.json(), headers: response.headers};
  }
  try {
    const user = await User.create({username: 'library-test', email: 'shelf@example.test', password: await bcrypt.hash('Test-password-123', 10)});
    const root = `/api/users/${user._id}`;
    assert.equal((await request(root + '/library')).status, 401);
    assert.equal((await request('/api/auth/signin', 'POST', {email: user.email, password: 'Test-password-123'})).status, 200);
    const books = await Book.insertMany(Array.from({length: 25}, (_, i) => ({title: `Book ${i}`, lastUpdated: new Date(1000 + i)})));
    await Bookmark.insertMany(books.map(book => ({user_id: user._id, bookId: book._id})));
    const chapter = await Chapter.create({bookId: books[0]._id, title: 'Read chapter', content: 'Private body should not appear in shelf', chapter_number: 1});
    await Chapter.create({bookId: books[0]._id, title: 'Latest chapter', content: 'More body', chapter_number: 2});
    const body = {bookId: String(books[0]._id), chapterId: String(chapter._id)};
    assert.equal((await request(root + '/history', 'POST', body, false)).status, 403);
    assert.equal((await request('/api/users/000000000000000000000001/library')).status, 403);
    assert.equal((await request('/api/users/000000000000000000000001/history', 'POST', body)).status, 403);
    assert.equal((await request(root + '/history', 'POST', {...body, bookId: String(books[1]._id)})).status, 404);
    assert.equal((await request(root + '/history', 'POST', body)).status, 200);
    await request(root + '/history', 'POST', {bookId: body.bookId});
    assert.equal(await ReadingHistory.countDocuments({userId: user._id}), 1);
    assert.equal(String((await ReadingHistory.findOne({userId: user._id})).chapterId), body.chapterId);
    const shelf = await request(root + '/library');
    assert.equal(shelf.status, 200); assert.equal(shelf.headers.get('x-total-count'), '25');
    assert.equal(shelf.data.length, 20); assert.equal(shelf.data[0].bookId, body.bookId);
    assert.equal(shelf.data[0].chapterTitle, 'Read chapter'); assert.equal(shelf.data[0].latestChapterTitle, 'Latest chapter');
    assert.equal(JSON.stringify(shelf.data).includes('Private body'), false);
    const updated = await request(root + '/library?sort=updated');
    assert.equal(updated.data[0].bookId, String(books[24]._id));
    const second = await request(root + '/library?sort=updated&page=2');
    assert.equal(second.data.length, 5); assert.equal(second.data[4].bookId, body.bookId);
    assert.equal((await request(root + '/library?sort=read')).data[0].bookId, body.bookId);
    // A new chapter update can move an unread book ahead of the recently read book.
    await Book.updateOne({_id: books[1]._id}, {$set: {lastUpdated: new Date(Date.now() + 1000)}});
    assert.equal((await request(root + '/library')).data[0].bookId, String(books[1]._id));
    assert.equal((await request(root + '/library?sort=read')).data[0].bookId, body.bookId);
    assert.equal((await request(root + '/library?sort=invalid')).status, 400);
    assert.equal((await request(root + '/library?page=0')).status, 400);
    await Book.updateOne({_id: books[1]._id}, {$set: {deletedAt: new Date()}});
    const unavailable = (await request(root + '/library')).data[0];
    assert.equal(unavailable.book, null); assert.equal(unavailable.bookId, String(books[1]._id));
    assert.equal((await request(root + '/library?tab=history')).data[0].chapterId, body.chapterId);
    await request(root + '/bookmarks/' + body.bookId, 'DELETE');
    assert.equal((await request(root + '/library?tab=history')).data.length, 1);
    await request(root + '/history/' + body.bookId, 'DELETE');
    assert.equal((await request(root + '/library?tab=history')).data.length, 0);
    assert.equal(await Bookmark.countDocuments({user_id: user._id}), 24);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect(); await repl.stop();
  }
});
