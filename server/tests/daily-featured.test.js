import '../../tools/test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import {TestDatabase} from '../database/testing.js';
import {createApp} from '../app.js';
import {readConfig} from '../config.js';
import Book from '../models/Book.js';
import DailyFeatured from '../models/DailyFeatured.js';
import {dayKey} from '../services/content.js';
import {selectDailyFeatured, ensureDailyFeatured, dailyFeaturedBooks} from '../services/daily-featured.js';

const fixture = Array.from({length: 150}, (_, i) => ({_id: (i + 1).toString(16).padStart(24, '0'), title: `每日推荐${i}`,
  views: 1000 - i, rating: 4.5 + i % 5 / 10, category: ['玄幻', '历史', '都市', '仙侠', '科幻'][i % 5], author: `作者${i % 70}`}));
const ids = books => books.map(book => String(book._id));

test('daily banner chooses three unique positions 50–100, rotates without yesterday, and handles small libraries', () => {
  const first = selectDailyFeatured(fixture, '2026-09-22');
  assert.equal(first.books.length, 3); assert.equal(new Set(ids(first.books)).size, 3);
  assert(first.ranks.every(rank => rank >= 50 && rank <= 100));
  assert.deepEqual(first, selectDailyFeatured(fixture.toReversed(), '2026-09-22'));
  const next = selectDailyFeatured(fixture, '2026-09-23', ids(first.books));
  assert(next.books.every(book => !ids(first.books).includes(String(book._id))));
  assert(new Set(first.books.map(book => book.category)).size >= 2);
  assert.equal(selectDailyFeatured(fixture.slice(0, 2), '2026-09-22').books.length, 2);
  assert.equal(selectDailyFeatured(fixture.slice(0, 50), '2026-09-22').books.length, 3);
  assert.deepEqual(selectDailyFeatured([], '2026-09-22').books, []);
});

test('daily banner persists once, remains stable after views change, excludes hidden books and changes at the next Shanghai day', async () => {
  const database = await TestDatabase.create();
  await mongoose.connect(database.getUri(), {autoIndex: false});
  const config = readConfig({APP_ENV: 'test', DATABASE_URL: database.getUri(), JWT_SECRET: crypto.randomBytes(48).toString('hex')});
  const server = createApp(config).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const now = new Date(), today = dayKey(now), next = new Date(new Date(`${today}T00:00:00+08:00`).getTime() + 86400000);
  try {
    await Book.insertMany(fixture);
    await Book.create([{title: 'private', visibility: 'private', views: 100000}, {title: 'deleted', deletedAt: now, views: 100000}]);
    const filter = {deletedAt: null, visibility: {$ne: 'private'}};
    const fallback = await dailyFeaturedBooks(filter, 0, 3, now);
    assert.equal(fallback.rows.length, 3); assert.equal(await DailyFeatured.countDocuments(), 0);
    const [first, repeated] = await Promise.all([ensureDailyFeatured(now), ensureDailyFeatured(now)]);
    assert.deepEqual(first.bookIds.map(String), repeated.bookIds.map(String));
    assert.deepEqual(ids(fallback.rows), first.bookIds.map(String));
    assert(first.ranks.every(rank => rank >= 50 && rank <= 100));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/books?orderBy=featured_daily&limit=3`);
    assert.equal(response.status, 200); assert.equal(response.headers.get('x-total-count'), '3');
    assert.deepEqual((await response.json()).map(book => book.id), first.bookIds.map(String));
    await Book.updateOne({_id: first.bookIds[0]}, {$set: {views: 1000000}});
    assert.deepEqual((await ensureDailyFeatured(now)).bookIds.map(String), first.bookIds.map(String));
    assert.deepEqual(ids((await dailyFeaturedBooks(filter, 0, 3, next)).rows), first.bookIds.map(String));
    const second = await ensureDailyFeatured(next);
    assert(second.bookIds.every(id => !first.bookIds.map(String).includes(String(id))));
    await Book.updateOne({_id: second.bookIds[0]}, {$set: {visibility: 'private'}});
    assert.equal((await dailyFeaturedBooks(filter, 0, 3, next)).rows.length, 2);
    assert.equal(await DailyFeatured.countDocuments(), 2);
  } finally {
    await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); await database.stop();
  }
});
