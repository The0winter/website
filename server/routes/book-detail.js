import Book from '../models/Book.js';
import {asyncRoute} from '../security.js';
import {fail} from '../services/content.js';
import {readBookPreview} from '../services/book-preview.js';
import {bookMilestones} from '../services/book-milestones.js';

export function bookDetailRoutes(app) {
  // One access check and one shared index for the detail page's initial data.
  // Do not cache permissions, personal data, or book statistics across requests.
  app.get('/api/books/:bookId/detail', asyncRoute(async (req, res) => {
    const {bookId} = req.params;
    if (!/^[a-f0-9]{24}$/i.test(bookId)) fail(400, '作品ID无效');
    res.set('Cache-Control', 'private, no-store');
    const bookRead = Book.findOne({_id:bookId, deletedAt:null}).populate('author_id', 'username id').maxTimeMS(3000).lean().exec();
    const [book, [preview, milestones]] = await Promise.all([bookRead, Promise.allSettled([
      readBookPreview(bookId, res.locals.workAccess),
      bookRead.then(book => book ? bookMilestones(book) : null),
    ])]);
    if (!book) fail(404, '作品不可用');
    // A statistics/catalog outage must still leave the description readable.
    res.json({book:{...book, id:String(book._id)},
      ...(preview.status === 'fulfilled' ? preview.value : {catalog:null, chapters:[], totalWords:null}),
      milestones:milestones.status === 'fulfilled' ? milestones.value : null});
  }));
}
