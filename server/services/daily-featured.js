import {createHash} from 'node:crypto';
import Book from '../models/Book.js';
import DailyFeatured from '../models/DailyFeatured.js';
import {dayKey} from './content.js';
import {publicWork} from './work-access.js';

const publicBooks = {deletedAt: null, ...publicWork};

export function selectDailyFeatured(books, day, previous = []) {
  const ranked = [...new Map(books.map(book => [String(book._id), book])).values()]
    .sort((a, b) => (b.views || 0) - (a.views || 0) || String(a._id).localeCompare(String(b._id)));
  // One-based positions 50 through 100. Small libraries use available works.
  const band = ranked.slice(49, 100), pool = band.length >= 3 ? band : ranked;
  const fresh = pool.filter(book => !previous.map(String).includes(String(book._id)));
  const candidates = (fresh.length >= 3 ? fresh : pool).map(book => ({book,
    score: createHash('sha256').update(`featured-v1:${day}:${book._id}`).digest().readUInt32BE(0) / 0xffffffff * .8
      + Math.max(0, Math.min(5, book.rating || 0)) / 5 * .2}));
  const selected = [];
  while (candidates.length && selected.length < 3) {
    const score = ({book, score}) => score - (selected.some(b => b.category === book.category) ? .45 : 0)
      - (book.author && selected.some(b => b.author === book.author) ? .6 : 0);
    candidates.sort((a, b) => score(b) - score(a) || String(a.book._id).localeCompare(String(b.book._id)));
    selected.push(candidates.shift().book);
  }
  return {books: selected, ranks: selected.map(book => ranked.findIndex(b => String(b._id) === String(book._id)) + 1)};
}

async function choose(day) {
  const [books, previous] = await Promise.all([
    Book.find(publicBooks).sort({views: -1, _id: 1}).limit(100).maxTimeMS(3000).lean(),
    DailyFeatured.findOne({day: {$lt: day}}).sort({day: -1}).maxTimeMS(3000).lean(),
  ]);
  return selectDailyFeatured(books, day, previous?.bookIds || []);
}

// Called after the daily popularity job. Store the chosen IDs once, so genuine
// reads or service restarts do not change today's banner halfway through a day.
export async function ensureDailyFeatured(now = new Date()) {
  const day = dayKey(now);
  const existing = await DailyFeatured.findById(day).lean();
  if (existing) return existing;
  const {books, ranks} = await choose(day);
  if (!books.length) return {day, bookIds: [], ranks: []};
  try {
    return await DailyFeatured.findOneAndUpdate({_id: day}, {$setOnInsert: {day, version: 1,
      bookIds: books.map(book => book._id), ranks, createdAt: now}}, {upsert: true, new: true}).lean();
  } catch (error) {
    if (error.code !== 11000) throw error;
    return DailyFeatured.findById(day).lean();
  }
}

export async function dailyFeaturedBooks(filter, skip, limit, now = new Date()) {
  const day = dayKey(now);
  const saved = await DailyFeatured.findOne({day: {$lte: day}}).sort({day: -1}).maxTimeMS(3000).lean();
  // Keep yesterday's set while the new day's popularity is being calculated.
  // A fresh installation has a read-only deterministic fallback until its job runs.
  const selected = saved?.bookIds || (await choose(day)).books.map(book => book._id);
  const visible = await Book.find({...filter, _id: {$in: selected}}).maxTimeMS(3000).lean();
  const byId = new Map(visible.map(book => [String(book._id), book]));
  const rows = selected.map(id => byId.get(String(id))).filter(Boolean);
  return {rows: rows.slice(skip, skip + limit), total: rows.length};
}
