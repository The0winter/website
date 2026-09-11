import mongoose from 'mongoose';
import Book from '../models/Book.js';
import Chapter from '../models/Chapter.js';
import Bookmark from '../models/Bookmark.js';
import ReadingHistory from '../models/ReadingHistory.js';
import {asyncRoute} from '../security.js';
import {fail} from '../services/content.js';
import {pagination} from '../services/pagination.js';

const own = (req, res, next) => String(req.user.id) === req.params.userId ? next() : res.status(403).json({error: '无权限'});
const objectId = value => {
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) fail(400, 'ID无效');
  return new mongoose.Types.ObjectId(value);
};

export function libraryRoutes(app, auth) {
  app.post('/api/users/:userId/history', auth.authenticate, own, asyncRoute(async (req, res) => {
    const bookId = objectId(req.body.bookId);
    const chapterId = req.body.chapterId ? objectId(req.body.chapterId) : null;
    if (!await Book.exists({_id: bookId, deletedAt: null})) fail(404, '作品不可用');
    if (chapterId && !await Chapter.exists({_id: chapterId, bookId, deletedAt: null})) fail(404, '章节不可用');
    const now = new Date();
    const fields = {lastVisitedAt: now, ...(chapterId ? {chapterId, lastReadAt: now} : {})};
    const filter = {userId: req.user.id, bookId};
    try {
      await ReadingHistory.updateOne(filter, {$set: fields}, {upsert: true});
    } catch (error) {
      if (error.code !== 11000) throw error;
      await ReadingHistory.updateOne(filter, {$set: fields});
    }
    res.json({success: true});
  }));
  app.delete('/api/users/:userId/history/:bookId', auth.authenticate, own, asyncRoute(async (req, res) => {
    await ReadingHistory.deleteOne({userId: req.user.id, bookId: objectId(req.params.bookId)});
    res.json({success: true});
  }));
  app.get('/api/users/:userId/library', auth.authenticate, own, asyncRoute(async (req, res) => {
    const {limit, skip} = pagination(req.query);
    const {tab = 'shelf', sort = 'combined'} = req.query;
    if (!['shelf', 'history'].includes(tab) || !['combined', 'read', 'updated'].includes(sort)) fail(400, '排序参数无效');
    const userId = objectId(req.user.id);
    const history = tab === 'history';
    const model = history ? ReadingHistory : Bookmark;
    const filter = history ? {userId} : {user_id: userId};
    const pipeline = [{$match: filter}];
    if (history) pipeline.push({$set: {history: {lastVisitedAt: '$lastVisitedAt', lastReadAt: '$lastReadAt', chapterId: '$chapterId'}}});
    else pipeline.push(
      {$lookup: {from: ReadingHistory.collection.name, let: {book: '$bookId'}, pipeline: [{$match: {$expr: {$and: [{$eq: ['$bookId', '$$book']}, {$eq: ['$userId', userId]}]}}}], as: 'history'}},
      {$set: {history: {$first: '$history'}}},
    );
    pipeline.push(
      {$lookup: {from: Book.collection.name, localField: 'bookId', foreignField: '_id', as: 'book'}},
      {$set: {book: {$first: '$book'}}},
      {$set: {
        // lastUpdated tracks content; updatedAt also changes when views change.
        updated: {$ifNull: ['$book.lastUpdated', '$book.updatedAt', new Date(0)]},
        read: {$ifNull: history ? ['$history.lastReadAt', '$history.lastVisitedAt', new Date(0)] : ['$history.lastReadAt', new Date(0)]},
      }},
      {$set: {score: sort === 'read' ? '$read' : sort === 'updated' ? '$updated' : {$max: ['$read', '$updated']}}},
      {$sort: {score: -1, read: -1, updated: -1, _id: -1}}, {$skip: skip}, {$limit: limit},
    );
    const [rows, total] = await Promise.all([
      model.aggregate(pipeline).option({maxTimeMS: 5000}), model.countDocuments(filter).maxTimeMS(3000),
    ]);
    const bookIds = rows.filter(row => row.book && !row.book.deletedAt).map(row => row.book._id);
    const chapterIds = rows.map(row => row.history?.chapterId).filter(Boolean);
    const [latest, progress] = await Promise.all([
      Chapter.aggregate([{$match: {bookId: {$in: bookIds}, deletedAt: null}}, {$sort: {bookId: 1, chapter_number: -1}}, {$group: {_id: '$bookId', title: {$first: '$title'}}}]).option({maxTimeMS: 5000}),
      Chapter.find({_id: {$in: chapterIds}, deletedAt: null}).select('_id title').maxTimeMS(3000).lean(),
    ]);
    const latestByBook = new Map(latest.map(row => [String(row._id), row.title]));
    const progressById = new Map(progress.map(row => [String(row._id), row.title]));
    res.set('Cache-Control', 'no-store').set('X-Total-Count', String(total)).json(rows.map(row => ({
      bookId: String(row.bookId),
      book: row.book && !row.book.deletedAt ? {id: String(row.book._id), title: row.book.title, author: row.book.author, cover_image: row.book.cover_image, status: row.book.status, category: row.book.category, lastUpdated: row.book.lastUpdated || row.book.updatedAt} : null,
      lastReadAt: row.history?.lastReadAt,
      lastVisitedAt: row.history?.lastVisitedAt,
      chapterId: progressById.has(String(row.history?.chapterId)) ? String(row.history.chapterId) : null,
      chapterTitle: progressById.get(String(row.history?.chapterId)),
      latestChapterTitle: latestByBook.get(String(row.bookId)),
    })));
  }));
}
