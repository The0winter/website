import '../../tools/test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {TestDatabase} from '../database/testing.js';
import Book from '../models/Book.js';
import Daily from '../models/ReadDaily.js';
import {dailyPopularityViews, seedDailyPopularity} from '../jobs/daily-popularity.js';
import {rankedBooks} from '../services/ranking.js';

test('daily draws retain rank weighting with much larger daily variation and stable retries', () => {
  const mean = values => values.reduce((a, b) => a + b, 0) / values.length;
  const days = Array.from({length: 90}, (_, i) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10));
  const draws = [1, 50, 200, 500, null].map(rank => days.map(day => dailyPopularityViews({_id: 'book', statisticsSeed: {qidianRank: rank}}, day)));
  assert(draws.flat().every(views => Number.isInteger(views) && views >= 2000 && views <= 50000));
  assert(mean(draws[0]) > mean(draws[1]) && mean(draws[1]) > mean(draws[2]) && mean(draws[2]) > mean(draws[3]));
  assert(Math.max(...draws[1]) - Math.min(...draws[1]) > 12000);
  assert(mean(draws[4]) > 29000 && mean(draws[4]) < 39000);
  assert.equal(dailyPopularityViews({_id: 'book'}, days[0]), dailyPopularityViews({_id: 'book'}, days[0]));
});

test('daily receipts add once, catch up outages and aggregate genuine reads across Shanghai week/month boundaries', async () => {
  const database = await TestDatabase.create();
  await mongoose.connect(database.getUri(), {autoIndex: false});
  for (const model of Object.values(mongoose.models)) await model.createIndexes();
  try {
    const createdAt = new Date('2026-09-26T00:00:00+08:00');
    const book = await Book.create({title: 'Daily book', author: 'Writer', views: 10007, rating: 4.8, createdAt, updatedAt: createdAt});
    const hidden = await Book.create({title: 'Private', visibility: 'private', createdAt});
    const deleted = await Book.create({title: 'Deleted', deletedAt: new Date(), createdAt});
    await Daily.create({_id: `${book.id}:2026-09-27`, bookId: book._id, day: '2026-09-27', views: 7, expiresAt: new Date('2028-01-01')});
    const startDay = '2026-09-27', now = new Date('2026-09-27T23:59:00+08:00');
    const preview = await seedDailyPopularity({startDay, now});
    assert.equal(preview.added, 1); assert.equal((await Book.findById(book.id)).views, 10007);
    assert.equal(preview.views, dailyPopularityViews(book, startDay) - 7);
    const runs = await Promise.all([seedDailyPopularity({startDay, now, apply: true}), seedDailyPopularity({startDay, now, apply: true})]);
    assert.equal(runs.reduce((n, r) => n + r.added, 0), 1);
    const sunday = await Daily.findById(`${book.id}:2026-09-27`);
    assert.equal(sunday.views, sunday.baselineViews + 7); assert.equal(sunday.expiresAt, undefined);
    assert.equal(sunday.views, dailyPopularityViews(book, '2026-09-27'));
    assert.equal((await Book.findById(book.id)).views, 10007 + sunday.baselineViews);
    assert.equal((await seedDailyPopularity({startDay, now, apply: true})).added, 0);
    // UTC is still Sunday; Shanghai is Monday and a new ranking week has begun.
    const monday = new Date('2026-09-27T16:01:00Z');
    assert.equal((await seedDailyPopularity({startDay, now: monday, apply: true})).added, 1);
    let saved = await Book.findById(book.id);
    const mondayRow = await Daily.findById(`${book.id}:2026-09-28`);
    assert.equal(saved.daily_views, mondayRow.views); assert.equal(saved.weekly_views, mondayRow.views);
    assert.equal(saved.monthly_views, sunday.views + mondayRow.views);
    // A real read after initialization remains additive to both receipt and total.
    await mongoose.connection.transaction(async session => {
      await Daily.updateOne({_id: mondayRow.id}, {$inc: {views: 1}}, {session});
      await Book.updateOne({_id: book._id}, {$inc: {views: 1}}, {session, timestamps: false});
    });
    const october = new Date('2026-10-01T00:06:00+08:00');
    assert.equal((await seedDailyPopularity({startDay, now: october, apply: true})).added, 3, 'recover Sep 29, Sep 30 and Oct 1');
    const rows = await Daily.find({bookId: book._id}).sort({day: 1}).lean();
    saved = await Book.findById(book.id);
    assert.equal(rows.length, 5); assert.equal(saved.dailyPopularityThrough, '2026-10-01');
    assert.equal(saved.views, 10008 + rows.reduce((n, r) => n + r.baselineViews, 0));
    assert.equal(saved.daily_views, rows.at(-1).views); assert.equal(saved.monthly_views, rows.at(-1).views);
    assert.equal(saved.weekly_views, rows.slice(1).reduce((n, r) => n + r.views, 0));
    assert.equal(+saved.updatedAt, +createdAt); assert.equal(saved.rating, 4.8);
    for (const [sort, value] of [['rank_day', saved.daily_views], ['rank_week', saved.weekly_views], ['rank_month', saved.monthly_views], ['rank_total', saved.views]]) {
      const result = await rankedBooks({_id: book._id}, sort, 'desc', 0, 10, october);
      assert.equal(result.rows[0].rankingViews, value);
    }
    assert.equal((await Book.findById(hidden.id)).views, 0); assert.equal((await Book.findById(deleted.id)).views, 0);
    const fresh = await Book.create({title: 'Published after start', createdAt: new Date('2026-10-01T00:00:00+08:00')});
    assert.equal((await seedDailyPopularity({startDay, now: october, apply: true})).added, 1);
    assert.equal(await Daily.countDocuments({bookId: fresh._id}), 1);
    const popular = await Book.create({title: 'Already exceeds daily target', views: 60000, createdAt: october});
    await Daily.create({_id: `${popular.id}:2026-10-01`, bookId: popular._id, day: '2026-10-01', views: 60000});
    assert.equal((await seedDailyPopularity({startDay, now: october, apply: true})).added, 1);
    assert.equal((await Book.findById(popular.id)).views, 60000);
    assert.equal((await Daily.findById(`${popular.id}:2026-10-01`)).baselineViews, 0);
    await assert.rejects(seedDailyPopularity({startDay: '2026-11-01', now: october, apply: true}));
    await assert.rejects(seedDailyPopularity({startDay, now: new Date('2026-10-02T00:06:00+08:00'), apply: true, shouldStop: () => true}));
    assert.equal(await Daily.countDocuments({day: '2026-10-02'}), 0);
    const totalBefore = (await Book.findById(book.id)).views;
    // Force the second write to fail; neither half of the daily increment may survive.
    const update = Book.updateOne;
    Book.updateOne = function(filter, modifier, options) {
      if (modifier.$set?.dailyPopularityThrough === '2026-10-02') throw Error('injected failure');
      return update.call(this, filter, modifier, options);
    };
    try {await assert.rejects(seedDailyPopularity({startDay, now: new Date('2026-10-02T00:06:00+08:00'), apply: true}));}
    finally {Book.updateOne = update;}
    assert.equal(await Daily.countDocuments({day: '2026-10-02'}), 0); assert.equal((await Book.findById(book.id)).views, totalBefore);
  } finally {await mongoose.disconnect(); await database.stop();}
});
