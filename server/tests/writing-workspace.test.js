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
import WriterDraft from '../models/WriterDraft.js';
import WriterBlob from '../models/WriterBlob.js';
import {cleanupDraftObjects, insertedCharacters} from '../services/writing-drafts.js';
import {memoryWritingStorage} from './helpers/writing-storage.js';

test('chapter workspace preserves cloud drafts, ownership, quota and publication receipts', async t => {
  const repl = await MongoMemoryReplSet.create({binary: {version: '7.0.40'}, replSet: {count: 1, storageEngine: 'wiredTiger'}});
  const config = readConfig({APP_ENV: 'test', MONGO_URI: repl.getUri('test1_test'), JWT_SECRET: crypto.randomBytes(48).toString('hex')});
  await mongoose.connect(config.uri, {autoIndex: false});
  for (const model of Object.values(mongoose.models)) await model.createIndexes();
  const app = createApp(config), storage = memoryWritingStorage();
  app.locals.writingStorage = storage;
  const server = app.listen(0, '127.0.0.1');
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
    const adminUser = await User.create({username: '总编辑', email: 'admin@example.test', password, role: 'admin'});
    const owner = client(), other = client(), guest = client(), admin = client();
    assert.equal((await admin('/api/auth/signin', 'POST', {email: adminUser.email, password: 'Writing-test-123'})).status, 200);
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
    await t.test('admin uses the same workspace with literal title search, ordering and publication checks', async () => {
      const url = `/api/writer/workspace/b_${bookId}`;
      const result = await admin(url + '?order=asc');
      assert.equal(result.status, 200);
      assert.deepEqual(result.data.published.map(c => c.number), [2, 10]);
      assert.equal(result.data.cloudDrafts.length, 0); // Other authors' unpublished material stays private.
      assert.equal((await admin(path)).status, 404);
      const found = await admin(url + '?search=' + encodeURIComponent('新章'));
      assert.equal(found.data.total, 1); assert.equal(found.data.maxNumber, 10);
      assert.equal((await admin(url + '?search=' + encodeURIComponent('.*'))).data.total, 0);
      const chapter = await Chapter.findById(firstId);
      const payload = {id: 'admin-edit', title: chapter.title, content: '管理员校对后的正文', number: 2, targetChapterId: firstId, baseUpdatedAt: chapter.updatedAt.toISOString()};
      assert.equal((await admin(url + '/publish', 'POST', payload)).status, 200);
      assert.equal((await Book.findById(bookId)).author_id.toString(), user.id);
      assert.equal(await storage.readChapter(await Chapter.findById(firstId)), payload.content);
      assert.equal((await admin(url + '/publish', 'POST', {...payload, id: 'stale-admin-edit'})).status, 409);
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
      assert.equal(await storage.readChapter(await Chapter.findById(firstId)), body.content);
      assert.equal((await owner(path + '/publish', 'POST', body)).status, 200);
      await Book.updateOne({_id: bookId}, {$set: {deletedAt: new Date()}});
      assert.equal((await owner(path)).status, 404);
    });
    await t.test('cloud drafts survive another session, deduplicate retries, and reject stale writes', async () => {
      const cloudKey = crypto.randomUUID(), url = `/api/writer/workspace/m_${cloudKey}`;
      await Manuscript.create({_id: `${user.id}:${cloudKey}`, owner: user.id, title: '云端作品'});
      const data = {id: 'cloud-one', title: '第一章', content: '山海😀来信', number: 1, revision: 0};
      const used = (await User.findById(user.id)).daily_upload_words;
      const first = await owner(url + '/drafts/cloud-one', 'PUT', data);
      assert.equal(first.status, 200, JSON.stringify(first));
      assert.equal(first.data.cloudRevision, 1);
      assert.equal((await User.findById(user.id)).daily_upload_words, used + 5);
      const writes = storage.client.writes;
      assert.equal((await owner(url + '/drafts/cloud-one', 'PUT', data)).status, 200);
      assert.equal(storage.client.writes, writes);
      const metadata = (await owner(url)).data.cloudDrafts[0];
      assert.equal(metadata.content, ''); assert.equal(metadata.contentLoaded, false); assert.equal(metadata.words, 5);
      const second = client();
      await second('/api/auth/signin', 'POST', {email: user.email, password: 'Writing-test-123'});
      assert.equal((await second(url + '/drafts/cloud-one')).data.content, data.content);
      assert.equal((await other(url + '/drafts/cloud-one')).status, 404);
      assert.equal((await other(url + '/drafts/cloud-one', 'PUT', data)).status, 404);
      assert.equal((await owner(url + '/drafts/cloud-one', 'PUT', {...data, content: '另一页面旧内容'})).status, 409);
      const changed = {...data, revision: 1, content: '江海😀来书'};
      assert.equal((await owner(url + '/drafts/cloud-one', 'PUT', changed)).status, 200);
      assert.equal((await User.findById(user.id)).daily_upload_words, used + 7);
      const record = await WriterDraft.findOne({draftId: data.id});
      assert.equal(record.toObject().content, undefined); assert.match(record.contentKey, /^drafts\//);
      storage.client.failWrites = true;
      assert.equal((await owner(url + '/drafts/cloud-one', 'PUT', {...changed, revision: 2, content: changed.content + '更多文字'})).status, 500);
      storage.client.failWrites = false;
      assert.equal((await User.findById(user.id)).daily_upload_words, used + 7);
      assert.equal((await owner(url + '/drafts/cloud-one')).data.content, changed.content);
      assert.equal((await WriterDraft.findById(record.id)).revision, 2);
      const result = await owner(`/api/manuscripts/${cloudKey}`, 'DELETE');
      assert.equal(result.status, 200);
      assert.equal((await WriterDraft.findById(record.id)).deleted, true);
      assert.equal((await User.findById(user.id)).daily_upload_words, used + 7);
    });
    await t.test('daily insertions never refund deletion; publication does not charge again; cleanup preserves live objects', async () => {
      const key = crypto.randomUUID(), url = `/api/writer/workspace/m_${key}`;
      await Manuscript.create({_id: `${user.id}:${key}`, owner: user.id, title: '额度作品'});
      await User.updateOne({_id: user.id}, {$set: {uploadDay: dayKey(), daily_upload_words: 0}});
      const first = {id: 'sixty', title: '六万', content: '甲'.repeat(60000), number: 1, revision: 0};
      assert.equal((await owner(url + '/drafts/sixty', 'PUT', first)).status, 200);
      const keyBefore = (await WriterDraft.findOne({draftId: 'sixty'})).contentKey;
      assert.equal((await owner(url + '/drafts/sixty', 'PUT', {...first, revision: 1, deleted: true})).status, 200);
      assert.equal((await User.findById(user.id)).daily_upload_words, 60000);
      const second = {id: 'forty', title: '四万', content: '乙'.repeat(40000), number: 2, revision: 0};
      assert.equal((await owner(url + '/drafts/forty', 'PUT', second)).status, 200);
      assert.equal((await owner(url + '/drafts/extra', 'PUT', {...second, id: 'extra', number: 3, content: '多'})).status, 429);
      assert.equal((await User.findById(user.id)).daily_upload_words, 100000);
      const {revision, ...body} = second;
      const published = await owner(url + '/publish', 'POST', {...body, cloudRevision: 1});
      assert.equal(published.status, 200, JSON.stringify(published));
      assert.equal((await User.findById(user.id)).daily_upload_words, 100000);
      const chapter = await Chapter.findById(published.data.chapterId);
      assert.equal(chapter.content, undefined); assert.equal(await storage.readChapter(chapter), second.content);
      await User.updateOne({_id: user.id}, {$set: {daily_upload_words: 99999}});
      const results = await Promise.all(['race-a', 'race-b'].map(id => owner(url + '/drafts/' + id, 'PUT', {id, title: id, content: '字', number: 3, revision: 0})));
      assert.deepEqual(results.map(r => r.status).sort(), [200, 429]);
      await User.updateOne({_id: user.id}, {$set: {uploadDay: dayKey(new Date(Date.now() - 86400000)), daily_upload_words: 100000}});
      assert.equal((await owner(url + '/drafts/new-day', 'PUT', {id: 'new-day', title: '次日', content: '新😀', number: 4, revision: 0})).status, 200);
      assert.equal((await User.findById(user.id)).daily_upload_words, 2);
      await cleanupDraftObjects(storage, new Date(Date.now() + 7200000));
      assert.equal(storage.objects.has(keyBefore), false);
      assert.equal(await storage.readChapter(chapter), second.content);
      assert.equal((await owner(url + '/drafts/new-day')).data.content, '新😀');
      assert.equal(await WriterBlob.countDocuments({retireAt: {$ne: null, $lte: new Date()}}), 0);
    });
  } finally {
    app.locals.stopWritingCleanup();
    await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); await repl.stop();
  }
});

test('insert counting ignores unchanged text, counts replacements, and handles Unicode characters', () => {
  assert.equal(insertedCharacters('甲乙丙', '甲乙丙'), 0);
  assert.equal(insertedCharacters('甲乙丙', '甲丙'), 0);
  assert.equal(insertedCharacters('甲乙丙', '甲丁丙'), 1);
  assert.equal(insertedCharacters('甲乙丙丁', '新甲乙丙丁尾'), 2);
  assert.equal(insertedCharacters('', '甲😀'), 2);
  assert.equal(insertedCharacters('甲😀', '甲😃'), 1);
});
