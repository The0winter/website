import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import {MongoMemoryReplSet} from 'mongodb-memory-server';
import {createApp} from '../app.js';
import {readConfig} from '../config.js';
import Book from '../models/Book.js';
import {dayKey} from '../services/content.js';
import {rankingPipeline} from '../services/ranking.js';

test('rankings combine real period views and ratings before pagination; browsing ignores ratings', async () => {
  const repl = await MongoMemoryReplSet.create({binary: {version: '7.0.40'}, replSet: {count: 1}});
  const config = readConfig({APP_ENV: 'test', MONGO_URI: repl.getUri('test1_test'), JWT_SECRET: crypto.randomBytes(48).toString('hex')});
  await mongoose.connect(config.uri, {autoIndex: false});
  const server = createApp(config).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/books?`;
  async function get(params) {
    const response = await fetch(base + new URLSearchParams(params));
    return {status: response.status, count: response.headers.get('x-total-count'), books: await response.json()};
  }
  try {
    const fields = ['daily_views', 'weekly_views', 'monthly_views', 'views'];
    const counts = value => Object.fromEntries(fields.map(field => [field, value]));
    const [popular, quality, quiet, unrated] = await Book.create([
      {title: 'Most viewed', category: '玄幻', rating: 1, ...counts(1000)},
      {title: 'Similar reach, better rating', category: '玄幻', rating: 5, ...counts(900)},
      {title: 'Great rating, little reach', category: '玄幻', rating: 5, ...counts(10)},
      {title: 'No ratings yet', category: '玄幻', ...counts(950)},
    ]);
    await Book.create({title: 'Deleted outlier', category: '玄幻', deletedAt: new Date(), rating: 5, ...counts(10000000)});
    const other = await Book.create({title: 'Other category', category: '都市', rating: 0, ...counts(1000000)});
    const daily = mongoose.connection.collection('readdailies'), today = dayKey(new Date());
    await daily.insertMany([popular, quality, quiet, unrated, other].map(book => ({_id: `${book._id}:${today}`, bookId: book._id, day: today, views: book.views})));
    const ordered = [quality, popular, unrated, quiet].map(b => String(b._id));
    for (const orderBy of ['rank_day', 'rank_week', 'rank_month', 'rank_total']) {
      const result = await get({orderBy, category: '玄幻', limit: '100'});
      assert.equal(result.status, 200); assert.equal(result.count, '4');
      assert.deepEqual(result.books.map(b => b.id), ordered);
      assert.deepEqual(result.books.map(b => b.rankingScore), [92, 84, 76, 20.8]);
      assert.ok(result.books.every(b => !('rankingMaxViews' in b)));
      const first = await get({orderBy, category: '玄幻', limit: '2'});
      const second = await get({orderBy, category: '玄幻', limit: '2', page: '2'});
      assert.deepEqual([...first.books, ...second.books], result.books);
      const ascending = await get({orderBy, category: '玄幻', order: 'asc'});
      assert.deepEqual(ascending.books.map(b => b.id), ordered.toReversed());
    }
    const browsing = await get({orderBy: 'views', category: '玄幻'});
    assert.deepEqual(browsing.books.map(b => b.id), [popular, unrated, quality, quiet].map(b => String(b._id)));
    assert.ok(browsing.books.every(b => !('rankingScore' in b)));
    assert.equal((await get({orderBy: 'rank_total'})).books[0].id, String(other._id));
    // Each period uses its own counter, including calendar reset to zero.
    await daily.updateOne({bookId: quiet._id}, {$set: {views: 2000}});
    assert.equal((await get({orderBy: 'rank_day', category: '玄幻'})).books[0].id, String(quiet._id));
    assert.equal((await get({orderBy: 'rank_total', category: '玄幻'})).books[0].id, String(quality._id));
    await daily.updateMany({}, {$set: {views: 0}});
    const zero = await get({orderBy: 'rank_day', category: '玄幻'});
    assert.ok(zero.books.every(b => Number.isFinite(b.rankingScore)));
    assert.equal(zero.books.at(-1).rankingScore, 0);
    // A good candidate beyond the first 100 raw-view results must still rank first.
    await Book.insertMany(Array.from({length: 101}, (_, i) => ({title: `Raw ${i}`, category: '历史', views: 1000 - i, rating: 0})));
    const winner = await Book.create({title: 'Outside raw top 100', category: '历史', views: 899, rating: 5});
    const global = await get({orderBy: 'rank_total', category: '历史', limit: '100'});
    assert.equal(global.books[0].id, String(winner._id)); assert.equal(global.books.length, 100);
    assert.equal(global.count, '102');
    assert.deepEqual((await get({orderBy: 'rank_day', category: '不存在'})).books, []);
    for (const orderBy of ['rank_unknown', '__proto__', 'constructor']) assert.equal((await get({orderBy})).status, 400);
    assert.equal((await get({orderBy: 'rank_day', limit: '101'})).status, 400);
    // Exact China-time midnight, Monday and month boundaries. Stale cached
    // daily/weekly/monthly fields must never leak into the live period counts.
    await daily.deleteMany({});
    await daily.insertMany([
      ['2026-08-31', 900], ['2026-09-06', 40], ['2026-09-07', 30],
      ['2026-09-13', 20], ['2026-09-14', 10], ['2026-09-15', 9999],
    ].map(([day, views]) => ({_id: `${popular._id}:${day}`, bookId: popular._id, day, views})));
    for (const [now, expected] of [
      ['2026-09-13T15:59:59Z', [20, 50, 90]],
      ['2026-09-13T16:00:00Z', [10, 10, 100]],
    ]) {
      for (const [index, sort] of ['rank_day', 'rank_week', 'rank_month'].entries()) {
        const [row] = await Book.aggregate(rankingPipeline({_id: popular._id}, sort, 'desc', 0, 1, new Date(now)));
        assert.equal(row.rankingViews, expected[index]);
      }
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect(); await repl.stop();
  }
});
