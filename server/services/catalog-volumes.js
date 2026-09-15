import Chapter from '../models/Chapter.js';
import {buildCatalogVolumes} from '../../shared/catalog-volumes.mjs';
import {versionedBookCache} from './versioned-book-cache.js';

// Load titles only when the catalog is opened. Reuse both windows and volume
// boundaries across readers; a book edit, not elapsed time, invalidates them.
export const bookCatalog = versionedBookCache(async bookId => {
  const chapters = await Chapter.find({bookId, deletedAt: null}).select('_id title chapter_number volume_title volume_number')
    .sort({chapter_number: 1}).maxTimeMS(3000).lean();
  return {rows: chapters.map(chapter => ({id: String(chapter._id), title: chapter.title, chapter_number: chapter.chapter_number})),
    indices: new Map(chapters.map((chapter, index) => [String(chapter._id), index])), volumes: buildCatalogVolumes(chapters)};
}, value => value.rows.reduce((bytes, row) => bytes + 256 + 2 * row.title.length, 256) + 512 * value.volumes.length);
