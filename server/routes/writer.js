import mongoose from 'mongoose';
import Book from '../models/Book.js';
import Manuscript from '../models/Manuscript.js';
import ChapterRead from '../models/ChapterRead.js';
import {asyncRoute} from '../security.js';
import {pagination} from '../services/pagination.js';
import {dayKey, fail} from '../services/content.js';
import {writingWorkspaceRoutes} from './writing-workspace.js';

export function periodStart(day, period) {
  const date = new Date(day + 'T00:00:00Z');
  if (period === 'month') date.setUTCDate(1);
  if (period === 'week') date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}
export function movePeriod(day, period, amount) {
  const date = new Date(day + 'T00:00:00Z');
  if (period === 'month') date.setUTCMonth(date.getUTCMonth() + amount);
  else date.setUTCDate(date.getUTCDate() + amount * (period === 'week' ? 7 : 1));
  return date.toISOString().slice(0, 10);
}

export function writerRoutes(app, auth) {
  writingWorkspaceRoutes(app, auth);
  app.get('/api/writer/works', auth.authenticate, asyncRoute(async (req, res) => {
    const {skip, limit} = pagination(req.query);
    const owner = new mongoose.Types.ObjectId(req.user.id);
    const filter = {author_id: owner, deletedAt: null};
    const drafts = {owner, publishedBookId: null};
    const [rows, bookCount, draftCount] = await Promise.all([
      Book.aggregate([
        {$match: filter}, {$set: {id: {$toString: '$_id'}}},
        {$unionWith: {coll: Manuscript.collection.name, pipeline: [
          {$match: drafts}, {$project: {id: '$_id', title: 1, description: 1, cover_image: 1, category: 1, updatedAt: 1, createdAt: 1,
            visibility: {$literal: 'private'}, manuscriptKey: {$arrayElemAt: [{$split: ['$_id', ':']}, -1]}, views: {$literal: 0}}},
        ]}},
        {$sort: {updatedAt: -1, _id: 1}}, {$skip: skip}, {$limit: limit},
      ]).option({maxTimeMS: 5000}),
      Book.countDocuments(filter), Manuscript.countDocuments(drafts),
    ]);
    res.set('Cache-Control', 'private, no-store').set('X-Total-Count', String(bookCount + draftCount)).json(rows);
  }));

  app.get('/api/writer/statistics', auth.authenticate, asyncRoute(async (req, res) => {
    const period = req.query.period || 'day';
    if (!['day', 'week', 'month'].includes(period)) fail(400, '统计周期无效');
    const today = dayKey();
    const end = req.query.end || today;
    if (typeof end !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(end) || !Number.isFinite(Date.parse(end)) || new Date(end).toISOString().slice(0, 10) !== end || end > today || end < '2000-01-01') fail(400, '统计日期无效');
    const owner = new mongoose.Types.ObjectId(req.user.id);
    const books = await Book.find({author_id: owner, deletedAt: null}).select('_id views').lean();
    const bookIds = books.map(book => book._id);
    const daily = mongoose.connection.collection('readdailies');
    const latest = periodStart(end, period);
    const count = period === 'day' ? 30 : 12;
    const start = movePeriod(latest, period, 1 - count);
    const stop = movePeriod(latest, period, 1);
    const [days, first, best] = await Promise.all([
      daily.aggregate([{$match: {bookId: {$in: bookIds}, day: {$gte: start, $lt: stop}}}, {$group: {_id: '$day', views: {$sum: '$views'}}}]).toArray(),
      daily.find({bookId: {$in: bookIds}}).sort({day: 1}).limit(1).toArray(),
      ChapterRead.aggregate([{$match: {bookId: {$in: bookIds}}},
        {$lookup: {from: 'chapters', localField: '_id', foreignField: '_id', as: 'chapter'}}, {$unwind: '$chapter'}, {$match: {'chapter.deletedAt': null}},
        {$sort: {views: -1, _id: 1}}, {$limit: 1}, {$project: {views: 1, title: '$chapter.title', chapterNumber: '$chapter.chapter_number'}},
      ]),
    ]);
    const historyStart = first[0]?.day || today;
    const totals = new Map();
    for (const row of days) { const key = periodStart(row._id, period); totals.set(key, (totals.get(key) || 0) + row.views); }
    const points = Array.from({length: count}, (_, index) => {
      const date = movePeriod(start, period, index);
      return {date, views: movePeriod(date, period, 1) <= historyStart ? null : totals.get(date) || 0};
    });
    res.set('Cache-Control', 'private, no-store').json({period, points, historyStart, totalViews: books.reduce((sum, book) => sum + (book.views || 0), 0),
      bestChapter: best[0] || null, hasPrevious: start > periodStart(historyStart, period), hasNext: latest < periodStart(today, period),
      previousEnd: movePeriod(start, 'day', -1), nextEnd: movePeriod(latest, period, count) > today ? today : movePeriod(latest, period, count),
    });
  }));
}
