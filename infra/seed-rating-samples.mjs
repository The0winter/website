import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import mongoose from '../server/node_modules/mongoose/index.js';
import Book from '../server/models/Book.js';
import Review from '../server/models/Review.js';
import {connectDatabase} from '../server/database/index.js';
import {ratingSummary} from '../server/services/book-statistics.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const noise = (id, field) => crypto.createHash('sha256').update(`rating-samples-v1\0${id}\0${field}`).digest().readUInt32BE() / 0x100000000;

export function makeRatingPlan(books) {
  const maximum = Math.max(1, ...books.map(book => Number.isFinite(book.views) ? Math.max(0, book.views) : 0));
  return books.map(book => {
    const id = String(book._id), views = Number.isFinite(book.views) ? Math.max(0, book.views) : 0;
    const count = clamp(Math.round(4 + 40 * views / maximum + (noise(id, 'count') - .5) * 14), 1, 50);
    const average = book.statisticsSeed?.rating ?? book.rating;
    const target = Number.isFinite(average) && average >= 1 && average <= 5 ? average : 4.5;
    const votes = Array(count).fill(5);
    let remaining = count * 5 - Math.round(target * count), draw = 0;
    while (remaining > 0) {
      const index = Math.floor(noise(id, `vote-${draw++}`) * count);
      if (votes[index] > 1) {votes[index]--; remaining--;}
    }
    return {id, title: book.title, author: book.author || '', views, votes, alreadyInitialized: Boolean(book.statisticsSeed?.ratingSample)};
  });
}

export async function applyRatingPlan(plan, {runId, writeAudit, now = new Date()}) {
  if (!runId || typeof writeAudit !== 'function') throw Error('Durable audit is required');
  const results = [];
  for (const row of plan) {
    if (!/^[a-f\d]{24}$/.test(row.id) || !Array.isArray(row.votes) || !row.votes.length || row.votes.length > 50 ||
      row.votes.some(value => !Number.isInteger(value) || value < 1 || value > 5) || !Number.isFinite(row.views) || row.views < 0) throw Error('Invalid rating sample');
    let result;
    await mongoose.connection.transaction(async session => {
      // The same book write lock as reader votes prevents a lost concurrent
      // score. Do not change chapter versions, views, favorites or timestamps.
      const book = await Book.findOne({_id: row.id, deletedAt: null, visibility: {$ne: 'private'}}).session(session);
      if (!book || book.title !== row.title || (book.author || '') !== row.author) throw Error('Book changed since preview: ' + row.id);
      if (book.statisticsSeed?.ratingSample) {result = {id: row.id, status: 'already-initialized'}; return;}
      await Book.updateOne({_id: book._id}, {$inc: {milestoneVersion: 1}}, {session, timestamps: false});
      const [stats] = await Review.aggregate([{$match: {book: book._id, isTestData: {$ne:true}}}, {$group: {_id: null, rating: {$avg: '$rating'}, count: {$sum: 1}}}]).session(session);
      const comments = await Review.countDocuments({book: book._id, content: /\S/}).session(session);
      const seed = book.statisticsSeed?.toObject() || {runId, source: 'rating-samples-v1', views: 0, favorites: 0, initializedAt: now};
      seed.ratingSample = {version: 1, runId, views: row.views, initializedAt: now, votes: row.votes};
      seed.ratingWeight = row.votes.length;
      seed.rating = row.votes.reduce((sum, value) => sum + value, 0) / row.votes.length;
      const summary = ratingSummary({statisticsSeed: seed}, stats?.rating, stats?.count);
      await writeAudit({phase: 'prepared', id: row.id, before: {statisticsSeed: book.statisticsSeed, rating: book.rating, numRatings: book.numRatings, numReviews: book.numReviews}, seed, summary});
      await Book.updateOne({_id: book._id}, {$set: {statisticsSeed: seed, rating: summary.rating, numRatings: summary.readerCount, numReviews: comments}}, {session, timestamps: false, runValidators: true});
      result = {id: row.id, title: row.title, status: 'initialized', ...summary, comments};
    });
    await writeAudit({phase: 'completed', ...result});
    results.push(result);
  }
  return results;
}

export async function main(args) {
  const [directory, flag] = args;
  if (!directory || args.length > 2 || (flag && flag !== '--apply')) throw Error('Usage: node --env-file=... infra/seed-rating-samples.mjs AUDIT_DIRECTORY [--apply]');
  if (flag && process.env.WRITE_MODE !== 'readwrite') throw Error('A writable target is required');
  await fs.mkdir(directory, {recursive: true, mode: 0o700});
  await connectDatabase();
  try {
    const books = await Book.find({deletedAt: null, visibility: {$ne: 'private'}}).sort({_id: 1}).lean();
    const plan = makeRatingPlan(books), runId = 'rating-samples-' + crypto.randomUUID();
    const report = {runId, createdAt: new Date().toISOString(), plan};
    const filename = path.join(directory, runId);
    await fs.writeFile(filename + '.json', JSON.stringify(report, null, 2), {mode: 0o600, flag: 'wx'});
    if (flag) {
      const audit = await fs.open(filename + '.jsonl', 'ax', 0o600);
      try {report.results = await applyRatingPlan(plan, {runId, writeAudit: async row => {await audit.write(JSON.stringify(row) + '\n'); await audit.sync();}});}
      finally {await audit.close();}
      await fs.writeFile(filename + '-verified.json', JSON.stringify(report, null, 2), {mode: 0o600, flag: 'wx'});
    }
    const counts = plan.map(row => row.votes.length);
    console.log(JSON.stringify({runId, report: filename + '.json', books: plan.length, initialized: report.results?.filter(row => row.status === 'initialized').length || 0,
      alreadyInitialized: plan.filter(row => row.alreadyInitialized).length, sampleCountRange: counts.length ? [Math.min(...counts), Math.max(...counts)] : []}));
  } finally {await mongoose.disconnect();}
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main(process.argv.slice(2)).catch(error => {console.error(error.message); process.exitCode = 1;});
