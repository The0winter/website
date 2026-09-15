import {dayKey} from './content.js';
import Book from '../models/Book.js';
import mongoose from 'mongoose';

// Ranking pages opt into these sorts; ordinary discovery sorts stay unchanged.
export const rankingViewFields = Object.freeze({
  rank_day: 'daily_views', rank_week: 'weekly_views',
  rank_month: 'monthly_views', rank_total: 'views',
});

export async function rankedBooks(filter, orderBy, order, skip, limit, now = new Date()) {
  if (!Object.hasOwn(rankingViewFields, orderBy)) throw new Error('Unknown ranking period');
  const field = rankingViewFields[orderBy], direction = order === 'asc' ? 1 : -1;
  const today = dayKey(now), calendar = new Date(today + 'T00:00:00Z');
  calendar.setUTCDate(calendar.getUTCDate() - ((calendar.getUTCDay() + 6) % 7));
  const start = orderBy === 'rank_week' ? calendar.toISOString().slice(0, 10)
    : orderBy === 'rank_month' ? today.slice(0, 7) + '-01' : today;
  const books = await Book.find(filter).maxTimeMS(3000).lean();
  // Push date/book filtering and summation into D1. The generic $lookup
  // fallback otherwise transfers every book's historical daily rows.
  const periods = orderBy === 'rank_total' || !books.length ? [] : await mongoose.connection.collection('readdailies').aggregate([
    {$match: {bookId: {$in: books.map(book => book._id)}, day: {$gte: start, $lte: today}}},
    {$group: {_id: '$bookId', views: {$sum: '$views'}}},
  ], {maxTimeMS: 3000}).toArray();
  const views = new Map(periods.map(row => [String(row._id), row.views]));
  const candidates = books.map(book => ({...book,
    rankingViews: Math.max(0, (orderBy === 'rank_total' ? book[field] : views.get(String(book._id))) ?? 0),
    rankingRating: Math.min(5, Math.max(0, book.rating ?? 0))}));
  const maximum = candidates.reduce((max, book) => Math.max(max, book.rankingViews), 0);
  // Normalize the whole category before paging, preserving the 80/20 formula.
  const rows = candidates.map(book => ({...book, rankingScore: (maximum ? 80 * (book.rankingViews / maximum) : 0) + 4 * book.rankingRating}))
    .sort((a, b) => direction * (a.rankingScore - b.rankingScore || a.rankingViews - b.rankingViews || a.rankingRating - b.rankingRating) || String(a._id).localeCompare(String(b._id)))
    .slice(skip, skip + limit).map(({rankingRating, ...book}) => book);
  return {rows, total: books.length};
}
