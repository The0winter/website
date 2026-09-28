import mongoose from 'mongoose';
import Chapter from '../models/Chapter.js';
import {fail} from './content.js';
import {versionedBookCache} from './versioned-book-cache.js';
import {BookVersionChanged, readLiveBook, verifyBookVersion} from './book-version.js';

// Reading needs an exact position (including numbering gaps/soft deletions),
// not titles or volumes. Build this small index once per publication version,
// shared by all readers, statistics and catalog windows in this API process.
export const bookReadingIndex = versionedBookCache(async (bookId, version) => {
  let ids, totalWords;
  if (mongoose.connection.transport) {
    const chapters = await Chapter.find({bookId, deletedAt: null}).select('_id word_count')
      .sort({chapter_number: 1}).maxTimeMS(3000).lean();
    ids = chapters.map(chapter => String(chapter._id));
    totalWords = chapters.reduce((total, chapter) => total + (chapter.word_count || 0), 0);
  } else {
    // Sum words in MongoDB and send packed IDs instead of one BSON document
    // per chapter. Number ranges keep long books split into small result rows;
    // sorting before and after grouping preserves gaps and soft deletions.
    const chunks = await Chapter.aggregate([
      {$match: {bookId: new mongoose.Types.ObjectId(bookId), deletedAt: null}},
      {$sort: {chapter_number: 1}},
      {$group: {_id: {$floor: {$divide: ['$chapter_number', 1000]}},
        ids: {$push: '$_id'}, totalWords: {$sum: {$ifNull: ['$word_count', 0]}}}},
      {$sort: {_id: 1}},
    ]).option({maxTimeMS: 3000});
    ids = chunks.flatMap(chunk => chunk.ids.map(String));
    totalWords = chunks.reduce((total, chunk) => total + chunk.totalWords, 0);
  }
  await verifyBookVersion(bookId, version);
  return {ids, indices: new Map(ids.map((id, index) => [id, index])), totalWords};
}, value => 128 * value.ids.length + 256, {name: 'readingIndex', maxEntries: 512, maxBytes: 48 * 1024 * 1024});

export async function readBookIndex(bookId, access) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const book = await readLiveBook(bookId, attempt === 0 ? access : undefined);
    const version = book.writeVersion ?? 0;
    try {
      return {...await bookReadingIndex(bookId, version), version};
    } catch (error) {
      if (!(error instanceof BookVersionChanged)) throw error;
    }
  }
  fail(409, '作品正在更新，请重试');
}
