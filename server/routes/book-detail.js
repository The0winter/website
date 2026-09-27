import Book from '../models/Book.js';
import Chapter from '../models/Chapter.js';
import {asyncRoute} from '../security.js';
import {fail} from '../services/content.js';
import {readBookIndex} from '../services/book-reading-index.js';
import {bookMilestones} from '../services/book-milestones.js';
import {verifyBookVersion} from '../services/book-version.js';

export function bookDetailRoutes(app) {
  // One access check and one shared index for the detail page's initial data.
  // Do not cache permissions, personal data, or book statistics across requests.
  app.get('/api/books/:bookId/detail', asyncRoute(async (req, res) => {
    const {bookId} = req.params;
    if (!/^[a-f0-9]{24}$/i.test(bookId)) fail(400, '作品ID无效');
    res.set('Cache-Control', 'private, no-store');
    const bookRead = Book.findOne({_id:bookId, deletedAt:null}).populate('author_id', 'username id').maxTimeMS(3000).lean().exec();
    const [book, [preview, milestones]] = await Promise.all([bookRead, Promise.allSettled([
      (async () => {
        const index = await readBookIndex(bookId, res.locals.workAccess);
        const first = index.ids.slice(0, 30), latest = index.ids.slice(-30).reverse();
        const rows = await Chapter.find({bookId, deletedAt:null, _id:{$in:[...new Set([...first, ...latest])]}})
          .select('title chapter_number volume_title volume_number published_at bookId word_count')
          .maxTimeMS(3000).lean();
        await verifyBookVersion(bookId, index.version);
        const byId = new Map(rows.map(row => [String(row._id), {...row, id:String(row._id)}]));
        const select = ids => ids.map(id => byId.get(id)).filter(Boolean);
        return {catalog:{rows:select(first), total:index.ids.length, pageSize:30}, chapters:select(latest), totalWords:index.totalWords};
      })(),
      bookRead.then(book => book ? bookMilestones(book) : null),
    ])]);
    if (!book) fail(404, '作品不可用');
    // A statistics/catalog outage must still leave the description readable.
    res.json({book:{...book, id:String(book._id)},
      ...(preview.status === 'fulfilled' ? preview.value : {catalog:null, chapters:[], totalWords:null}),
      milestones:milestones.status === 'fulfilled' ? milestones.value : null});
  }));
}
