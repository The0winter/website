import Book from '../models/Book.js';
import Chapter from '../models/Chapter.js';
import {asyncRoute} from '../security.js';
import {fail} from '../services/content.js';
import {catalogVolumes} from '../services/catalog-volumes.js';

const number = (value, fallback, min, max) => {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) fail(400, '目录范围无效');
  return parsed;
};
const id = value => typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value);
const versionOf = book => String(book.writeVersion ?? 0);
const rows = (filter, limit, direction = 1, offset = 0) => Chapter.find(filter).select('_id title chapter_number')
  .sort({chapter_number: direction}).skip(offset).limit(limit).setOptions({batchSize: limit, singleBatch: true}).maxTimeMS(3000).lean();

export function catalogRoutes(app) {
  app.get('/api/books/:bookId/catalog', asyncRoute(async (req, res) => {
    const {bookId} = req.params, {anchor, version} = req.query;
    if (!id(bookId) || (anchor !== undefined && !id(anchor)) || (version !== undefined && (typeof version !== 'string' || !/^\d{1,16}$/.test(version)))) fail(400, '目录参数无效');
    const limit = number(req.query.limit, 128, 1, 2048);
    const requestedOffset = number(req.query.offset, 0, 0, 10000000);
    const filter = {bookId, deletedAt: null};
    const [book, total, target] = await Promise.all([
      Book.findOne({_id: bookId, deletedAt: null}).select('writeVersion').maxTimeMS(3000).lean(),
      Chapter.countDocuments(filter).maxTimeMS(3000),
      anchor ? Chapter.findOne({...filter, _id: anchor}).select('chapter_number').maxTimeMS(3000).lean() : null,
    ]);
    if (!book) fail(404, '作品不可用');
    const revision = versionOf(book);
    res.set('Cache-Control', 'no-store');
    if (version !== undefined && version !== revision) return res.status(409).json({error: '目录已更新', version: revision});
    let offset = Math.min(requestedOffset, total), activeIndex = null, chapters;
    if (target && total > limit) {
      // Seek through the existing (bookId, chapter_number) index, including gaps
      // and soft deletions. No chapter bodies and no preceding catalog pages.
      const beforeLimit = Math.floor(limit / 2);
      const [rank, before, after] = await Promise.all([
        Chapter.countDocuments({...filter, chapter_number: {$lt: target.chapter_number}}).maxTimeMS(3000),
        beforeLimit ? rows({...filter, chapter_number: {$lt: target.chapter_number}}, beforeLimit, -1) : [],
        rows({...filter, chapter_number: {$gte: target.chapter_number}}, limit - beforeLimit),
      ]);
      activeIndex = rank; offset = rank - before.length; chapters = [...before.reverse(), ...after];
    } else {
      if (anchor) offset = 0;
      chapters = await rows(filter, limit, 1, offset);
      if (target) activeIndex = offset + chapters.findIndex(chapter => String(chapter._id) === anchor);
    }
    const volumes = await catalogVolumes(bookId, revision, total);
    // Do not label rows or volume boundaries with a version that changed while read.
    const current = await Book.findOne({_id: bookId, deletedAt: null}).select('writeVersion').maxTimeMS(3000).lean();
    if (!current) fail(404, '作品不可用');
    if (versionOf(current) !== revision) return res.status(409).json({error: '目录已更新', version: versionOf(current)});
    res.json({offset, total, activeIndex, version: revision, volumes, rows: chapters.map(chapter => ({id: String(chapter._id), title: chapter.title, chapter_number: chapter.chapter_number}))});
  }));
}
