import Book from '../models/Book.js';
import Chapter from '../models/Chapter.js';
import User from '../models/User.js';
import {asyncRoute} from '../security.js';

export const publicWork = {visibility: {$ne: 'private'}};

// Installed before all book/chapter endpoints, including catalogs and comments.
export function workAccess(app, auth) {
  app.use(['/api/books/:workId', '/api/chapters/:chapterId'], asyncRoute(async (req, res, next) => {
    let bookId = req.params.workId;
    if (req.params.chapterId && /^[a-f\d]{24}$/i.test(req.params.chapterId)) {
      // The body endpoint needs this same document next. Keep it only for this
      // request; comments and mutations still load just the ownership key.
      const bodyRead = ['GET', 'HEAD'].includes(req.method) && req.path === '/';
      const query = Chapter.findById(req.params.chapterId);
      if (!bodyRead) query.select('bookId');
      const chapter = await query.maxTimeMS(3000).lean();
      if (bodyRead) res.locals.readChapter = chapter;
      bookId = chapter?.bookId;
    }
    if (!bookId || !/^[a-f\d]{24}$/i.test(String(bookId))) return next();
    const book = await Book.findById(bookId).select('visibility author_id deletedAt writeVersion statisticsSeed').maxTimeMS(3000).lean();
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
