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
import Review from '../models/Review.js';
import User from '../models/User.js';
import {ratingSummary} from '../services/book-statistics.js';
import {makeRatingPlan, applyRatingPlan} from '../../infra/seed-rating-samples.mjs';

test('rating samples are bounded, repeatable and correlated with views without identical counts', () => {
  const books = Array.from({length: 300}, (_, i) => ({_id: String(i).padStart(24, '0'), title: `Book ${i}`, views: 1000 + i * 1000, rating: 4.7}));
  const plan = makeRatingPlan(books);
  assert.deepEqual(makeRatingPlan(books), plan);
  assert(plan.every(row => row.votes.length >= 1 && row.votes.length <= 50 && row.votes.every(value => Number.isInteger(value) && value >= 1 && value <= 5)));
  const mean = rows => rows.reduce((sum, row) => sum + row.votes.length, 0) / rows.length;
  assert(mean(plan.slice(-50)) > mean(plan.slice(0, 50)) + 20);
  assert(plan.some((row, index) => index && row.votes.length < plan[index - 1].votes.length));
  assert(new Set(plan.map(row => row.votes.length)).size > 25);
});

test('zero and malformed totals never divide by zero or produce NaN; stored votes drive the average', () => {
  for (const book of [{}, {statisticsSeed: {rating: Infinity, ratingWeight: 0}}, {statisticsSeed: {rating: 5, ratingWeight: -3}}]) {
    for (const [average, count] of [[0, 0], [NaN, 1], [Infinity, 2], [4, -1]]) assert.equal(ratingSummary(book, average, count).rating, 0);
  }
  assert.deepEqual(ratingSummary({statisticsSeed: {rating: 1, ratingWeight: 999, ratingSample: {votes: [5, 4]}}}, 1, 1),
    {rating: 10 / 3, count: 3, readerCount: 1, readerSum: 1, baselineCount: 2, baselineSum: 9});
});

test('reader-only votes, concurrent edits and sample initialization preserve counts, comments and existing data', async () => {
  const database = await TestDatabase.create();
  const config = readConfig({APP_ENV: 'test', DATABASE_URL: database.getUri(), JWT_SECRET: crypto.randomBytes(48).toString('hex')});
  await mongoose.connect(config.uri, {autoIndex: false});
  for (const model of Object.values(mongoose.models)) await model.createIndexes();
  const server = createApp(config).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  function client() {
    const jar = new Map();
    async function request(url, body) {
      const headers = {};
      if (body) {headers['x-csrf-token'] = (await request('/api/auth/csrf')).data.csrfToken; headers.origin = 'http://127.0.0.1:3000'; headers['content-type'] = 'application/json';}
      headers.cookie = [...jar].map(([key, value]) => `${key}=${value}`).join('; ');
      const response = await fetch(base + url, {method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined});
      for (const cookie of response.headers.getSetCookie()) {const [key, ...value] = cookie.split(';')[0].split('='); jar.set(key, value.join('='));}
      return {status: response.status, headers: response.headers, data: await response.json()};
    }
    return request;
  }
  try {
    const password = await bcrypt.hash('Test-password-123', 10);
    const users = await User.create(['one', 'two'].map(name => ({username: name, email: name + '@example.test', password})));
    const clients = users.map(() => client());
    for (let i = 0; i < 2; i++) assert.equal((await clients[i]('/api/auth/signin', {email: users[i].email, password: 'Test-password-123'})).status, 200);
    const seed = {runId: 'old', source: 'legacy', views: 600, favorites: 123, rating: 4.7, ratingWeight: 120, initializedAt: new Date('2026-09-01')};
    const book = await Book.create({title: 'Rated work', author: 'Writer', views: 1000, statisticsSeed: seed});
    const endpoint = `/api/books/${book.id}/reviews`, audit = [];
    const row = {...makeRatingPlan([book.toObject()])[0], votes: [5, 4]};
    const options = {runId: 'sample-test', writeAudit: async row => audit.push(row)};
    assert.equal((await applyRatingPlan([row], options))[0].status, 'initialized');
    assert.equal(await Review.countDocuments(), 0);
    const unchanged = (await Book.findById(book._id)).toObject();
    assert.equal(unchanged.statisticsSeed.ratingWeight, 2); assert.equal(unchanged.statisticsSeed.rating, 4.5);
    assert.equal(unchanged.views, 1000); assert.equal(unchanged.statisticsSeed.favorites, 123);
    assert.equal(+unchanged.updatedAt, +book.updatedAt); assert.equal(unchanged.writeVersion, book.writeVersion);
    assert.equal((await applyRatingPlan([row], options))[0].status, 'already-initialized');
    assert.deepEqual((await Book.findById(book._id)).toObject(), unchanged);
    const results = await Promise.all(clients.map((request, i) => request(endpoint, {rating: i ? 5 : 1})));
    assert(results.every(row => row.status === 201));
    let saved = await Book.findById(book._id);
    assert.equal(saved.rating, 15 / 4); assert.equal(saved.numRatings, 2); assert.equal(saved.numReviews, 0);
    let listing = await clients[0](endpoint);
    assert.deepEqual(listing.data, []); assert.equal(listing.headers.get('X-Total-Count'), '0');
    assert.equal(JSON.parse(listing.headers.get('X-Rating-Summary')).readerCount, 2);
    assert.equal((await clients[0](endpoint + '/mine')).data.rating, 1);
    await clients[0](endpoint, {rating: 4, content: 'Existing reader text'});
    await clients[0](endpoint, {rating: 3});
    assert.equal((await clients[0](endpoint + '/mine')).data.content, 'Existing reader text');
    listing = await clients[0](endpoint);
    assert.equal(listing.data.length, 1); assert.equal(listing.headers.get('X-Total-Count'), '1');
    for (const body of [{rating: 0}, {rating: 6}, {rating: 2.5}, {rating: 4, content: null}, {rating: 4, user: users[1].id}]) assert.equal((await clients[0](endpoint, body)).status, 400);
    await Promise.all([clients[0](endpoint, {rating: 2, content: ''}), clients[1](endpoint, {rating: 4, content: ''})]);
    saved = await Book.findById(book._id);
    assert.equal(saved.numRatings, 2); assert.equal(saved.numReviews, 0); assert.equal(saved.rating, 15 / 4);
    const retries = await Promise.all(Array.from({length: 3}, () => clients[0](endpoint, {rating: 2, content: ''})));
    assert(retries.every(row => row.status === 201));
    assert.equal((await Book.findById(book._id)).rating, 15 / 4);
    assert.equal(await Review.countDocuments(), 2); assert.equal(await User.countDocuments(), 2);
    const fresh = await Book.create({title: 'First real vote'});
    assert.equal((await clients[0](`/api/books/${fresh.id}/reviews`, {rating: 5})).status, 201);
    assert.equal((await Book.findById(fresh._id)).rating, 5);
    const failure = await Book.create({title: 'Audit failure'});
    await assert.rejects(applyRatingPlan(makeRatingPlan([failure.toObject()]), {...options, writeAudit: async () => {throw Error('Disk failure');}}));
    assert.equal((await Book.findById(failure._id)).statisticsSeed, undefined);
    assert(audit.some(row => row.phase === 'prepared'));
  } finally {await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); await database.stop();}
});
