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
import ChapterDraft from '../models/ChapterDraft.js';
import Manuscript from '../models/Manuscript.js';
import WriterPublication from '../models/WriterPublication.js';
import {dayKey} from '../services/content.js';

test('chapter workspace preserves cloud drafts, ownership, quota and publication receipts', async t => {
  const repl = await MongoMemoryReplSet.create({binary: {version: '7.0.40'}, replSet: {count: 1, storageEngine: 'wiredTiger'}});
  const config = readConfig({APP_ENV: 'test', MONGO_URI: repl.getUri('test1_test'), JWT_SECRET: crypto.randomBytes(48).toString('hex')});
  await mongoose.connect(config.uri, {autoIndex: false});
  for (const model of Object.values(mongoose.models)) await model.createIndexes();
  const server = createApp(config).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  function client() {
    const jar = new Map();
    async function request(path, method = 'GET', data, csrf = true) {
      const headers = {};
      if (method !== 'GET' && csrf) {
        headers.origin = 'http://127.0.0.1:3000';
        headers['x-csrf-token'] = (await request('/api/auth/csrf')).data.csrfToken;
      }
      headers.cookie = [...jar].map(([key, value]) => `${key}=${value}`).join('; ');
      if (data) headers['content-type'] = 'application/json';
      const response = await fetch(base + path, {method, headers, body: data && JSON.stringify(data)});
      for (const cookie of response.headers.getSetCookie()) {const [key, ...value] = cookie.split(';')[0].split('='); jar.set(key, value.join('='));}
      return {status: response.status, data: await response.json()};
    }
    return request;
  }
  try {
    const password = await bcrypt.hash('Writing-test-123', 10);
    const [user, stranger] = await User.create([{username: '写作者', email: 'writer@example.test', password}, {username: '其他人', email: 'other@example.test', password}]);
    const owner = client(), other = client(), guest = client();
    for (const [request, account] of [[owner, user], [other, stranger]]) assert.equal((await request('/api/auth/signin', 'POST', {email: account.email, password: 'Writing-test-123'})).status, 200);
    const key = crypto.randomUUID(), path = `/api/writer/workspace/m_${key}`;
    const original = [{title: '来信', content: '第一章旧正文。', sourceNumber: 1, volumeTitle: '第一卷', volumeNumber: 1}, {title: '远行', content: '第二章旧正文。', sourceNumber: 2, volumeTitle: '第一卷', volumeNumber: 1}];
    await Manuscript.create({_id: `${user.id}:${key}`, owner: user.id, title: '山海来信', description: '作品简介', revision: 1, chapters: original});
    let bookId, firstId;
    await t.test('reads are private and reject guests, other owners and invalid references', async () => {
      assert.equal((await guest(path)).status, 401);
      assert.equal((await other(path)).status, 404);
      assert.equal((await owner('/api/writer/workspace/b_bad')).status, 400);
      const result = await owner(path);
      assert.equal(result.status, 200); assert.equal(result.data.maxNumber, 2);
      assert.deepEqual(result.data.cloudDrafts.map(row => row.content), original.map(row => row.content));
      assert.equal(await Book.countDocuments(), 0);
    });
    await t.test('publishes only the selected chapter and deduplicates concurrent retries', async () => {
      const data = {id: 'manuscript-1', title: '远行', content: '第二章更新正文。', number: 2};
      assert.equal((await owner(path + '/publish', 'POST', data, false)).status, 403);
      const results = await Promise.all([owner(path + '/publish', 'POST', data), owner(path + '/publish', 'POST', data)]);
      for (const result of results) assert.equal(result.status, 200, JSON.stringify(result));
      assert.deepEqual(results[0].data, results[1].data);
      ({bookId, chapterId: firstId} = results[0].data);
      assert.equal(await Book.countDocuments(), 1); assert.equal(await Chapter.countDocuments(), 1);
      assert.equal(await WriterPublication.countDocuments(), 1);
      const book = await Book.findById(bookId); assert.equal(book.title, '山海来信'); assert.equal(book.visibility, 'public');
      const updated = await owner(`/api/writer/workspace/b_${bookId}`);
      assert.equal(updated.data.work.reference, `m_${key}`);
      assert.deepEqual(updated.data.cloudDrafts.map(row => row.id), ['manuscript-0']);
      assert.equal(updated.data.published[0].number, 2);
      assert.equal((await User.findById(user.id)).daily_upload_words, data.content.length);
      assert.equal((await owner(path + '/publish', 'POST', {...data, content: '不同内容'})).status, 409);
    });
    await t.test('preserves numbering gaps and old drafts; quota failure is transactional', async () => {
      await ChapterDraft.create({bookId, owner: user.id, title: '旧章节草稿', content: '仍然可恢复。', chapter_number: 9});
      const result = await owner(path); assert.equal(result.data.maxNumber, 9);
      assert.equal(result.data.cloudDrafts.length, 2);
      assert.equal((await owner(path + '/publish', 'POST', {id: 'new-draft', title: '重复编号', content: '正文', number: 2})).status, 409);
      const used = (await User.findById(user.id)).daily_upload_words;
      await User.updateOne({_id: user.id}, {$set: {uploadDay: dayKey(), daily_upload_words: 99999}});
      const result2 = await owner(path + '/publish', 'POST', {id: 'new-draft', title: '超出额度', content: '正文', number: 10});
      assert.equal(result2.status, 429); assert.equal(await Chapter.countDocuments(), 1); assert.equal(await WriterPublication.countDocuments(), 1);
      await User.updateOne({_id: user.id}, {$set: {daily_upload_words: used}});
      assert.equal((await owner(path + '/publish', 'POST', {id: 'new-draft', title: '新章', content: '完整新正文', number: 10})).status, 200);
      const catalog = await owner(path); assert.equal(catalog.data.maxNumber, 10);
      assert.deepEqual(catalog.data.published.map(row => row.number), [10, 2]);
      assert.equal((await other(`/api/writer/workspace/b_${bookId}`)).status, 404);
    });
    await t.test('editing preserves the original on a stale revision and protects other books', async () => {
      const chapter = await Chapter.findById(firstId);
      const body = {id: 'edit-draft', title: '修改后的第二章', content: '修改后的正文', number: 2, targetChapterId: firstId, baseUpdatedAt: chapter.updatedAt.toISOString()};
      assert.equal((await owner(path + '/publish', 'POST', {...body, baseUpdatedAt: '2000-01-01T00:00:00.000Z'})).status, 409);
      assert.equal((await Chapter.findById(firstId)).title, chapter.title);
      const otherBook = await Book.create({title: '其他作品', author_id: stranger.id});
      const otherChapter = await Chapter.create({bookId: otherBook.id, title: '别人的正文', content: '不许覆盖', chapter_number: 2});
      assert.equal((await owner(path + '/publish', 'POST', {...body, targetChapterId: otherChapter.id})).status, 409);
      assert.equal((await owner(path + '/publish', 'POST', body)).status, 200);
      assert.equal((await Chapter.findById(firstId)).content, body.content);
      assert.equal((await owner(path + '/publish', 'POST', body)).status, 200);
      await Book.updateOne({_id: bookId}, {$set: {deletedAt: new Date()}});
      assert.equal((await owner(path)).status, 404);
    });
  } finally {
    await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); await repl.stop();
  }
});
