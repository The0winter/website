import Book from '../models/Book.js';
import ReadingPosition from '../models/ReadingPosition.js';
import {asyncRoute} from '../security.js';
import {positionId, positionJson, saveReadingPosition} from '../services/reading-position.js';

export function readingProgressRoutes(app, auth) {
  const available = async (req, res, next) => {
    if (!/^[a-f0-9]{24}$/i.test(req.params.bookId)) return res.status(400).json({code: 'INVALID_BOOK', error: '作品参数无效'});
    const book = await Book.findOne({_id: req.params.bookId, deletedAt: null}).select('visibility author_id').lean();
    if (req.method !== 'DELETE' && (!book || (book.visibility === 'private' &&
        String(book.author_id) !== req.user.id && req.user.role !== 'admin'))) {
      return res.status(404).json({code: 'BOOK_UNAVAILABLE', error: '作品不可用'});
    }
    res.set('Cache-Control', 'private, no-store'); next();
  };
  app.get('/api/v1/me/reading-progress/:bookId', auth.authenticate, asyncRoute(available), asyncRoute(async (req, res) => {
    const row = await ReadingPosition.findById(positionId(req.user.id, req.params.bookId)).lean();
    res.json(positionJson(row));
  }));
  for (const method of ['put', 'delete']) app[method]('/api/v1/me/reading-progress/:bookId', auth.authenticate,
    asyncRoute(available), asyncRoute(async (req, res) => {
      try { res.json(await saveReadingPosition(req.user.id, req.params.bookId, req.body, {remove: method === 'delete'})); }
      catch (error) {
        if (!error.status || !error.code) throw error;
        res.status(error.status).json({code: error.code, error: error.message, ...error.details});
      }
    }));
}
