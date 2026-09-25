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
    if (!await Book.exists({_id: bookId, deletedAt: null, visibility: {$ne: 'private'}})) fail(404, '作品不可用');
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
    // D1's generic $lookup fallback reads entire joined collections. Restrict
    // both sides explicitly, retaining global sorting before pagination.
    const entries = await model.find(filter).select('_id bookId lastVisitedAt lastReadAt chapterId').maxTimeMS(3000).lean();
    const ids = entries.map(row => row.bookId);
    const [books, visits] = ids.length ? await Promise.all([
      Book.find({_id: {$in: ids}}).select('_id title author cover_image status category lastUpdated deletedAt visibility').maxTimeMS(3000).lean(),
      history ? entries : ReadingHistory.find({userId, bookId: {$in: ids}}).select('bookId lastVisitedAt lastReadAt chapterId').maxTimeMS(3000).lean(),
    ]) : [[], []];
    const booksById = new Map(books.map(book => [String(book._id), book]));
    const visitsByBook = new Map(visits.map(visit => [String(visit.bookId), visit]));
    const total = entries.length;
    const rows = entries.map(entry => {
      const book = booksById.get(String(entry.bookId)), visit = visitsByBook.get(String(entry.bookId));
      // Only a recorded chapter update participates in publication sorting.
      const updated = +new Date(book?.lastUpdated ?? 0);
      const read = +new Date(visit?.lastReadAt ?? (history ? visit?.lastVisitedAt : undefined) ?? 0);
      return {...entry, book, history: visit, updated, read, score: sort === 'read' ? read : sort === 'updated' ? updated : Math.max(read, updated)};
    }).sort((a, b) => b.score - a.score || b.read - a.read || b.updated - a.updated || String(b._id).localeCompare(String(a._id))).slice(skip, skip + limit);
    const bookIds = rows.filter(row => row.book && !row.book.deletedAt && row.book.visibility !== 'private').map(row => row.book._id);
    const chapterIds = rows.map(row => row.history?.chapterId).filter(Boolean);
    const [latest, progress] = await Promise.all([
      Promise.all(bookIds.map(async bookId => {
        const filter = {bookId, deletedAt: null};
        const [first, last] = await Promise.all([
          Chapter.findOne(filter).sort({chapter_number: 1}).select('_id').maxTimeMS(3000).lean(),
          Chapter.findOne(filter).sort({chapter_number: -1}).select('title').maxTimeMS(3000).lean(),
        ]);
        return {_id: bookId, title: last?.title, firstChapterId: first?._id};
      })),
      Chapter.find({_id: {$in: chapterIds}, bookId: {$in: bookIds}, deletedAt: null}).select('_id title').maxTimeMS(3000).lean(),
    ]);
    const latestByBook = new Map(latest.map(row => [String(row._id), row.title]));
    const firstByBook = new Map(latest.filter(row => row.firstChapterId).map(row => [String(row._id), String(row.firstChapterId)]));
    const progressById = new Map(progress.map(row => [String(row._id), row.title]));
    res.set('Cache-Control', 'no-store').set('X-Total-Count', String(total)).json(rows.map(row => ({
      bookId: String(row.bookId),
      book: row.book && !row.book.deletedAt && row.book.visibility !== 'private' ? {id: String(row.book._id), title: row.book.title, author: row.book.author, cover_image: row.book.cover_image, status: row.book.status, category: row.book.category, lastUpdated: row.book.lastUpdated} : null,
      lastReadAt: row.history?.lastReadAt,
      lastVisitedAt: row.history?.lastVisitedAt,
      chapterId: progressById.has(String(row.history?.chapterId)) ? String(row.history.chapterId) : null,
      chapterTitle: progressById.get(String(row.history?.chapterId)),
      firstChapterId: firstByBook.get(String(row.bookId)) || null,
      latestChapterTitle: latestByBook.get(String(row.bookId)),
    })));
  }));
}
