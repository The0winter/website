import Chapter from '../models/Chapter.js';
import Book from '../models/Book.js';
import {fail} from './content.js';
import {versionedBookCache} from './versioned-book-cache.js';

// Reading needs an exact position (including numbering gaps/soft deletions),
// not titles or volumes. Build this small index once per publication version,
// shared by all readers, statistics and catalog windows in this API process.
export const bookReadingIndex = versionedBookCache(async bookId => {
  const chapters = await Chapter.find({bookId, deletedAt: null}).select('_id word_count')
    .sort({chapter_number: 1}).maxTimeMS(3000).lean();
  const ids = chapters.map(chapter => String(chapter._id));
  return {ids, indices: new Map(ids.map((id, index) => [id, index])),
    totalWords: chapters.reduce((total, chapter) => total + (chapter.word_count || 0), 0)};
}, value => 128 * value.ids.length + 256);

export async function readBookIndex(bookId) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const book = await Book.findOne({_id: bookId, deletedAt: null}).select('writeVersion').maxTimeMS(3000).lean();
    if (!book) fail(404, '作品不可用');
    const version = book.writeVersion ?? 0;
    const index = await bookReadingIndex(bookId, version);
    const current = await Book.findOne({_id: bookId, deletedAt: null}).select('writeVersion').maxTimeMS(3000).lean();
    if (!current) fail(404, '作品不可用');
    if ((current.writeVersion ?? 0) === version) return {...index, version};
  }
  fail(409, '作品正在更新，请重试');
}
