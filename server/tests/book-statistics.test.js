import '../../tools/test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import {TestDatabase} from '../database/testing.js';
import {createApp} from '../app.js';
import {readConfig} from '../config.js';
import Book from '../models/Book.js';
import Bookmark from '../models/Bookmark.js';
import Review from '../models/Review.js';
import Chapter from '../models/Chapter.js';
import User from '../models/User.js';
import {makePlan, applyPlan} from '../../infra/seed-book-statistics.mjs';

test('ranking initialization varies metrics within bounds and assigns unranked books upper-middle values', () => {
  const books = Array.from({length: 501}, (_, i) => ({_id: i, title: `Book ${i}`, author: 'Writer'}));
  const snapshot = {source: 'https://www.qidian.com/rank/yuepiao/', observedAt: '2026-09-21', rows: books.slice(0, 500).map((b, i) => ({...b, rank: i + 1}))};
  const plan = makePlan(books, snapshot);
  assert.deepEqual(plan, makePlan(books, snapshot));
  assert(plan.every(row => row.views >= 2000 && row.views <= 50000 && row.favorites >= 100 && row.favorites <= 2000 && row.rating >= 8.9 && row.rating <= 9.9));
  assert(plan[0].views > plan[50].views && plan[50].views > plan[250].views && plan[250].views > plan[499].views);
  assert(plan.slice(1, 500).some((row, i) => row.views > plan[i].views), 'local variation avoids exact rank copying');
  assert.equal(plan[500].rank, null);
  assert(plan[500].views > 29000 && plan[500].views < 39000);
});

test('seeds preserve real records, survive review edits and remain idempotent with transactional audits', async () => {
  const database = await TestDatabase.create();
  const config = readConfig({APP_ENV: 'test', DATABASE_URL: database.getUri(), JWT_SECRET: crypto.randomBytes(48).toString('hex')});
  await mongoose.connect(config.uri, {autoIndex: false});
  for (const model of Object.values(mongoose.models)) await model.createIndexes();
  const server = createApp(config).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`, jar = new Map();
  async function request(url, method = 'GET', body) {
    const headers = {};
    if (method !== 'GET') {headers['x-csrf-token'] = (await request('/api/auth/csrf')).data.csrfToken; headers.origin = 'http://127.0.0.1:3000';}
    headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    if (body) headers['content-type'] = 'application/json';
    const response = await fetch(base + url, {method, headers, body: body ? JSON.stringify(body) : undefined});
    for (const cookie of response.headers.getSetCookie()) {const [k, ...v] = cookie.split(';')[0].split('='); jar.set(k, v.join('='));}
    assert(response.headers.get('content-type')?.includes('application/json'), method + ' ' + url + ': ' + response.status);
    return {status: response.status, headers: response.headers, data: await response.json()};
  }
  try {
    const user = await User.create({username: 'statistics-reader', email: 'statistics@example.test', password: await bcrypt.hash('Test-password-123', 10)});
    const book = await Book.create({title: 'Seeded book', author: 'Writer', views: 11, rating: 5, numReviews: 1});
    const chapter = await Chapter.create({bookId: book._id, title: 'Chapter', chapter_number: 1, content: 'Preserve this chapter.'});
    await Bookmark.create({bookId: book._id, user_id: user._id});
    await Review.create({book: book._id, user: user._id, rating: 5, content: 'Existing real review'});
    const row = {id: book.id, title: book.title, author: book.author, rank: 3, views: 42001, favorites: 999, rating: 9.7};
    const audit = [], options = {runId: 'test-seed', source: 'test-ranking', writeAudit: async entry => audit.push(entry)};
    assert.equal((await applyPlan([row], options))[0].status, 'seeded');
    const saved = await Book.findById(book._id).lean();
    assert.equal(saved.views, 42001); assert.equal(saved.statisticsSeed.views, 41990); assert.equal(saved.statisticsSeed.favorites, 998);
    assert.equal(+saved.updatedAt, +book.updatedAt); assert.equal(saved.writeVersion, book.writeVersion);
    assert.equal(audit[0].before.views, 11); assert.equal(audit.at(-1).phase, 'completed');
    assert.equal(await Bookmark.countDocuments(), 1); assert.equal(await Review.countDocuments(), 1); assert.equal(await User.countDocuments(), 1);
    const root = `/api/books/${book.id}`;
    const reviews = await request(root + '/reviews');
    assert.equal(Number(reviews.headers.get('X-Book-Rating')), saved.rating);
    assert.equal(reviews.data.length, 1); assert.equal(reviews.headers.get('X-Total-Count'), '1');
    let milestones = (await request(root + '/milestones')).data;
    assert.equal(milestones.counts.favorites, 999); assert.equal(milestones.counts.views, 42001);
    assert(milestones.events.every(event => event.achievedAt === null));
    assert.equal((await applyPlan([row], options))[0].status, 'already-seeded');
    assert.equal((await Book.findById(book._id)).views, 42001);
    assert.equal((await request('/api/auth/signin', 'POST', {email: user.email, password: 'Test-password-123'})).status, 200);
    const shelf = `/api/users/${user.id}/bookmarks`;
    assert.equal((await request(shelf + '/' + book.id, 'DELETE')).status, 200);
    assert.equal((await request(root + '/milestones')).data.counts.favorites, 998);
    assert.equal((await request(shelf, 'POST', {bookId: book.id})).status, 200);
    assert.equal((await request(root + '/milestones')).data.counts.favorites, 999);
    assert.equal((await request(root + '/reviews', 'POST', {rating: 1, content: 'Edited real review'})).status, 201);
    const afterReview = await Book.findById(book._id);
    assert(afterReview.rating < saved.rating && afterReview.rating > 4.5);
    assert.equal(afterReview.numReviews, 1); assert.equal(await Review.countDocuments(), 1);
    assert.equal(Number((await request(root + '/reviews')).headers.get('X-Book-Rating')), afterReview.rating);
    assert.equal((await request(root + '/views', 'POST', {chapterId: chapter.id})).data.counted, true);
    assert.equal((await request(root + '/milestones')).data.counts.views, 42002);
    assert.equal((await Chapter.findById(chapter._id)).content, chapter.content);
    const other = await Book.create({title: 'Audit failure', author: 'Writer'});
    await assert.rejects(applyPlan([{...row, id: other.id, title: other.title}], {...options, writeAudit: async () => {throw Error('disk failure');}}));
    assert.equal((await Book.findById(other._id)).statisticsSeed, undefined);
    assert.equal((await Book.findById(other._id)).views, 0);
  } finally {await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); await database.stop();}
});
