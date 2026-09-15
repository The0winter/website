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
import {lockBook} from '../services/content.js';
import {trashChapter} from '../services/writing-trash.js';
import {bookCatalog} from '../services/catalog-volumes.js';
import {readBookIndex} from '../services/book-reading-index.js';
import {BookVersionChanged} from '../services/book-version.js';
import {configureChapterStorage, createChapterStorage} from '../services/chapter-storage.js';

// Count actual SQL reads / MongoDB wire commands, including cursor batches.
function observeReads(t) {
  const commands = [], transport = mongoose.connection.transport;
  if (transport) {
    const query = transport.query.bind(transport);
    t.mock.method(transport, 'query', async sql => {
      if (/^SELECT\b/i.test(sql)) commands.push(sql);
      return query(sql);
    });
  } else {
    const client = mongoose.connection.getClient();
    const observe = event => {if (['find', 'getMore', 'aggregate', 'count'].includes(event.commandName)) commands.push(event.commandName);};
    client.on('commandStarted', observe);
    t.after(() => client.off('commandStarted', observe));
  }
  return commands;
}

test('warm public reads have bounded query counts and retain fresh bodies, deletions and privacy', async t => {
  const fixture = await TestDatabase.create();
  let app, server;
  try {
    await mongoose.connect(fixture.getUri(), {monitorCommands: true});
    for (const model of Object.values(mongoose.models)) await model.createIndexes();
    const book = await Book.create({title: 'Reading query budget'});
    const chapter = await Chapter.create({bookId: book._id, title: 'First', content: 'original', word_count: 8, chapter_number: 1});
    app = createApp(readConfig({APP_ENV: 'test', DATABASE_URL: fixture.getUri(), JWT_SECRET: crypto.randomBytes(48).toString('hex')}));
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`, path = `/books/${book._id}`, body = `/chapters/${chapter._id}`;
    const commands = observeReads(t);
    const request = async (url, {status = 200, reads, method = 'GET'} = {}) => {
      commands.length = 0;
      const response = await fetch(base + url, {method});
      const data = method === 'HEAD' ? null : await response.json();
      assert.equal(response.status, status, JSON.stringify(data));
      if (reads !== undefined) assert.equal(commands.length, reads, `${method} ${url}: ${JSON.stringify(commands)}`);
      return data;
    };
    await request(body + '?navigation=1'); await request(path + '/catalog');
    for (let i = 0; i < 10; i++) {
      const result = await request(body + '?navigation=1', {reads: 2});
      assert.equal(result.content, 'original'); assert.equal(result.chapterTotal, 1);
      assert.equal(result.previousId, null); assert.equal(result.nextId, null);
    }
    await request(body, {reads: 2});
    await request(body + '/?navigation=1', {reads: 2});
    await request(body + '?navigation=1', {reads: 2, method: 'HEAD'});
    await request(path + '/catalog', {reads: 1});
    await request(path + '/catalog/version', {reads: 1});
    await request(path + '/statistics', {reads: 1});
    await request(path + '/chapters', {reads: 2});
    await request(`/chapters/${new mongoose.Types.ObjectId()}?navigation=1`, {status: 404, reads: 1});

    // Exercise content-addressed R2 references, including an already cached body.
    const objects = new Map();
    const storage = createChapterStorage({bucket: 'test', client: {async send(command) {
      const {Key, Body} = command.input;
      if (command.constructor.name === 'PutObjectCommand') {objects.set(Key, Body); return {};}
      return {Body: {transformToString: async () => objects.get(Key)}};
    }}});
    configureChapterStorage(storage);
    for (const content of ['first object body', 'edited object body']) {
      const ref = await storage.write(content);
      await mongoose.connection.transaction(async session => {
        await lockBook(book._id, {role: 'import'}, session);
        await Chapter.updateOne({_id: chapter._id}, {$set: {...ref, word_count: content.length}, $unset: {content: ''}}, {session});
      });
      assert.equal((await request(body + '?navigation=1')).content, content);
      const warmed = await request(body + '?navigation=1', {reads: 2});
      assert.equal(warmed.content, content); assert.equal(warmed.contentKey, undefined);
      assert.equal((await request(path + '/statistics', {reads: 1})).totalWords, content.length);
    }
    await trashChapter({role: 'admin'}, chapter._id);
    await request(body + '?navigation=1', {status: 404});
    await trashChapter({role: 'admin'}, chapter._id, {restore: true});
    assert.equal((await request(body + '?navigation=1')).content, 'edited object body');
    // Even without a version increment, private/deleted books cannot use a warm cache.
    await Book.updateOne({_id: book._id}, {$set: {visibility: 'private'}});
    for (const url of [body, body + '?navigation=1', path + '/catalog', path + '/catalog/version', path + '/statistics']) await request(url, {status: 404});
    await Book.updateOne({_id: book._id}, {$set: {visibility: 'public', deletedAt: new Date()}});
    for (const url of [body, body + '?navigation=1', path + '/catalog', path + '/catalog/version', path + '/statistics']) await request(url, {status: 404});
    await Book.deleteOne({_id: book._id});
    await request(body + '?navigation=1', {status: 404});
  } finally {
    configureChapterStorage(undefined);
    app?.locals.stopWritingCleanup();
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect(); await fixture.stop();
  }
});

test('concurrent cold readers share validation; edits during a build never become a cached old version', async t => {
  const fixture = await TestDatabase.create();
  try {
    await mongoose.connect(fixture.getUri());
    await Book.createIndexes(); await Chapter.createIndexes();
    const book = await Book.create({title: 'Concurrent publication'});
    const chapter = await Chapter.create({bookId: book._id, title: 'Old', content: 'body', chapter_number: 1, word_count: 4});
    const find = Chapter.find.bind(Chapter);
    let scans = 0, afterScan;
    t.mock.method(Chapter, 'find', (...args) => {
      const query = find(...args), lean = query.lean.bind(query);
      query.lean = async (...options) => {
        const rows = await lean(...options); scans++;
        const callback = afterScan; afterScan = undefined;
        if (callback) await callback();
        return rows;
      };
      return query;
    });
    const edit = async words => mongoose.connection.transaction(async session => {
      await lockBook(book._id, {role: 'import'}, session);
      await Chapter.updateOne({_id: chapter._id}, {$set: {title: `Words ${words}`, word_count: words}}, {session});
    });
    afterScan = () => edit(8);
    const pending = await Promise.allSettled([bookCatalog(book._id, 0), bookCatalog(book._id, 0)]);
    for (const result of pending) {
      assert.equal(result.status, 'rejected'); assert.ok(result.reason instanceof BookVersionChanged);
      assert.equal(result.reason.version, '1');
    }
    assert.equal(scans, 1, 'both readers share the rejected build');
    assert.equal((await bookCatalog(book._id, 1)).rows[0].title, 'Words 8');
    afterScan = () => edit(12);
    const index = await readBookIndex(book._id);
    assert.equal(index.version, 2); assert.equal(index.totalWords, 12, 'retry uses the new publication');
    assert.equal(scans, 4);
    await readBookIndex(book._id); await readBookIndex(book._id);
    assert.equal(scans, 4, 'validated index is reusable');
    afterScan = () => Book.updateOne({_id: book._id}, {$set: {deletedAt: new Date()}});
    await assert.rejects(bookCatalog(book._id, 2), error => error.status === 404);
    await assert.rejects(readBookIndex(book._id), error => error.status === 404);
  } finally {await mongoose.disconnect(); await fixture.stop();}
});
