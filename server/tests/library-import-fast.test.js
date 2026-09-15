import '../../tools/test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import {TestDatabase} from '../database/testing.js';
import {createApp} from '../app.js';
import Book from '../models/Book.js';
import Chapter from '../models/Chapter.js';
import {configureChapterStorage, createChapterStorage, chapterUploadConcurrency} from '../services/chapter-storage.js';
import {trustedLocalImport} from '../services/import-auth.js';
import {bodyHash} from '../services/r2.js';

const chapter = n => ({chapter_number: n, title: `第${n}章`, content: `合成正文 ${n}。`, link: `https://example.test/chapter/${n}`});
const identity = {title: '并行增量测试', author: '测试作者', sourceUrl: 'https://example.test/fast'};

test('parallel R2 writes verify every body, skip existing chapters, reject conflicts before writes and commit atomically', async t => {
  const db = await TestDatabase.create(), oldSecret = process.env.IMPORT_SECRET, oldStorage = process.env.CHAPTER_STORAGE;
  process.env.IMPORT_SECRET = crypto.randomBytes(32).toString('hex'); process.env.CHAPTER_STORAGE = 'r2';
  let server, active = 0, peak = 0, puts = 0, gets = 0, rejectBody;
  const objects = new Map();
  configureChapterStorage(createChapterStorage({bucket: 'isolated', client: {async send(command) {
    const {Key, Body} = command.input;
    active++; peak = Math.max(peak, active);
    try {
      await new Promise(resolve => setTimeout(resolve, 5));
      if (command.constructor.name === 'PutObjectCommand') {
        puts++; if (Body === rejectBody) throw Error('test storage failure'); objects.set(Key, Body); return {};
      }
      gets++; const content = objects.get(Key);
      return {ContentLength: Buffer.byteLength(content), Body: {transformToString: async () => content}};
    } finally { active--; }
  }}}));
  try {
    await mongoose.connect(db.getUri(), {autoIndex: false, autoCreate: false});
    for (const model of Object.values(mongoose.models)) await model.createIndexes();
    server = createApp({mode: 'test', jwtSecret: 'x'.repeat(40), origins: [], trustProxy: 'none', writeMode: 'readwrite'}).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}/api/admin/upload-book`;
    const send = async (chapters, extra = {}) => {
      const response = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json', 'x-import-secret': process.env.IMPORT_SECRET}, body: JSON.stringify({...identity, chapters, missingOnly: true, ...extra})});
      return {status: response.status, data: await response.json()};
    };
    const initial = Array.from({length: 40}, (_, i) => chapter(i + 1));
    assert.equal((await send(initial, {dryRun: true})).data.inserted, 40); assert.equal(puts, 0);
    const first = await send(initial);
    assert.equal(first.status, 200, JSON.stringify(first)); assert.equal(first.data.inserted, 40);
    assert.equal(puts, 40); assert.equal(gets, 40); assert.equal(peak, chapterUploadConcurrency); assert.equal(active, 0);
    const original = await Chapter.findOne({chapter_number: 1}).lean();
    assert.equal(original.content, undefined); assert.equal(original.contentSha256, bodyHash(initial[0].content));
    await Chapter.updateOne({_id: original._id}, {$unset: {sourceUrl: 1}});
    assert.equal((await send(initial)).data.unchanged, 40); assert.equal(puts, 40);
    assert.equal((await Chapter.findById(original._id).lean()).sourceUrl, undefined);
    // Fill a hole and append together; all surviving rows keep their identity.
    await Chapter.deleteOne({chapter_number: 20});
    const supplemented = await send([...initial, chapter(41)]);
    assert.equal(supplemented.data.inserted, 2); assert.equal(puts, 42); assert.equal(gets, 42);
    assert.equal((await Chapter.findById(original._id).lean()).contentSha256, original.contentSha256);
    const conflict = await send([chapter(42), {...chapter(1), content: '冲突正文'}]);
    assert.equal(conflict.status, 409); assert.equal(puts, 42); assert.equal(await Chapter.countDocuments(), 41);
    assert.equal((await send([], {author: '其他作者'})).status, 409);
    assert.equal((await send([], {sourceUrl: 'https://example.test/other'})).status, 409);
    const version = (await Book.findOne()).writeVersion;
    rejectBody = chapter(42).content;
    assert.equal((await send(Array.from({length: 30}, (_, i) => chapter(42 + i)))).status, 500);
    assert.equal(active, 0); assert.equal(await Chapter.countDocuments(), 41); assert.equal((await Book.findOne()).writeVersion, version);
    rejectBody = undefined;
    const retries = await Promise.all([send([chapter(42)]), send([chapter(42)])]);
    assert.ok(retries.every(r => r.status === 200), JSON.stringify(retries));
    assert.equal(retries.reduce((n, r) => n + r.data.inserted, 0), 1); assert.equal(await Chapter.countDocuments(), 42);
    await t.test('authenticated loopback uploads pass 500 requests while untrusted requests retain their limit', async t => {
      t.mock.method(console, 'error', () => {});
      for (let i = 0; i < 505; i++) {
        const response = await send(undefined); assert.equal(response.status, 400);
      }
      for (let i = 0; i < 501; i++) {
        const response = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json', 'x-import-secret': 'invalid'}, body: JSON.stringify({missingOnly: true})});
        assert.equal(response.status, i < 500 ? 403 : 429); await response.arrayBuffer();
      }
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    configureChapterStorage(undefined); await mongoose.disconnect(); await db.stop();
    if (oldSecret === undefined) delete process.env.IMPORT_SECRET; else process.env.IMPORT_SECRET = oldSecret;
    if (oldStorage === undefined) delete process.env.CHAPTER_STORAGE; else process.env.CHAPTER_STORAGE = oldStorage;
  }
});

test('only a valid credential on the actual loopback socket grants import rate exemption', () => {
  const old = process.env.IMPORT_SECRET; process.env.IMPORT_SECRET = 'x'.repeat(40);
  const req = {method: 'POST', path: '/admin/upload-book', headers: {'x-import-secret': process.env.IMPORT_SECRET}, socket: {remoteAddress: '127.0.0.1'}};
  try {
    assert.equal(trustedLocalImport(req), true);
    for (const change of [{method: 'GET'}, {path: '/books'}, {socket: {remoteAddress: '203.0.113.1'}},
      {headers: {...req.headers, origin: 'https://example.test'}}, {headers: {...req.headers, cookie: 'session=value'}},
      {headers: {...req.headers, 'x-forwarded-for': '203.0.113.1'}}, {headers: {...req.headers, 'x-real-ip': '127.0.0.1'}},
      {headers: {'x-import-secret': 'wrong', 'x-forwarded-for': '127.0.0.1'}}]) assert.equal(trustedLocalImport({...req, ...change}), false);
  } finally { if (old === undefined) delete process.env.IMPORT_SECRET; else process.env.IMPORT_SECRET = old; }
});
