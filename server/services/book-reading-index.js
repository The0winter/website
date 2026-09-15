import Chapter from '../models/Chapter.js';
import {fail} from './content.js';
import {versionedBookCache} from './versioned-book-cache.js';
import {BookVersionChanged, readLiveBook, verifyBookVersion} from './book-version.js';

// Reading needs an exact position (including numbering gaps/soft deletions),
// not titles or volumes. Build this small index once per publication version,
// shared by all readers, statistics and catalog windows in this API process.
export const bookReadingIndex = versionedBookCache(async (bookId, version) => {
  const chapters = await Chapter.find({bookId, deletedAt: null}).select('_id word_count')
    .sort({chapter_number: 1}).maxTimeMS(3000).lean();
  await verifyBookVersion(bookId, version);
  const ids = chapters.map(chapter => String(chapter._id));
  return {ids, indices: new Map(ids.map((id, index) => [id, index])),
    totalWords: chapters.reduce((total, chapter) => total + (chapter.word_count || 0), 0)};
}, value => 128 * value.ids.length + 256);

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
