import {createHash} from 'node:crypto';
import Book from '../models/Book.js';
import {dayKey} from './content.js';

// The raw-view order (including its ID tie-break) matches the browsing chart.
// Prefer the entire long tail before using popular books to fill a small library.
export function selectDiscoveryBooks(books, limit = 57, now = new Date()) {
  const ranked = [...new Map(books.map(book => [String(book._id), book])).values()]
    .sort((a, b) => (b.views || 0) - (a.views || 0) || String(a._id).localeCompare(String(b._id)));
  const day = dayKey(now), dayStart = new Date(`${day}T00:00:00+08:00`).getTime();
  const categories = new Map(), authors = new Map(), selected = [];
  for (const pool of [ranked.slice(50), ranked.slice(0, 50)]) {
    const candidates = pool.map(book => {
      const rotation = createHash('sha256').update(`${day}:${book._id}`).digest().readUInt32BE(0) / 0xffffffff;
      const rating = book.rating > 0 ? Math.min(5, book.rating) / 5 : 0.6;
      const age = Math.max(0, dayStart - new Date(book.lastUpdated || book.updatedAt || 0).getTime());
      const freshness = Number.isFinite(age) ? Math.max(0, 1 - age / (30 * 86400000)) : 0;
      return {book, score: rotation * 0.6 + rating * 0.3 + freshness * 0.1};
    });
    while (candidates.length && selected.length < limit) {
      const score = ({book, score}) => score - (categories.get(book.category) || 0) * 0.04
        - (book.author ? (authors.get(book.author) || 0) * 0.18 : 0)
        - (selected.at(-1)?.category === book.category ? 0.1 : 0);
      let best = 0;
      for (let i = 1; i < candidates.length; i++) if (score(candidates[i]) > score(candidates[best])) best = i;
      const {book} = candidates.splice(best, 1)[0];
      selected.push(book);
      categories.set(book.category, (categories.get(book.category) || 0) + 1);
      if (book.author) authors.set(book.author, (authors.get(book.author) || 0) + 1);
    }
  }
  return selected;
}

export async function discoveryBooks(filter, skip, limit, now = new Date()) {
  const books = await Book.find(filter).maxTimeMS(3000).lean();
  // Discovery is a finite feed, not an unbounded ranking page.
  const feed = selectDiscoveryBooks(books, 57, now);
  return {rows: feed.slice(skip, skip + limit), total: feed.length};
}
