import '../../tools/test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import {TestDatabase} from '../database/testing.js';
import {createApp} from '../app.js';
import Book from '../models/Book.js';
import Chapter from '../models/Chapter.js';
import User from '../models/User.js';
import Bookmark from '../models/Bookmark.js';
import {createChapter} from '../services/content.js';
import {recordBookUpdate} from '../services/book-update-time.js';
import {inspectBookUpdateTimes} from '../../infra/repair-book-update-times.mjs';

const old = new Date('2020-01-01T00:00:00Z');
const chapter = n => ({chapter_number: n, title: `第${n}章`, content: `正文 ${n}`});

test('real publications drive detail, shelf and recent sorting; retries and unrelated writes preserve time', async () => {
  const db = await TestDatabase.create(), oldSecret = process.env.IMPORT_SECRET;
  process.env.IMPORT_SECRET = crypto.randomBytes(32).toString('hex');
  let server;
  try {
    await mongoose.connect(db.getUri(), {autoIndex: false, autoCreate: false});
    for (const model of Object.values(mongoose.models)) await model.createIndexes();
    server = createApp({mode: 'test', jwtSecret: 'x'.repeat(40), origins: ['http://127.0.0.1:3000'], trustProxy: 'none', writeMode: 'readwrite'}).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`, jar = new Map();
    async function request(url, method = 'GET', data, imported = false) {
      const headers = {'content-type': 'application/json'};
      if (imported) headers['x-import-secret'] = process.env.IMPORT_SECRET;
      else if (method !== 'GET') {
        headers['x-csrf-token'] = (await request('/api/auth/csrf')).data.csrfToken;
        headers.origin = 'http://127.0.0.1:3000';
      }
      if (!imported) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
      const response = await fetch(base + url, {method, headers, body: data ? JSON.stringify(data) : undefined});
      for (const cookie of response.headers.getSetCookie()) {const [k, ...v] = cookie.split(';')[0].split('='); jar.set(k, v.join('='));}
      return {status: response.status, data: await response.json()};
    }
    const user = await User.create({username: 'update-check', email: 'update@example.test', role: 'admin', password: await bcrypt.hash('test-password-123', 10)});
    assert.equal((await request('/api/auth/signin', 'POST', {email: user.email, password: 'test-password-123'})).status, 200);
    for (const missingOnly of [false, true]) {
      const identity = {title: `时间测试 ${missingOnly}`, author: '作者', sourceUrl: `https://example.test/times/${missingOnly}`, missingOnly};
      const upload = (chapters, extra = {}) => request('/api/admin/upload-book', 'POST', {...identity, chapters, ...extra}, true);
      const initial = await upload([chapter(1)]);
      assert.equal(initial.status, 200);
      const id = initial.data.bookId;
      const time = async () => +(await Book.findById(id).lean()).lastUpdated;
      await Book.updateOne({_id: id}, {$set: {lastUpdated: old}}, {timestamps: false});
      assert.equal((await upload([chapter(1)], {description: '新简介'})).status, 200);
      assert.equal(await time(), +old);
      assert.equal((await upload([chapter(2)], {dryRun: true})).status, 200);
      assert.equal(await time(), +old);
      const began = Date.now();
      assert.equal((await upload([chapter(2)])).data.inserted, 1);
      assert.ok(await time() >= began);
      const actual = await time();
      assert.equal((await upload([chapter(2)])).data.unchanged, 1);
      assert.equal((await upload([chapter(3), {...chapter(1), content: '冲突'}])).status, 409);
      assert.equal(await time(), actual);
      assert.equal(await Chapter.countDocuments({bookId: id}), 2);
      const first = await Chapter.findOne({bookId: id, chapter_number: 1});
      if (!missingOnly) {
        assert.equal((await upload([{...chapter(1), link: 'https://example.test/ch/1'}])).data.enriched, 1);
        assert.equal(await time(), actual);
      }
      assert.equal((await request('/api/books/' + id + '/views', 'POST', {chapterId: String(first._id)})).status, 200);
      assert.equal((await request('/api/books/' + id + '/reviews', 'POST', {rating: 4})).status, 201);
      assert.equal((await request('/api/books/' + id, 'PATCH', {description: '仅改简介'})).status, 200);
      assert.equal(await time(), actual);
      await Bookmark.create({user_id: user._id, bookId: id});
      const detail = await request('/api/books/' + id);
      const shelf = await request(`/api/users/${user._id}/library?sort=updated`);
      assert.equal(+new Date(detail.data.lastUpdated), actual);
      assert.equal(+new Date(shelf.data.find(row => row.bookId === id).book.lastUpdated), actual);
      await Book.updateOne({_id: id}, {$set: {lastUpdated: old}}, {timestamps: false});
      await createChapter({role: 'import'}, id, chapter(3));
      assert.ok(await time() > +old);
      const created = await time();
      await createChapter({role: 'import'}, id, chapter(3));
      assert.equal(await time(), created);
      await Book.updateOne({_id: id}, {$set: {lastUpdated: old}}, {timestamps: false});
      assert.equal((await request('/api/chapters/' + first._id, 'PATCH', {content: first.content})).status, 200);
      assert.equal(await time(), +old);
      assert.equal((await request('/api/chapters/' + first._id, 'PATCH', {content: '真正修改正文'})).status, 200);
      assert.ok(await time() > +old);
    }
    const decoy = await Book.create({title: '最近被浏览但没有续更', lastUpdated: old, updatedAt: new Date('2099-01-01')});
    const recent = await request('/api/books?orderBy=updatedAt&order=desc');
    assert.equal(recent.data.at(-1).id, String(decoy._id));
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect(); await db.stop();
    if (oldSecret === undefined) delete process.env.IMPORT_SECRET; else process.env.IMPORT_SECRET = oldSecret;
  }
});

test('historical repair uses chapter publication evidence, ignores maintenance time, and cannot overwrite newer updates', async () => {
  const db = await TestDatabase.create();
  try {
    await mongoose.connect(db.getUri(), {autoIndex: false, autoCreate: false});
    const book = await Book.create({title: '旧记录', lastUpdated: old});
    const published = new Date('2021-02-03T10:00:00Z');
    await Chapter.create({...chapter(1), bookId: book._id, createdAt: published, published_at: published, updatedAt: new Date('2025-01-01')});
    const report = await inspectBookUpdateTimes();
    assert.equal(report.plan.length, 1);
    assert.equal(+report.plan[0].after, +published);
    const updatedAt = +(await Book.findById(book._id)).updatedAt;
    await recordBookUpdate(book._id, null, report.plan[0].after);
    assert.equal((await inspectBookUpdateTimes()).plan.length, 0);
    assert.equal(+(await Book.findById(book._id)).updatedAt, updatedAt);
    const fresh = new Date();
    await recordBookUpdate(book._id, null, fresh);
    await recordBookUpdate(book._id, null, published);
    assert.equal(+(await Book.findById(book._id)).lastUpdated, +fresh);
    await assert.rejects(mongoose.connection.transaction(async session => {
      await recordBookUpdate(book._id, session, new Date(+fresh + 1000));
      throw Error('rollback');
    }), /rollback/);
    assert.equal(+(await Book.findById(book._id)).lastUpdated, +fresh);
  } finally {await mongoose.disconnect(); await db.stop();}
});
