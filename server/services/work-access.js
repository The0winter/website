import mongoose from 'mongoose';
import Book from '../models/Book.js';
import Chapter from '../models/Chapter.js';
import User from '../models/User.js';
import {asyncRoute} from '../security.js';
import {readerBookProjection} from './reader-book.js';

export const publicWork = {visibility: {$ne: 'private'}};

// Installed before all book/chapter endpoints, including catalogs and comments.
export function workAccess(app, auth) {
  app.use(['/api/books/:workId', '/api/chapters/:chapterId'], asyncRoute(async (req, res, next) => {
    let bookId = req.params.workId, book, accessLoaded = false;
    const reading = ['GET', 'HEAD'].includes(req.method);
    const projection = {visibility: 1, author_id: 1, deletedAt: 1, writeVersion: 1};
    if (reading && req.path === '/' && (req.params.chapterId ? req.query.reader === '1' : req.query.fields === 'reader')) {
      Object.assign(projection, readerBookProjection);
    }
    if (reading && /^\/reviews\/?$/.test(req.path)) projection.statisticsSeed = 1;
    if (req.params.chapterId && /^[a-f\d]{24}$/i.test(req.params.chapterId)) {
      // The body endpoint needs this same document next. Keep it only for this
      // request; comments and mutations still load just the ownership key.
      const bodyRead = reading && req.path === '/';
      let chapter;
      if (bodyRead && !mongoose.connection.transport) {
        // MongoDB joins two indexed primary-key reads into one small reply.
        // The SQL adapter keeps indexed queries: its generic lookup would load
        // the entire books collection into the application process.
        const [row] = await Chapter.aggregate([
          {$match: {_id: new mongoose.Types.ObjectId(req.params.chapterId)}},
          {$lookup: {from: Book.collection.name, localField: 'bookId', foreignField: '_id',
            pipeline: [{$project: projection}], as: '_readBook'}},
        ]).option({maxTimeMS: 3000});
        if (row) {const {_readBook, ...value} = row; chapter = value; book = _readBook[0] ?? null;}
        accessLoaded = true;
      } else {
        const query = Chapter.findById(req.params.chapterId);
        if (!bodyRead) query.select('bookId');
        chapter = await query.maxTimeMS(3000).lean();
      }
      if (bodyRead) res.locals.readChapter = chapter;
      bookId = chapter?.bookId;
    }
    if (!bookId || !/^[a-f\d]{24}$/i.test(String(bookId))) return next();
    // Review summaries use the editorial rating seed; reading/catalog access
    // checks need only current permissions, deletion state and revision.
    if (!accessLoaded) book = await Book.findById(bookId).select(projection).maxTimeMS(3000).lean();
    res.locals.workAccess = {bookId, book};
    if (book?.visibility !== 'private') return next();
    res.set('Cache-Control', 'private, no-store');
    const userId = await auth.optionalUserId(req);
    if (!userId || (String(book.author_id) !== userId && !await User.exists({_id: userId, role: 'admin', isBanned: {$ne: true}}))) {
      return res.status(404).json({error: '作品不可用'});
    }
    next();
  }));
}
