import Chapter from '../models/Chapter.js';
import {fail} from './content.js';
import {bookReadingIndex} from './book-reading-index.js';
import {versionedBookCache} from './versioned-book-cache.js';
import {BookVersionChanged, readLiveBook, verifyBookVersion} from './book-version.js';

const preview = versionedBookCache(async (bookId, version) => {
  const index = await bookReadingIndex(bookId, version);
  const first = index.ids.slice(0, 30), latest = index.ids.slice(-30).reverse();
  const rows = await Chapter.find({bookId, deletedAt:null, _id:{$in:[...new Set([...first, ...latest])]}})
    .select('title chapter_number volume_title volume_number published_at bookId word_count')
    .maxTimeMS(3000).lean();
  await verifyBookVersion(bookId, version);
  const byId = new Map(rows.map(row => [String(row._id), {...row, id:String(row._id)}]));
  const select = ids => ids.map(id => byId.get(id)).filter(Boolean);
  return {catalog:{rows:select(first), total:index.ids.length, pageSize:30}, chapters:select(latest), totalWords:index.totalWords};
}, value => Buffer.byteLength(JSON.stringify(value)) * 2 + 512, {maxEntries:128, maxBytes:8 * 1024 * 1024, name:'preview'});

export async function readBookPreview(bookId, access) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const book = await readLiveBook(bookId, attempt === 0 ? access : undefined);
    try {return await preview(bookId, book.writeVersion ?? 0);}
    catch (error) {if (!(error instanceof BookVersionChanged)) throw error;}
  }
  fail(409, '作品正在更新，请重试');
}
