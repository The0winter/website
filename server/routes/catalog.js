import Book from '../models/Book.js';
import {asyncRoute} from '../security.js';
import {fail} from '../services/content.js';
import {bookCatalog} from '../services/catalog-volumes.js';

const number = (value, fallback, min, max) => {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) fail(400, '目录范围无效');
  return parsed;
};
const id = value => typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value);
const versionOf = book => String(book.writeVersion ?? 0);

export function catalogRoutes(app) {
  // Reopening a cached catalog checks only the book's primary key/version.
  app.get('/api/books/:bookId/catalog/version', asyncRoute(async (req, res) => {
    if (!id(req.params.bookId)) fail(400, '目录参数无效');
    const book = await Book.findOne({_id: req.params.bookId, deletedAt: null}).select('writeVersion').maxTimeMS(3000).lean();
    if (!book) fail(404, '作品不可用');
    res.set('Cache-Control', 'no-store').json({version: versionOf(book)});
  }));
  app.get('/api/books/:bookId/catalog', asyncRoute(async (req, res) => {
    const {bookId} = req.params, {anchor, version} = req.query;
    if (!id(bookId) || (anchor !== undefined && !id(anchor)) || (version !== undefined && (typeof version !== 'string' || !/^\d{1,16}$/.test(version)))) fail(400, '目录参数无效');
    const limit = number(req.query.limit, 128, 1, 2048);
    const requestedOffset = number(req.query.offset, 0, 0, 10000000);
    const book = await Book.findOne({_id: bookId, deletedAt: null}).select('writeVersion').maxTimeMS(3000).lean();
    if (!book) fail(404, '作品不可用');
    const revision = versionOf(book);
    res.set('Cache-Control', 'no-store');
    if (version !== undefined && version !== revision) return res.status(409).json({error: '目录已更新', version: revision});
    const catalog = await bookCatalog(bookId, revision), total = catalog.rows.length;
    const activeIndex = anchor ? catalog.indices.get(anchor) ?? null : null;
    const offset = anchor ? (activeIndex === null || total <= limit ? 0 : Math.max(0, activeIndex - Math.floor(limit / 2))) : Math.min(requestedOffset, total);
    // Do not label rows or volume boundaries with a version that changed while read.
    const current = await Book.findOne({_id: bookId, deletedAt: null}).select('writeVersion').maxTimeMS(3000).lean();
    if (!current) fail(404, '作品不可用');
    if (versionOf(current) !== revision) return res.status(409).json({error: '目录已更新', version: versionOf(current)});
    res.json({offset, total, activeIndex, version: revision, volumes: catalog.volumes, rows: catalog.rows.slice(offset, offset + limit)});
  }));
}
