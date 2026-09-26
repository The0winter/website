import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import mongoose from '../server/node_modules/mongoose/index.js';
import Book from '../server/models/Book.js';
import Bookmark from '../server/models/Bookmark.js';
import Review from '../server/models/Review.js';
import {connectDatabase} from '../server/database/index.js';
import {combinedRating} from '../server/services/book-statistics.js';

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const normalize = text => String(text).normalize('NFKC').replace(/\s/g, '');
const key = book => normalize(book.title) + '\0' + normalize(book.author);
const noise = (book, field) => crypto.createHash('sha256').update(key(book) + '\0' + field).digest().readUInt32BE() / 0xffffffff;

export function makePlan(books, snapshot) {
  if (!snapshot.source || !snapshot.observedAt || !Array.isArray(snapshot.rows) || !snapshot.rows.length) throw Error('A dated ranking snapshot is required');
  const ranks = new Map();
  for (const row of snapshot.rows) {
    if (!row.title || !row.author || !Number.isInteger(row.rank) || row.rank < 1 || row.rank > 500 || ranks.has(key(row))) throw Error('Invalid or duplicate ranking entry');
    ranks.set(key(row), row.rank);
  }
  return books.map(book => {
    const rank = ranks.get(key(book)) ?? null;
    const popularity = rank ? clamp(1 - ((rank - 1) / 499) ** 0.38 + (noise(book, 'popularity') - 0.5) * 0.055, 0, 1)
      : 0.58 + noise(book, 'popularity') * 0.16;
    return {id: String(book._id), title: book.title, author: book.author, rank,
      views: Math.round(clamp(2000 + 48000 * (popularity + (noise(book, 'views') - 0.5) * 0.025), 2000, 50000)),
      favorites: Math.round(clamp(100 + 1900 * (popularity + (noise(book, 'favorites') - 0.5) * 0.10), 100, 2000)),
      rating: Math.round(clamp(8.9 + popularity + (noise(book, 'rating') - 0.5) * 0.16, 8.9, 9.9) * 10) / 10,
      alreadySeeded: Boolean(book.statisticsSeed)};
  });
}

export async function applyPlan(plan, {runId, source, writeAudit, now = new Date()}) {
  if (!runId || !source || typeof writeAudit !== 'function') throw Error('Audit information is required');
  const results = [];
  for (const row of plan) {
    if (!/^[a-f\d]{24}$/.test(row.id) || !Number.isInteger(row.views) || row.views < 2000 || row.views > 50000 ||
      !Number.isInteger(row.favorites) || row.favorites < 100 || row.favorites > 2000 || !Number.isFinite(row.rating) || row.rating < 8.9 || row.rating > 9.9) throw Error('Invalid target statistics');
    let result;
    await mongoose.connection.transaction(async session => {
      const book = await Book.findById(row.id).session(session);
      if (!book || book.deletedAt || book.visibility === 'private' || book.title !== row.title || book.author !== row.author) throw Error('Book changed since preview: ' + row.id);
      if (book.statisticsSeed) {result = {id: row.id, status: 'already-seeded'}; return;}
      // Serialize with bookmarks, reads and review edits, without changing the
      // chapter version or making every book appear newly updated.
      await Book.updateOne({_id: book._id}, {$inc: {milestoneVersion: 1}}, {session, timestamps: false});
      const favorites = await Bookmark.countDocuments({bookId: book._id}).session(session);
      const [stats] = await Review.aggregate([{$match: {book: book._id, isTestData: {$ne:true}}}, {$group: {_id: null, rating: {$avg: '$rating'}, count: {$sum: 1}}}]).session(session);
      const comments = await Review.countDocuments({book:book._id,content:/\S/}).session(session);
      const seed = {runId, source, qidianRank: row.rank, views: Math.max(0, row.views - (book.views || 0)),
        favorites: Math.max(0, row.favorites - favorites), rating: row.rating / 2,
        ratingWeight: Math.max(30, Math.round(row.favorites * 0.08)), initializedAt: now};
      // Durable evidence precedes each mutation. Retries may repeat a prepared
      // entry, but the persisted seed guard prevents duplicate initialization.
      await writeAudit({phase: 'prepared', id: row.id, before: book.toObject(), actualFavorites: favorites, actualReviews: stats || null, seed});
      const rating = combinedRating({statisticsSeed: seed}, stats?.rating || 0, stats?.count || 0);
      await Book.updateOne({_id: book._id}, {$inc: {views: seed.views}, $set: {statisticsSeed: seed, rating, numRatings:stats?.count || 0, numReviews:comments}}, {session, timestamps: false, runValidators: true});
      result = {id: row.id, title: row.title, status: 'seeded', views: (book.views || 0) + seed.views, favorites: favorites + seed.favorites, rating: rating * 2};
    });
    await writeAudit({phase: 'completed', ...result});
    results.push(result);
  }
  return results;
}

export async function main(args) {
  const [snapshotPath, outputDirectory, flag] = args;
  if (!snapshotPath || !outputDirectory || (flag && flag !== '--apply') || args.length > 3) throw Error('Usage: node --env-file=... infra/seed-book-statistics.mjs RANKING.json AUDIT_DIRECTORY [--apply]');
  if (flag && process.env.WRITE_MODE !== 'readwrite') throw Error('A writable target is required');
  const snapshot = JSON.parse(await fs.readFile(snapshotPath, 'utf8'));
  await fs.mkdir(outputDirectory, {recursive: true, mode: 0o700});
  await connectDatabase();
  try {
    const books = await Book.find({deletedAt: null, visibility: {$ne: 'private'}}).sort({_id: 1}).lean();
    const plan = makePlan(books, snapshot), runId = 'book-statistics-' + crypto.randomUUID();
    const report = {runId, source: snapshot.source, observedAt: snapshot.observedAt, plan};
    const filename = path.join(outputDirectory, runId);
    await fs.writeFile(filename + '.json', JSON.stringify(report, null, 2), {mode: 0o600, flag: 'wx'});
    if (flag) {
      const audit = await fs.open(filename + '.jsonl', 'ax', 0o600);
      try {
        report.results = await applyPlan(plan, {runId, source: `${snapshot.source} (${snapshot.observedAt})`, writeAudit: async entry => {await audit.write(JSON.stringify(entry) + '\n'); await audit.sync();}});
      } finally {await audit.close();}
      await fs.writeFile(filename + '-verified.json', JSON.stringify(report, null, 2), {mode: 0o600, flag: 'wx'});
    }
    console.log(JSON.stringify({runId, report: filename + '.json', books: plan.length, ranked: plan.filter(row => row.rank).length,
      seeded: report.results?.filter(row => row.status === 'seeded').length || 0, alreadySeeded: plan.filter(row => row.alreadySeeded).length,
      ranges: Object.fromEntries(['views', 'favorites', 'rating'].map(field => [field, [Math.min(...plan.map(row => row[field])), Math.max(...plan.map(row => row[field]))]]))}));
  } finally {await mongoose.disconnect();}
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main(process.argv.slice(2)).catch(error => {console.error(error.message); process.exitCode = 1;});
