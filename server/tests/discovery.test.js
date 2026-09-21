import '../../tools/test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import {TestDatabase} from '../database/testing.js';
import {createApp} from '../app.js';
import {readConfig} from '../config.js';
import Book from '../models/Book.js';
import {selectDiscoveryBooks} from '../services/discovery.js';

const fixture = Array.from({length: 150}, (_, i) => ({_id: (i + 1).toString(16).padStart(24, '0'), title: `故事${i}`,
  views: 1000 - i, rating: i % 6, category: ['玄幻', '历史', '都市', '仙侠', '科幻'][i % 5], author: `作者${i % 70}`, updatedAt: '2026-09-20'}));
const ids = books => books.map(book => String(book._id));

test('discovery excludes raw-view top 50, is unique and stable within a China calendar day, and rotates daily', () => {
  const first = selectDiscoveryBooks(fixture, 57, new Date('2026-09-20T16:00:00Z'));
  assert.equal(first.length, 57);
  assert.equal(new Set(ids(first)).size, 57);
  assert.ok(first.every(book => Number.parseInt(book._id, 16) > 50));
  assert.deepEqual(ids(first), ids(selectDiscoveryBooks(fixture.toReversed(), 57, new Date('2026-09-21T15:59:59Z'))));
  const next = selectDiscoveryBooks(fixture, 57, new Date('2026-09-21T16:00:00Z'));
  assert.notDeepEqual(new Set(ids(first)), new Set(ids(next)));
  assert.equal(new Set(first.slice(0, 8).map(book => book.category)).size, 5);
  assert.equal(new Set(first.slice(0, 8).map(book => book.author)).size, 8);
});

test('small libraries consume the long tail first, never duplicate books, and handle tied views', () => {
  const small = fixture.slice(0, 60).map(book => ({...book, views: 0}));
  const feed = selectDiscoveryBooks([...small, small[0]], 57);
  assert.deepEqual(new Set(ids(feed.slice(0, 10))), new Set(ids(small.slice(50))));
  assert.equal(new Set(ids(feed)).size, 57);
  assert.equal(selectDiscoveryBooks(fixture.slice(0, 4)).length, 4);
  assert.deepEqual(selectDiscoveryBooks([]), []);
});

test('public discovery API excludes private/deleted works, matches the browsing boundary and paginates the finite feed', async () => {
  const database = await TestDatabase.create();
  await mongoose.connect(database.getUri(), {autoIndex: false});
  const config = readConfig({APP_ENV: 'test', DATABASE_URL: database.getUri(), JWT_SECRET: crypto.randomBytes(48).toString('hex')});
  const server = createApp(config).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const get = async params => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/books?${new URLSearchParams(params)}`);
    assert.equal(response.status, 200);
    return {books: await response.json(), total: Number(response.headers.get('x-total-count'))};
  };
  try {
    await Book.insertMany(fixture);
    await Book.create([{title: 'Private', visibility: 'private', views: 100000}, {title: 'Deleted', deletedAt: new Date(), views: 100000}]);
    const top = new Set((await get({orderBy: 'views', limit: 50})).books.map(book => book.id));
    const all = await get({orderBy: 'discovery', limit: 57});
    assert.equal(all.total, 57); assert.equal(all.books.length, 57);
    assert.ok(all.books.every(book => !top.has(book.id) && book.title.startsWith('故事')));
    const pages = await Promise.all([1, 2, 3].map(page => get({orderBy: 'discovery', limit: 20, page})));
    assert.deepEqual(pages.flatMap(page => page.books), all.books);
    assert.deepEqual((await get({orderBy: 'discovery', limit: 20, page: 4})).books, []);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect();
    await database.stop();
  }
});
