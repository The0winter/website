import '../../tools/test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {TestDatabase} from '../database/testing.js';
import Book from '../models/Book.js';
import Chapter from '../models/Chapter.js';
import {bookCatalog, readCatalogWindow} from '../services/catalog-volumes.js';
import {bookReadingIndex} from '../services/book-reading-index.js';
import {BookVersionChanged} from '../services/book-version.js';
import {buildCatalogVolumes} from '../../shared/catalog-volumes.mjs';

test('Atlas cold catalog sends bounded title pages and compact volumes, including numbering gaps', {skip: process.env.TEST_DATABASE_BACKEND !== 'mongodb'}, async () => {
  const fixture = await TestDatabase.create();
  try {
    await mongoose.connect(fixture.getUri(), {monitorCommands: true});
    await Book.createIndexes(); await Chapter.createIndexes();
    const book = await Book.create({title: 'Ten thousand chapters'});
    const chapters = await Chapter.insertMany(Array.from({length: 10001}, (_, i) => ({bookId: book._id,
      title: `第${i + 1}章 这是一段用于验证目录传输量的章节标题`, chapter_number: i * 2 + 1,
      volume_title: `第${Math.floor(i / 1000) + 1}卷 起点`, volume_number: Math.floor(i / 1000) + 1,
      content: 'Body must never cross the catalog connection', deletedAt: i === 203 ? new Date() : null})));
    const live = chapters.filter(chapter => !chapter.deletedAt), id = String(book._id), anchor = String(live[8000]._id);
    const replies = [], finds = [], client = mongoose.connection.getClient();
    client.on('commandStarted', event => {if (event.command.find === 'chapters') finds.push(event.command);});
    client.on('commandSucceeded', event => {if (['find', 'aggregate', 'getMore'].includes(event.commandName)) replies.push(event.reply);});
    const result = await readCatalogWindow(id, '0', {anchor, offset: 0, limit: 401});
    assert.equal(result.total, 10000); assert.equal(result.activeIndex, 8000); assert.equal(result.offset, 7800);
    assert.deepEqual(result.rows.map(row => row.id), live.slice(7800, 8201).map(row => String(row._id)));
    assert.deepEqual(result.volumes, buildCatalogVolumes(live));
    assert.equal(bookReadingIndex.peek(id, '0'), undefined, 'opening a catalog does not download a full reading index');
    const rows = replies.flatMap(reply => reply.cursor?.firstBatch ?? reply.cursor?.nextBatch ?? []);
    const titled = rows.filter(row => Object.hasOwn(row, 'title'));
    assert.ok(titled.length <= 768, `${titled.length} titles downloaded for a 401-row window`);
    assert.ok(rows.every(row => row.content === undefined && row.contentKey === undefined));
    const bytes = replies.reduce((sum, reply) => sum + mongoose.mongo.BSON.calculateObjectSize(reply), 0);
    assert.ok(bytes < 160000, `${bytes} BSON bytes`);
    for (const command of finds.filter(command => command.projection?.title)) {
      assert.equal(command.limit, 256); assert.equal(command.singleBatch, true);
    }
    const count = replies.length;
    assert.deepEqual(await readCatalogWindow(id, '0', {anchor, offset: 0, limit: 401}), result);
    assert.equal(replies.length, count, 'warm window reuses the summary, anchor and title pages');
    const all = [];
    for (let offset = 0; offset < live.length; offset += 2048) all.push(...(await readCatalogWindow(id, '0', {offset, limit: 2048})).rows);
    assert.deepEqual(all.map(row => row.id), live.map(row => String(row._id)), 'paging visits every live chapter exactly once');
    console.log(JSON.stringify({catalogEgress: {chapters: live.length, visibleRows: result.rows.length, databaseTitleRows: titled.length, replyBytes: bytes}}));
  } finally {await mongoose.disconnect(); await fixture.stop();}
});

test('compact Mongo volumes match legacy inheritance, repeated labels, Unicode and missing numbers', {skip: process.env.TEST_DATABASE_BACKEND !== 'mongodb'}, async () => {
  const fixture = await TestDatabase.create();
  try {
    await mongoose.connect(fixture.getUri()); await Chapter.createIndexes();
    const book = await Book.create({title: 'Volume edge cases'});
    const markers = [
      {title: '序言'}, {title: '第一卷 风起 第1章 开始'}, {title: '普通章节'},
      {title: '第二卷 风起'}, {title: '第一卷 结束以及请假'}, {title: '卷三'},
      {title: '第一章', volume_title: '同名卷', volume_number: 1}, {title: '普通章节'},
      {title: '第二章', volume_title: '同名卷', volume_number: 2},
      {title: '第三章', volume_title: '同名卷'}, {title: '第四章', volume_title: '同名卷', volume_number: null},
      {title: '\ufeff第十二卷\n归来\n第三回 终点\u3000', volume_title: '\u3000 '},
      {title: '第一卷 第一回第2章'}, {title: '正文', volume_title: '番外', volume_number: 5},
      {title: '正文 第1章'}, {title: '第１卷 起点 第〇节 继续'},
    ];
    const chapters = await Chapter.insertMany(Array.from({length: 350}, (_, i) => ({...markers[Math.floor(i / 3) % markers.length],
      bookId: book._id, chapter_number: i * 2 + 1, content: 'body', deletedAt: i % 29 === 0 ? new Date() : null})));
    const live = chapters.filter(chapter => !chapter.deletedAt);
    assert.deepEqual(await bookCatalog(String(book._id), '0'), {total: live.length, volumes: buildCatalogVolumes(live)});
  } finally {await mongoose.disconnect(); await fixture.stop();}
});

test('a title-page load concurrent with publication is rejected and cannot poison the next version', async t => {
  const fixture = await TestDatabase.create();
  try {
    await mongoose.connect(fixture.getUri()); await Chapter.createIndexes();
    const book = await Book.create({title: 'Window race'});
    const chapter = await Chapter.create({bookId: book._id, title: 'Before', content: 'body', chapter_number: 1});
    await bookCatalog(String(book._id), '0');
    const find = Chapter.find.bind(Chapter); let edited = false;
    t.mock.method(Chapter, 'find', (...args) => {
      const query = find(...args), lean = query.lean.bind(query);
      query.lean = async (...options) => {
        const result = await lean(...options);
        if (!edited) {
          edited = true;
          await mongoose.connection.transaction(async session => {
            await Chapter.updateOne({_id: chapter._id}, {$set: {title: 'After'}}, {session});
            await Book.updateOne({_id: book._id}, {$inc: {writeVersion: 1}}, {session});
          });
        }
        return result;
      };
      return query;
    });
    await assert.rejects(readCatalogWindow(String(book._id), '0', {offset: 0, limit: 128}), BookVersionChanged);
    assert.equal((await readCatalogWindow(String(book._id), '1', {offset: 0, limit: 128})).rows[0].title, 'After');
  } finally {await mongoose.disconnect(); await fixture.stop();}
});
