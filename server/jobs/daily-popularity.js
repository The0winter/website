import crypto from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import mongoose from 'mongoose';
import Book from '../models/Book.js';
import Daily from '../models/ReadDaily.js';
import {dayKey} from '../services/content.js';
import {connectDatabase} from '../database/index.js';
import {ensureDailyFeatured} from '../services/daily-featured.js';

const validDay = day => /^\d{4}-\d{2}-\d{2}$/.test(day || '') && new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) === day;
const nextDay = day => new Date(Date.parse(day + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
const random = (book, day, salt) => crypto.createHash('sha256').update(`daily-popularity-v1:${book._id}:${day}:${salt}`).digest().readUInt32BE(0) / 0xffffffff;

export function dailyPopularityViews(book, day) {
  if (!validDay(day)) throw Error('Invalid popularity day');
  const rank = book.statisticsSeed?.qidianRank;
  const ranked = Number.isInteger(rank) && rank >= 1 && rank <= 500;
  const base = ranked ? 1 - ((rank - 1) / 499) ** 0.38 : 0.58 + random(book, 'unranked', 'base') * 0.16;
  // The previous initialization varied by only a few percent. A daily draw
  // now contributes 30% of the range, while overall rank remains the main weight.
  const heat = ranked ? base * 0.70 + random(book, day, 'views') * 0.30
    : base + (random(book, day, 'views') - 0.5) * 0.18;
  return Math.round(2000 + 48000 * Math.max(0, Math.min(1, heat)));
}

function firstMissingDay(book, startDay) {
  const created = book.createdAt ? dayKey(new Date(book.createdAt)) : startDay;
  const checkpoint = validDay(book.dailyPopularityThrough) ? nextDay(book.dailyPopularityThrough) : startDay;
  return [startDay, created, checkpoint].sort().at(-1);
}

export async function refreshBookPeriods(now, shouldStop = () => false) {
  const day = dayKey(now), calendar = new Date(day + 'T00:00:00Z');
  calendar.setUTCDate(calendar.getUTCDate() - ((calendar.getUTCDay() + 6) % 7));
  const week = calendar.toISOString().slice(0, 10), month = day.slice(0, 7) + '-01', start = week < month ? week : month;
  const totals = await Daily.aggregate([{$match: {day: {$gte: start, $lte: day}}}, {$group: {_id: '$bookId',
    daily_views: {$sum: {$cond: [{$eq: ['$day', day]}, '$views', 0]}},
    weekly_views: {$sum: {$cond: [{$gte: ['$day', week]}, '$views', 0]}},
    monthly_views: {$sum: {$cond: [{$gte: ['$day', month]}, '$views', 0]}},
  }}]);
  const byBook = new Map(totals.map(row => [String(row._id), row]));
  const books = await Book.find({deletedAt: null, visibility: {$ne: 'private'}}).select('_id daily_views weekly_views monthly_views').lean();
  const fields = ['daily_views', 'weekly_views', 'monthly_views'];
  let refreshed = 0;
  for (let offset = 0; offset < books.length; offset += 20) {
    if (shouldStop()) throw Object.assign(Error('Daily popularity paused'), {name: 'AbortError'});
    const batch = books.slice(offset, offset + 20).filter(book => fields.some(field => (book[field] || 0) !== (byBook.get(String(book._id))?.[field] || 0)));
    if (!batch.length) continue;
    await mongoose.connection.transaction(async session => {
      if (session.prefetch) await session.prefetch('books', {_id: {$in: batch.map(book => book._id)}});
      for (const book of batch) await Book.updateOne({_id: book._id}, {$set: Object.fromEntries(fields.map(field => [field, byBook.get(String(book._id))?.[field] || 0]))}, {session, timestamps: false});
    });
    refreshed += batch.length;
  }
  return refreshed;
}

export async function seedDailyPopularity({startDay, now = new Date(), apply = false, shouldStop = () => false}) {
  const today = dayKey(now);
  if (!validDay(startDay) || startDay > today) throw Error('A valid, non-future DAILY_POPULARITY_START is required');
  const books = await Book.find({deletedAt: null, visibility: {$ne: 'private'}}).sort({_id: 1}).lean();
  const previewRows = !apply && books.length ? await Daily.find({bookId: {$in: books.map(book => book._id)}, day: {$gte: startDay, $lte: today}}).select('_id views baselineViews').lean() : [];
  const previewById = new Map(previewRows.map(row => [row._id, row]));
  const report = {day: today, startDay, mode: apply ? 'apply' : 'preview', books: books.length, added: 0, views: 0, pendingBooks: 0, refreshed: 0};
  for (const candidate of books) {
    let day = firstMissingDay(candidate, startDay), days = 0;
    // Bound recovery work. Subsequent hourly runs continue from the checkpoint.
    for (; day <= today && days < 31; day = nextDay(day), days++) {
      if (shouldStop()) throw Object.assign(Error('Daily popularity paused'), {name: 'AbortError'});
      if (!apply) {
        const row = previewById.get(`${candidate._id}:${day}`);
        if (row?.baselineViews === undefined) {report.added++; report.views += Math.max(0, dailyPopularityViews(candidate, day) - (row?.views || 0));}
        continue;
      }
      const added = await mongoose.connection.transaction(async session => {
        const book = await Book.findById(candidate._id).session(session);
        if (!book || book.deletedAt || book.visibility === 'private' || firstMissingDay(book, startDay) > day) return null;
        await Book.updateOne({_id: book._id}, {$inc: {milestoneVersion: 1}}, {session, timestamps: false});
        const id = `${book._id}:${day}`, existing = await Daily.findById(id).session(session);
        let views = 0, initialized = false;
        if (existing?.baselineViews === undefined) {
          const target = dailyPopularityViews(book, day);
          views = Math.max(0, target - (existing?.views || 0));
          initialized = true;
          await Daily.updateOne({_id: id}, {$setOnInsert: {bookId: book._id, day}, $inc: {views}, $unset: {expiresAt: 1},
            $set: {baselineViews: views, baselineTargetViews: target, baselineVersion: 1, baselineQidianRank: book.statisticsSeed?.qidianRank ?? null,
              baselineGeneratedAt: now, baselinePriorTotal: book.views || 0}}, {upsert: true, session});
        }
        // The daily receipt and cumulative increment commit together. A restart
        // or competing invocation can never add the same day's baseline twice.
        await Book.updateOne({_id: book._id}, {$inc: {views}, $set: {dailyPopularityThrough: day}}, {session, timestamps: false});
        return {views, initialized};
      });
      if (added?.initialized) {report.added++; report.views += added.views;}
    }
    if (day <= today) report.pendingBooks++;
  }
  if (apply) report.refreshed = await refreshBookPeriods(now, shouldStop);
  return report;
}

export async function main(args) {
  if (args.length > 1 || (args.length && args[0] !== '--apply')) throw Error('Usage: node jobs/daily-popularity.js [--apply]');
  const apply = args[0] === '--apply';
  if (apply && process.env.WRITE_MODE !== 'readwrite') throw Error('Daily popularity requires WRITE_MODE=readwrite');
  let stopping = false;
  const stop = () => {stopping = true;};
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  await connectDatabase();
  try {
    const now = new Date();
    const report = await seedDailyPopularity({startDay: process.env.DAILY_POPULARITY_START, now, apply, shouldStop: () => stopping});
    if (apply && !stopping && !report.pendingBooks) {
      const featured = await ensureDailyFeatured(now);
      report.featured = {day: featured.day, books: featured.bookIds.length};
    }
    console.log(JSON.stringify(report));
  }
  finally {await mongoose.disconnect(); process.off('SIGTERM', stop); process.off('SIGINT', stop);}
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main(process.argv.slice(2)).catch(error => {console.error('Daily popularity failed:', error.name); process.exitCode = 1;});
