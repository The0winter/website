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
import Bookmark from '../models/Bookmark.js';

test('detail bootstrap preserves previews, exact totals, access and partial-failure recovery', async () => {
  const database = await TestDatabase.create();
  const config = readConfig({APP_ENV:'test', DATABASE_URL:database.getUri(), JWT_SECRET:crypto.randomBytes(48).toString('hex')});
  await mongoose.connect(config.uri, {autoIndex:false});
  for (const model of Object.values(mongoose.models)) await model.createIndexes();
  const server = createApp(config).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async path => {const response = await fetch(base + path);return {status:response.status, headers:response.headers, data:await response.json()};};
  try {
    const book = await Book.create({title:'详情合并测试', author:'测试作者', description:'完整简介', views:210000,
      statisticsSeed:{favorites:3000, views:210000, rating:4, ratingWeight:30, runId:'detail-test', initializedAt:new Date()}});
    await Chapter.insertMany(Array.from({length:75}, (_,i) => ({bookId:book._id, title:`第${i*2+1}章`, chapter_number:i*2+1,
      content:'正文不应包含在首屏载荷中', word_count:100+i, ...(i===4 ? {deletedAt:new Date()} : {})})));
    const root = `/api/books/${book._id}`;
    const result = await get(root + '/detail');
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('cache-control'), 'private, no-store');
    assert.equal(result.data.book.title, book.title);
    assert.equal(result.data.book.id, String(book._id));
    assert.equal(result.data.catalog.total, 74);
    assert.equal(result.data.catalog.pageSize, 30);
    assert.deepEqual(result.data.catalog.rows, (await get(root+'/chapters?order=asc&limit=30')).data);
    assert.deepEqual(result.data.chapters, (await get(root+'/chapters?order=desc&limit=30')).data);
    assert.equal(result.data.totalWords, (await get(root+'/statistics')).data.totalWords);
    assert.deepEqual(result.data.milestones, (await get(root+'/milestones')).data);
    assert.ok(result.data.catalog.rows.every(row => !Object.hasOwn(row,'content')));
    assert.ok(result.data.chapters.every(row => !Object.hasOwn(row,'content')));
    const newChapter = await Chapter.create({bookId:book._id, title:'最新章', chapter_number:200, content:'新内容', word_count:333});
    await Book.updateOne({_id:book._id}, {$inc:{writeVersion:1}});
    const changed = (await get(root+'/detail')).data;
    assert.equal(changed.catalog.total, 75);
    assert.equal(changed.chapters[0].id, String(newChapter._id));
    assert.equal(changed.totalWords, result.data.totalWords+333);
    const empty = await Book.create({title:'暂无章节'});
    const emptyDetail = (await get(`/api/books/${empty._id}/detail`)).data;
    assert.deepEqual(emptyDetail.catalog, {rows:[], total:0, pageSize:30});
    assert.deepEqual(emptyDetail.chapters, []);
    assert.equal(emptyDetail.totalWords, 0);
    const privateBook = await Book.create({title:'未公开', visibility:'private', author_id:new mongoose.Types.ObjectId()});
    assert.equal((await get(`/api/books/${privateBook._id}/detail`)).status, 404);
    assert.equal((await get('/api/books/not-an-id/detail')).status, 400);
    assert.equal((await get(`/api/books/${new mongoose.Types.ObjectId()}/detail`)).status, 404);
    const originalCount = Bookmark.countDocuments;
    try {
      Bookmark.countDocuments = () => {throw new Error('milestones unavailable');};
      const degraded = await get(root+'/detail');
      assert.equal(degraded.status, 200);
      assert.equal(degraded.data.milestones, null);
      assert.equal(degraded.data.catalog.total, 75);
    } finally {Bookmark.countDocuments = originalCount;}
    const originalFind = Chapter.find;
    try {
      Chapter.find = () => {throw new Error('catalog unavailable');};
      // A warmed preview survives a catalog outage without another read.
      assert.equal((await get(root+'/detail')).data.catalog.total, 75);
      await Book.updateOne({_id:book._id}, {$inc:{writeVersion:1}});
      const degraded = await get(root+'/detail');
      assert.equal(degraded.status, 200);
      assert.equal(degraded.data.book.description, '完整简介');
      assert.equal(degraded.data.catalog, null);
      assert.equal(degraded.data.totalWords, null);
      assert.ok(degraded.data.milestones);
    } finally {Chapter.find = originalFind;}
    assert.equal((await get(root+'/detail')).data.catalog.total, 75);
    await Book.updateOne({_id:book._id}, {$set:{visibility:'private', author_id:new mongoose.Types.ObjectId()}});
    assert.equal((await get(root+'/detail')).status, 404, 'a cached preview never bypasses fresh access checks');
    await Book.updateOne({_id:book._id}, {$set:{visibility:'public'}});
    await Book.updateOne({_id:book._id}, {$set:{deletedAt:new Date()}});
    assert.equal((await get(root+'/detail')).status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect();await database.stop();
  }
});
