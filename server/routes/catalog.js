import {asyncRoute} from '../security.js';
import {fail} from '../services/content.js';
import {bookCatalog} from '../services/catalog-volumes.js';
import {BookVersionChanged, readLiveBook} from '../services/book-version.js';
import Chapter from '../models/Chapter.js';

const number = (value, fallback, min, max) => {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) fail(400, '目录范围无效');
  return parsed;
};
const id = value => typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value);
const versionOf = book => String(book.writeVersion ?? 0);

export function catalogRoutes(app) {
  // Document preflight needs one primary-key lookup, not a complete catalogue.
  app.get('/api/books/:bookId/chapter-exists/:chapterId', asyncRoute(async (req, res) => {
    const {bookId, chapterId} = req.params;
    if (!id(bookId) || !id(chapterId)) fail(400, '章节参数无效');
    await readLiveBook(bookId, res.locals.workAccess);
    const chapter = await Chapter.findOne({_id:chapterId, bookId, deletedAt:null}).select('_id').maxTimeMS(3000).lean();
    if (!chapter) fail(404, '章节不存在');
    res.set('Cache-Control', 'private, no-store').json({exists:true});
  }));
  // Reopening a cached catalog checks only the book's primary key/version.
  app.get('/api/books/:bookId/catalog/version', asyncRoute(async (req, res) => {
    if (!id(req.params.bookId)) fail(400, '目录参数无效');
    const book = await readLiveBook(req.params.bookId, res.locals.workAccess);
    res.set('Cache-Control', 'no-store').json({version: versionOf(book)});
  }));
  app.get('/api/books/:bookId/catalog', asyncRoute(async (req, res) => {
    const {bookId} = req.params, {anchor, version} = req.query;
    if (!id(bookId) || (anchor !== undefined && !id(anchor)) || (version !== undefined && (typeof version !== 'string' || !/^\d{1,16}$/.test(version)))) fail(400, '目录参数无效');
    const limit = number(req.query.limit, 128, 1, 2048);
    const requestedOffset = number(req.query.offset, 0, 0, 10000000);
    const book = await readLiveBook(bookId, res.locals.workAccess);
    const revision = versionOf(book);
    res.set('Cache-Control', 'no-store');
    if (version !== undefined && version !== revision) return res.status(409).json({error: '目录已更新', version: revision});
    let catalog;
    try {
      catalog = await bookCatalog(bookId, revision);
    } catch (error) {
      if (error instanceof BookVersionChanged) return res.status(409).json({error: error.message, version: error.version});
      throw error;
    }
    const total = catalog.rows.length;
    const activeIndex = anchor ? catalog.indices.get(anchor) ?? null : null;
    const offset = anchor ? (activeIndex === null || total <= limit ? 0 : Math.max(0, activeIndex - Math.floor(limit / 2))) : Math.min(requestedOffset, total);
    res.json({offset, total, activeIndex, version: revision, volumes: catalog.volumes, rows: catalog.rows.slice(offset, offset + limit)});
  }));
}
