import Book from '../models/Book.js';
import {fail} from './content.js';

// Access middleware has already read this book during the current request.
// Never reuse permissions or the live version from a process-wide cache.
export async function readLiveBook(bookId, access) {
  const book = access && String(access.bookId) === String(bookId) ? access.book
    : await Book.findOne({_id: bookId, deletedAt: null}).select('writeVersion').maxTimeMS(3000).lean();
  if (!book || book.deletedAt) fail(404, '作品不可用');
  return book;
}

export class BookVersionChanged extends Error {
  constructor(version) {
    super('目录已更新');
    this.status = 409;
    this.version = String(version);
  }
}

// Validate inside the cache loader, before its promise can resolve. Concurrent
// readers share this check; an interrupted build is rejected and never retained.
export async function verifyBookVersion(bookId, version) {
  const book = await readLiveBook(bookId);
  if (String(book.writeVersion ?? 0) !== String(version ?? 0)) throw new BookVersionChanged(book.writeVersion ?? 0);
}
