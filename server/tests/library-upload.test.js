import '../../tools/test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import {TestDatabase} from '../database/testing.js';
import {createApp} from '../app.js';
import Book from '../models/Book.js';
import Chapter from '../models/Chapter.js';
import {inspectLibraryBook, applyLibraryBatches} from '../../infra/library-sync-vps.mjs';
import {planUpload} from '../../tools/novel-crawler/desktop/upload.mjs';
import {inspectLibraryHeaders, inspectVersionedLibraryBook} from '../../infra/library-sync-inspect.mjs';
import {libraryRevision} from '../../shared/library-revision.mjs';

const bodyHash = content => crypto.createHash('sha256').update(content).digest('hex');
const chapter = number => ({chapter_number: number, title: `第${number}章 故事${number}`, content: Array.from({length: 400}, (_, i) => String.fromCodePoint(0x5000 + number * 500 + i)).join(''), link: `https://example.test/${number}`});

test('library sync uses the real import API and SQL models: R2 bodies, append, repeat, metadata, conflicts and complete preflight', async t => {
  const database = await TestDatabase.create(), oldSecret = process.env.IMPORT_SECRET, oldStorage = process.env.CHAPTER_STORAGE;
  process.env.IMPORT_SECRET = crypto.randomBytes(32).toString('hex'); delete process.env.CHAPTER_STORAGE;
  let server;
  try {
    await mongoose.connect(database.getUri(), {autoIndex: false, autoCreate: false});
    for (const model of Object.values(mongoose.models)) await model.createIndexes();
    server = createApp({mode: 'test', jwtSecret: 'x'.repeat(40), origins: ['http://127.0.0.1:3000'], trustProxy: 'none', writeMode: 'readwrite'}).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const calls = [], emit = () => {};
    const send = async (batch, dryRun) => {
      calls.push({dryRun, numbers: batch.chapters.map(c => c.chapter_number)});
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/upload-book`, {method: 'POST', headers: {'content-type': 'application/json', 'x-import-secret': process.env.IMPORT_SECRET}, body: JSON.stringify({...batch, dryRun})});
      const result = await response.json(); if (!response.ok) throw Error(result.error); return result;
    };
    const source = {title: '合成上传测试书', author: '测试作者', sourceUrl: 'https://example.test/book/sync', description: '原始简介', chapters: Array.from({length: 23}, (_, i) => chapter(i + 1))};
    const inspect = input => inspectVersionedLibraryBook(input, {Book, Chapter, bodyHash});
    const plan = planUpload(source, await inspect(source));
    assert.equal(plan.newBook, true); assert.equal(plan.batches.length, 1);
    assert.deepEqual(await applyLibraryBatches({mode: 'preflight', batches: plan.batches}, {send, emit}), {validated: true});
    assert.equal(await Book.countDocuments(), 0); assert.equal(await Chapter.countDocuments(), 0);
    calls.length = 0;
    assert.equal((await applyLibraryBatches({mode: 'apply', batches: plan.batches}, {send, emit})).added, 23);
    assert.deepEqual(calls.map(c => c.dryRun), [true, false]);
    assert.equal(await Chapter.countDocuments(), 23);
    // Production books may mix legacy inline content and migrated R2 references.
    // Inspection uses the stored digest, without downloading immutable bodies.
    const first = await Chapter.findOne({chapter_number: 1});
    const digest = bodyHash(source.chapters[0].content);
    await Chapter.updateOne({_id: first._id}, {$set: {contentSha256: digest, contentKey: `chapters/sha256/${digest}.txt`}, $unset: {content: 1}});
    const online = await inspect(source);
    assert.equal(online.token, libraryRevision(await Book.findById(online.bookId).lean()));
    assert.deepEqual(online.chapters, (await inspectLibraryBook(source, {Book, Chapter, bodyHash})).chapters);
    const findBook = t.mock.method(Book, 'find'), findChapter = t.mock.method(Chapter, 'find');
    const headers = await inspectLibraryHeaders(Array.from({length: 200}, () => source), {Book});
    assert.equal(headers.length, 200); assert.ok(headers.every(row => row.token === online.token));
    assert.equal(findBook.mock.callCount(), 1); assert.equal(findChapter.mock.callCount(), 0);
    findBook.mock.restore(); findChapter.mock.restore();
    assert.equal(online.chapters.length, 23); assert.equal(online.chapters[0].hash, bodyHash(source.chapters[0].content));
    assert.ok(!(await Chapter.findById(first._id).lean()).content);
    assert.equal(planUpload(source, online).batches.length, 0);
    const extended = {...source, chapters: [...source.chapters, chapter(24)]};
    const delta = planUpload(extended, online);
    assert.equal(delta.batches[0].chapters.length, 1);
    const appended = await applyLibraryBatches({mode: 'apply', batches: delta.batches, expectedToken: online.token}, {send, emit});
    assert.ok(appended.verifiedToken); assert.notEqual(appended.verifiedToken, online.token);
    const tail = await inspect({...source, knownToken: appended.verifiedToken, numbers: [24]});
    assert.equal(tail.partial, true); assert.deepEqual(tail.chapters.map(c => c.number), [24]);
    assert.equal((await inspect({...source, knownToken: online.token, numbers: [24]})).chapters.length, 24);
    assert.equal(await Chapter.countDocuments(), 24); assert.equal(await Book.countDocuments(), 1);
    const metadata = planUpload({...extended, description: '新的简介', status: '完结', cover_image: 'https://example.test/old.jpg'}, await inspect(source));
    assert.deepEqual(metadata.batches[0].chapters, []);
    await applyLibraryBatches({mode: 'apply', batches: metadata.batches}, {send, emit});
    assert.notEqual((await inspect(source)).token, appended.verifiedToken);
    assert.equal((await Book.findOne()).description, '新的简介'); assert.equal((await Book.findOne()).status, '完结'); assert.equal((await Book.findOne()).cover_image, '');
    calls.length = 0;
    const conflicting = {...source, chapters: [chapter(25), {...chapter(1), content: '网站已有的不同内容'}]};
    const batches = [{...source, chapters: [chapter(25)]}, {...conflicting, chapters: [conflicting.chapters[1]]}];
    await assert.rejects(applyLibraryBatches({mode: 'apply', batches}, {send, emit}), /冲突/);
    assert.ok(calls.every(c => c.dryRun)); assert.equal(await Chapter.countDocuments(), 24);
    await assert.rejects(inspect({...source, sourceUrl: 'https://example.test/another-version'}), /其他来源版本/);
    // A write between reading the directory and its closing version check must
    // retry; otherwise a mixed snapshot could become a durable fast-skip record.
    let reads = 0;
    const find = Chapter.find.bind(Chapter);
    const racing = t.mock.method(Chapter, 'find', (...args) => {
      const query = find(...args), lean = query.lean.bind(query);
      query.lean = async (...opts) => {
        const rows = await lean(...opts);
        if (++reads === 1) {
          await Chapter.updateOne({_id: first._id}, {$set: {title: '并发更新的标题'}});
          await Book.updateOne({_id: online.bookId}, {$inc: {writeVersion: 1}});
        }
        return rows;
      };
      return query;
    });
    assert.equal((await inspect(source)).chapters[0].title, '并发更新的标题'); assert.equal(reads, 2);
    racing.mock.restore();
    await Book.updateOne({_id: online.bookId}, {$set: {deletedAt: new Date()}});
    await assert.rejects(inspect(source), /已下架/);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect(); await database.stop();
    if (oldSecret === undefined) delete process.env.IMPORT_SECRET; else process.env.IMPORT_SECRET = oldSecret;
    if (oldStorage === undefined) delete process.env.CHAPTER_STORAGE; else process.env.CHAPTER_STORAGE = oldStorage;
  }
});
