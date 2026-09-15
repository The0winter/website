import '../../tools/test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import {TestDatabase} from '../database/testing.js';
import {createApp} from '../app.js';
import {readConfig} from '../config.js';
import Book from '../models/Book.js';
import Chapter from '../models/Chapter.js';
import {createChapter, lockBook} from '../services/content.js';
import {trashChapter} from '../services/writing-trash.js';
import {bookCatalog} from '../services/catalog-volumes.js';
import {bookReadingIndex} from '../services/book-reading-index.js';
import {versionedBookCache} from '../services/versioned-book-cache.js';

test('200 chapter reads share one order index; catalogs rebuild only after publication changes', async t => {
  const fixture = await TestDatabase.create();
  let server;
  try {
    await mongoose.connect(fixture.getUri());
    for (const model of Object.values(mongoose.models)) await model.createIndexes();
    const book = await Book.create({title: 'Cache regression'});
    const chapters = await Chapter.insertMany(Array.from({length: 501}, (_, i) => ({bookId: book._id,
      title: `Chapter ${i}`, content: 'body', word_count: 4, chapter_number: 2 * i + 1, deletedAt: i === 1 ? new Date() : null})));
    const config = readConfig({APP_ENV: 'test', DATABASE_URL: fixture.getUri(), JWT_SECRET: crypto.randomBytes(48).toString('hex')});
    const app = createApp(config);
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const path = `${base}/books/${book._id}`;
    const commands = [], transport = mongoose.connection.transport, original = transport.query.bind(transport);
    transport.query = async sql => {const rows = await original(sql); commands.push({sql, rows}); return rows;};
    const get = async url => {const result = await fetch(url); assert.equal(result.status, 200); return result.json();};
    let now = Date.now(); t.mock.method(Date, 'now', () => now);
    for (let i = 2; i < 202; i++) {
      now += 90_000;
      const chapter = await get(`${base}/chapters/${chapters[i]._id}?navigation=1`);
      assert.equal(chapter.chapterTotal, 500); assert.equal(chapter.chapterIndex, i - 1);
      assert.equal(chapter.previousId, String(chapters[i === 2 ? 0 : i - 1]._id));
      assert.equal(chapter.nextId, String(chapters[i + 1]._id));
      assert.equal(chapter.catalogVersion, 0); assert.equal(chapter.content, 'body');
    }
    const chapterQueries = commands.filter(({sql}) => sql.includes('FROM "chapters"'));
    const scans = chapterQueries.filter(({sql}) => !sql.includes('LIMIT 1'));
    assert.equal(scans.length, 1, 'one shared order scan, never one scan per chapter/minute');
    assert.equal(scans[0].rows.length, 500);
    assert.ok(scans[0].rows.every(row => !Object.hasOwn(JSON.parse(row.document), 'title')));
    assert.equal(chapterQueries.length, 401, 'one order scan and two primary-key reads per chapter');
    for (const {sql} of chapterQueries) {
      const plan = await original('EXPLAIN QUERY PLAN ' + sql);
      assert.ok(plan.some(row => /SEARCH chapters USING/.test(row.detail)), JSON.stringify(plan));
    }
    commands.length = 0;
    assert.deepEqual(await get(path + '/statistics'), {totalWords: 2000});
    assert.equal(commands.filter(({sql}) => sql.includes('FROM "chapters"')).length, 0);
    const anchor = String(chapters[200]._id);
    const first = await get(path + `/catalog?anchor=${anchor}`);
    assert.equal(first.activeIndex, 199); assert.equal(first.total, 500);
    assert.equal(commands.filter(({sql}) => sql.includes('FROM "chapters"')).length, 1);
    commands.length = 0;
    now += 24 * 3600_000;
    await Promise.all(Array.from({length: 10}, () => get(path + `/catalog?anchor=${anchor}&version=0`)));
    await get(path + '/catalog/version');
    assert.equal(commands.filter(({sql}) => sql.includes('FROM "chapters"')).length, 0);

    // Exercise real transactional writers, not just manual cache invalidation.
    const added = await createChapter({role: 'import'}, book._id, {title: 'New chapter', content: 'new', chapter_number: 1003});
    assert.equal((await get(path + '/catalog/version')).version, '1');
    commands.length = 0;
    assert.equal((await fetch(path + '/catalog?version=0')).status, 409);
    assert.equal(commands.filter(({sql}) => sql.includes('FROM "chapters"')).length, 0, 'reject stale versions before scanning');
    assert.equal((await get(path + '/catalog?offset=499')).rows.at(-1).id, String(added._id));
    assert.equal((await get(`${base}/chapters/${added._id}?navigation=1`)).chapterTotal, 501);
    await trashChapter({role: 'admin'}, chapters[2]._id);
    assert.equal((await get(path + '/catalog')).total, 500);
    assert.equal((await get(`${base}/chapters/${chapters[3]._id}?navigation=1`)).previousId, String(chapters[0]._id));
    await trashChapter({role: 'admin'}, chapters[2]._id, {restore: true});
    assert.equal((await get(path + '/catalog')).total, 501);
    await mongoose.connection.transaction(async session => {
      await lockBook(book._id, {role: 'admin'}, session);
      await Chapter.updateOne({_id: added._id}, {$set: {chapter_number: 2, title: '第一卷 起点 第1章', volume_title: '第一卷 起点', volume_number: 1}}, {session});
    });
    const moved = await get(path + `/catalog?anchor=${added._id}`);
    assert.equal(moved.activeIndex, 1); assert.equal(moved.rows[1].title, '第一卷 起点 第1章');
    assert.ok(moved.volumes.length > 0);
    const position = await get(`${base}/chapters/${added._id}?navigation=1`);
    assert.equal(position.chapterIndex, 1); assert.equal(position.previousId, String(chapters[0]._id));
    assert.equal(position.nextId, String(chapters[2]._id));
    await Book.updateOne({_id: book._id}, {$set: {visibility: 'private'}});
    assert.equal((await fetch(path + '/catalog')).status, 404);
    assert.equal((await fetch(path + '/catalog/version')).status, 404);
    assert.equal((await fetch(path + '/statistics')).status, 404);
    assert.equal((await fetch(`${base}/chapters/${added._id}?navigation=1`)).status, 404);
    app.locals.stopWritingCleanup();
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect(); await fixture.stop();
  }
});

