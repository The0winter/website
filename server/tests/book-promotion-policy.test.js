import '../../tools/test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {TestDatabase} from '../database/testing.js';
import Book from '../models/Book.js';
import Daily from '../models/ReadDaily.js';
import DailyFeatured from '../models/DailyFeatured.js';
import Bookmark from '../models/Bookmark.js';
import {createApp} from '../app.js';
import {isDoubanChineseTop100, allowsAutomaticStatistics, promotionWindow} from '../services/book-promotion-policy.js';
import {selectDiscoveryBooks} from '../services/discovery.js';
import {selectDailyFeatured, ensureDailyFeatured, dailyFeaturedBooks} from '../services/daily-featured.js';
import {initialStatisticsPlan, ensureBookStatistics, needsBookStatistics} from '../services/initial-book-statistics.js';
import {seedDailyPopularity} from '../jobs/daily-popularity.js';

test('verified title/author pairs cover traditional and collected editions without blocking unrelated titles', () => {
  for (const book of [{title:'红楼梦',author:'曹雪芹'}, {title:'亮劍',author:'都梁'},
    {title:'人·兽·鬼',author:'钱钟书'}, {title:'千江有水千江月',author:'蕭麗紅'},
    {title:'神雕侠侣（全四册）',author:'金庸'}]) assert(isDoubanChineseTop100(book));
  assert(!isDoubanChineseTop100({title:'红楼梦',author:'Other author'}));
  const excluded = {_id:'1',title:'活着',author:'余华',views:99999};
  const eligible = {_id:'2',title:'活着',author:'Other author',views:1};
  assert.deepEqual(selectDiscoveryBooks([excluded,eligible]), [eligible]);
  assert.deepEqual(selectDailyFeatured([excluded,eligible], '2026-09-28').books, [eligible]);
});

test('expiry is fixed to first publication, caps three Shanghai dates and blocks late initialization', () => {
  const book = {_id:'1',title:'活着',author:'余华',createdAt:new Date('2026-09-26T18:00:00+08:00')};
  const window = promotionWindow(book);
  assert.equal(window.lastDay,'2026-09-28');
  assert(allowsAutomaticStatistics(book,new Date(window.expiresAt-1)));
  assert(!allowsAutomaticStatistics(book,new Date(window.expiresAt)));
  assert(initialStatisticsPlan(book,{now:book.createdAt}).statisticsSeed.favorites>0);
  assert.equal(initialStatisticsPlan({...book,updatedAt:new Date(window.expiresAt+1000)}, {now:new Date(window.expiresAt)}),null);
  assert(!allowsAutomaticStatistics({...book,statisticsSeed:{initializedAt:new Date(window.expiresAt)}},new Date(window.expiresAt)));
  assert(!allowsAutomaticStatistics({title:'活着',author:'余华'}));
  assert(allowsAutomaticStatistics({...book,author:'Other author'},new Date(window.expiresAt)));
  assert.deepEqual([{...book,createdAt:new Date('2000-01-01')}].filter(needsBookStatistics),[], 'array filter index must not be used as the clock');
});

