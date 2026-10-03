import '../../tools/test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import {TestDatabase} from '../database/testing.js';
import {createApp} from '../app.js';
import {readConfig} from '../config.js';
import User from '../models/User.js';
import Book from '../models/Book.js';
import Chapter from '../models/Chapter.js';
import ReadingHistory from '../models/ReadingHistory.js';
import {readerParagraphs} from '../../shared/reader-paragraphs.mjs';

test('paragraph progress: CAS, replay, rereading, tombstones, legacy compatibility and permissions', async () => {
  const db = await TestDatabase.create();
  const config = readConfig({APP_ENV: 'test', DATABASE_URL: db.getUri(), JWT_SECRET: crypto.randomBytes(48).toString('hex')});
  await mongoose.connect(config.uri, {autoIndex: false});
  for (const model of Object.values(mongoose.models)) await model.createIndexes();
  const server = createApp(config).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const jar = new Map();
  async function request(path, method = 'GET', body, csrf = true) {
    const headers = {};
    if (method !== 'GET' && csrf) {
      const token = await request('/api/auth/csrf');
      headers['x-csrf-token'] = token.data.csrfToken; headers.origin = 'http://127.0.0.1:3000';
    }
    headers.cookie = [...jar].map(([key, value]) => `${key}=${value}`).join('; ');
    if (body) headers['content-type'] = 'application/json';
    const response = await fetch(base + path, {method, headers, body: body ? JSON.stringify(body) : undefined});
    for (const cookie of response.headers.getSetCookie()) {
      const [key, ...value] = cookie.split(';')[0].split('='); jar.set(key, value.join('='));
    }
    return {status: response.status, data: await response.json()};
  }
  try {
    const user = await User.create({username: 'position-reader', email: 'position@example.test', password: await bcrypt.hash('test-password-123', 10)});
    const book = await Book.create({title: '位置测试'});
    const content = '第一章 开始\n　第一段😀混排 English 123。\n重复段落\n重复段落\n最后一段';
    const first = await Chapter.create({bookId: book._id, title: '第一章 开始', chapter_number: 1, content});
    const last = await Chapter.create({bookId: book._id, title: '第二章', chapter_number: 2, content: '次章正文'});
    const url = `/api/v1/me/reading-progress/${book._id}`;
    assert.equal((await request(url)).status, 401);
    assert.equal((await request('/api/auth/signin', 'POST', {email: user.email, password: 'test-password-123'})).status, 200);
    assert.deepEqual((await request(url)).data, {revision: 0, position: null, furthest: null, deleted: false, deviceId: null, updatedAt: null});
    const body = (chapter, revision = 0, offset = 0) => ({baseRevision: revision, deviceId: 'android-test-device', operationId: crypto.randomUUID(),
      position: {chapterId: String(chapter._id), contentVersion: crypto.createHash('sha256').update(chapter.content).digest('hex'),
        paragraphKey: readerParagraphs(chapter.content, chapter.title, chapter.chapter_number)[0].key, charOffset: offset}});
    const original = body(first, 0, 3);
    assert.equal((await request(url, 'PUT', original, false)).status, 403);
    const saved = await request(url, 'PUT', original);
    assert.equal(saved.status, 200); assert.equal(saved.data.revision, 1); assert.equal(saved.data.position.charOffset, 3);
    assert.equal((await request(url.replace(String(book._id), String(book._id).toUpperCase()))).data.revision, 1);
    assert.equal(String((await ReadingHistory.findOne({userId: user._id})).chapterId), String(first._id));
    assert.deepEqual(await request(url, 'PUT', original), saved, 'a network retry returns the exact original operation');
    const reuse = await request(url, 'PUT', {...original, position: {...original.position, charOffset: 0}});
    assert.equal(reuse.status, 409); assert.equal(reuse.data.code, 'OPERATION_REUSED');
    const stale = await request(url, 'PUT', body(last, 0));
    assert.equal(stale.status, 409); assert.equal(stale.data.current.revision, 1);
    assert.equal((await request(url, 'PUT', body(first, 1, 4))).data.code, 'INVALID_ANCHOR', 'reject half-surrogate offset');
    const forward = await request(url, 'PUT', body(last, 1)); assert.equal(forward.data.revision, 2);
    const reread = await request(url, 'PUT', body(first, 2));
    assert.equal(reread.data.position.chapterId, String(first._id));
    assert.equal(reread.data.furthest.chapterId, String(last._id));
    await request(`/api/users/${user._id}/history`, 'POST', {bookId: String(book._id), chapterId: String(first._id)});
    assert.equal((await request(url)).data.revision, 3, 'same chapter legacy visit preserves exact anchor');
    await request(`/api/users/${user._id}/history`, 'POST', {bookId: String(book._id), chapterId: String(last._id)});
    const legacy = (await request(url)).data;
    assert.equal(legacy.revision, 4); assert.equal(legacy.position.paragraphKey, null);
    const changed = body(first, 4); await Chapter.updateOne({_id: first._id}, {$set: {content: content + '\n更新正文'}});
    const changedResult = await request(url, 'PUT', changed);
    assert.equal(changedResult.status, 409); assert.equal(changedResult.data.code, 'CONTENT_CHANGED');
    const deletion = {baseRevision: 4, operationId: crypto.randomUUID(), deviceId: 'android-test-device'};
    assert.equal((await request(url, 'DELETE', deletion)).data.revision, 5);
    assert.equal(await ReadingHistory.countDocuments({userId: user._id}), 0);
    assert.equal((await request(url, 'PUT', body(last, 4))).data.code, 'PROGRESS_CONFLICT');
    assert.equal((await request(url)).data.deleted, true);
    assert.equal((await request(url, 'PUT', body(last, 5))).data.revision, 6);
    await request(`/api/users/${user._id}/history/${book._id}`, 'DELETE');
    assert.equal((await request(url)).data.revision, 7);
    assert.equal((await request(url)).data.deleted, true);
    await Book.updateOne({_id: book._id}, {$set: {visibility: 'private'}});
    assert.equal((await request(url)).status, 404);
    assert.equal((await request(url, 'PUT', body(last, 7))).status, 404);
    await Book.updateOne({_id: book._id}, {$set: {author_id: user._id}});
    assert.equal((await request(url, 'PUT', body(last, 7))).status, 200, 'owner may resume private work');
    await Book.updateOne({_id: book._id}, {$set: {deletedAt: new Date()}});
    assert.equal((await request(url)).status, 404);
    assert.equal((await request(url, 'DELETE', {...deletion, baseRevision: 8, operationId: crypto.randomUUID()})).status, 200, 'removed work can still be cleared');
  } finally {
    await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); await db.stop();
  }
});