test('version caches deduplicate work, bound memory, retry failures and isolate database reconnects', async () => {
  const fixture = await TestDatabase.create(), another = await TestDatabase.create();
  try {
    await mongoose.connect(fixture.getUri());
    let loads = 0, fail = true;
    const read = versionedBookCache(async key => {loads++; if (key === 'fail' && fail) throw Error('offline'); return key;}, () => 10, {maxEntries: 2, maxBytes: 15});
    assert.deepEqual(await Promise.all([read('a', 0), read('a', 0)]), ['a', 'a']); assert.equal(loads, 1);
    await read('b', 0); await read('a', 0); assert.equal(loads, 3, 'byte budget evicts oldest entries');
    await read('a', 1); assert.equal(loads, 4);
    await assert.rejects(read('fail', 0)); fail = false; assert.equal(await read('fail', 0), 'fail');
    const id = new mongoose.Types.ObjectId();
    await Book.create({_id: id, title: 'Old database'});
    await Chapter.create({bookId: id, title: 'Old chapter', content: 'a', chapter_number: 1});
    assert.equal((await bookCatalog(id, 0)).rows.length, 1);
    assert.equal((await bookReadingIndex(id, 0)).ids.length, 1);
    await mongoose.disconnect(); await mongoose.connect(another.getUri());
    await Book.create({_id: id, title: 'New database'});
    assert.equal((await bookCatalog(id, 0)).rows.length, 0);
    assert.equal((await bookReadingIndex(id, 0)).ids.length, 0);
  } finally {await mongoose.disconnect(); await fixture.stop(); await another.stop();}
});