test('recommendation API filters before pagination, replaces legacy banners, and preserves search/rankings', async () => {
  const database=await TestDatabase.create();
  await mongoose.connect(database.getUri(),{autoIndex:false});
  const server=createApp({mode:'test',jwtSecret:'x'.repeat(40),origins:['http://127.0.0.1:3000'],trustProxy:'none',writeMode:'readwrite'}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const now=new Date('2026-09-28T12:00:00+08:00');
  try {
    const blocked=await Book.create({title:'活着',author:'余华',views:999999});
    const rows=await Book.create(Array.from({length:85},(_,i)=>({title:'Eligible '+i,author:'Writer',views:1000-i})));
    await DailyFeatured.create({_id:'2026-09-28',day:'2026-09-28',version:1,bookIds:[blocked._id],ranks:[1]});
    const fallback=await dailyFeaturedBooks({deletedAt:null},0,3,now);
    assert.equal(fallback.rows.length,3); assert(fallback.rows.every(b=>String(b._id)!==blocked.id));
    const updated=await ensureDailyFeatured(now);
    assert.equal(updated.version,2); assert.equal(updated.bookIds.length,3);
    assert.deepEqual(updated.bookIds.map(String),fallback.rows.map(b=>String(b._id)));
    const get=async query=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api/books?${query}`);assert.equal(r.status,200);return {books:await r.json(),total:+r.headers.get('x-total-count')};};
    for(const query of ['orderBy=discovery&limit=59','orderBy=featured_daily&limit=3','orderBy=views&recommendation=home&limit=100','orderBy=composite&recommendation=home&limit=100']) {
      const result=await get(query);assert(result.books.length);assert(result.books.every(b=>b.id!==blocked.id),query);
      if(query.includes('recommendation=home')) assert.equal(result.total,85);
    }
    assert((await get('q='+encodeURIComponent('活着'))).books.some(b=>b.id===blocked.id));
    assert.equal((await get('orderBy=views&limit=1')).books[0].id,blocked.id);
    // Even a stale current-version saved set cannot expose a now-excluded work.
    await DailyFeatured.updateOne({_id:'2026-09-28'},{$set:{bookIds:[blocked._id,rows[0]._id]}});
    assert.deepEqual((await dailyFeaturedBooks({},0,3,now)).rows.map(b=>String(b._id)),[rows[0].id]);
  } finally {await new Promise(resolve=>server.close(resolve));await mongoose.disconnect();await database.stop();}
});

test('three days only: expiry, downtime, replay and real activity never restart automatic growth', async () => {
  const database=await TestDatabase.create();await mongoose.connect(database.getUri(),{autoIndex:false});
  try {
    const createdAt=new Date('2026-09-26T18:00:00+08:00');
    const book=await Book.create({title:'活着',author:'余华',createdAt});
    const other=await Book.create({title:'Ordinary work',author:'Writer',createdAt});
    await mongoose.connection.transaction(async session=>{await ensureBookStatistics(await Book.findById(book.id).session(session),{session,now:createdAt});});
    const initial=await Book.findById(book.id).lean();
    const run=now=>seedDailyPopularity({startDay:'2026-09-20',now:new Date(now),apply:true});
    await run('2026-09-28T23:59:59+08:00');
    assert.equal(await Daily.countDocuments({bookId:book._id}),3);
    await run('2026-09-29T00:05:00+08:00');
    assert.equal(await Daily.countDocuments({bookId:book._id}),3,'no fourth calendar receipt before 72-hour cutoff');
    const before=await Book.findById(book.id).lean();
    const missed=await Book.create({title:'红楼梦',author:'曹雪芹',views:7,createdAt});
    await Daily.create({_id:`${book.id}:2026-10-01`,bookId:book._id,day:'2026-10-01',views:3});
    await Book.updateOne({_id:book._id},{$inc:{views:3},$set:{updatedAt:new Date('2026-10-01')}});
    await Bookmark.create({bookId:book._id,user_id:new mongoose.Types.ObjectId()});
    await run('2026-10-01T12:00:00+08:00');
    const preview=await seedDailyPopularity({startDay:'2026-09-20',now:new Date('2026-10-01T12:00:00+08:00')});
    assert.equal(preview.added,0);assert.equal(preview.pendingBooks,0);
    const saved=await Book.findById(book.id).lean();
    assert.equal(saved.views,before.views+3);assert.equal(saved.daily_views,3);
    assert.deepEqual(saved.statisticsSeed,initial.statisticsSeed);assert.equal(await Bookmark.countDocuments({bookId:book._id}),1);
    assert.equal(await Daily.countDocuments({bookId:missed._id}),0,'expired works do not catch up missed artificial growth');
    assert.equal(await Daily.countDocuments({bookId:other._id}),6,'other books retain daily growth');
    await mongoose.connection.transaction(async session=>{assert.equal(await ensureBookStatistics(await Book.findById(missed.id).session(session),{session,now:new Date('2026-10-01')}),false);});
    assert.equal((await Book.findById(missed.id)).views,7);
  } finally {await mongoose.disconnect();await database.stop();}
});
