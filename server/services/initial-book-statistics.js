import crypto from 'node:crypto';
import Book from '../models/Book.js';
import Bookmark from '../models/Bookmark.js';
import Review from '../models/Review.js';
import {ratingSummary} from './book-statistics.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const noise = (book, field) => crypto.createHash('sha256').update(`book-baseline-v1\0${book._id}\0${field}`).digest().readUInt32BE() / 0x100000000;
const validVotes = votes => Array.isArray(votes) && votes.length > 0 && votes.length <= 50 && votes.every(value => Number.isInteger(value) && value >= 1 && value <= 5);
const validCount = value => Number.isSafeInteger(value) && value >= 0;

export function baselineProfile(book) {
  let host = '';
  try {host = new URL(book.sourceUrl).hostname.toLowerCase();} catch { /* Authored books use the middle level. */ }
  return ['banshanren.com', 'diyibanzhu.click'].some(domain => host === domain || host.endsWith('.' + domain)) ? 'upper-middle' : 'middle';
}

export function baselineTargets(book) {
  const profile = baselineProfile(book);
  const popularity = profile === 'upper-middle' ? .58 + noise(book, 'level') * .16 : .42 + noise(book, 'level') * .16;
  return {profile, views: Math.round(2000 + 48000 * popularity), favorites: Math.round(100 + 1900 * popularity),
    rating: Math.round((8.9 + popularity) * 10) / 20};
}

function needsBase(seed) {
  return !seed || seed.source === 'rating-samples-v1' || !validCount(seed.views) || !validCount(seed.favorites);
}

export function needsBookStatistics(book) {
  return !book.deletedAt && book.visibility !== 'private' && (needsBase(book.statisticsSeed) || !validVotes(book.statisticsSeed?.ratingSample?.votes));
}

export function initialStatisticsPlan(book, {favorites = 0, readerAverage = 0, readerCount = 0, comments = 0, now = new Date(), runId = `book-baseline-v1:${book._id}`} = {}) {
  if (!needsBookStatistics(book)) return null;
  const target = baselineTargets(book);
  const previous = book.statisticsSeed?.toObject?.() || book.statisticsSeed;
  const missingBase = needsBase(previous);
  const addedViews = missingBase ? Math.max(0, target.views - (book.views || 0)) : 0;
  const seed = {...previous, runId: previous?.runId || runId, initializedAt: previous?.initializedAt || now,
    source: missingBase ? `qidian-monthly-levels-v1:${target.profile}` : previous.source,
    views: Math.max(0, previous?.views || 0) + addedViews,
    favorites: missingBase ? Math.max(previous?.favorites || 0, target.favorites - favorites, 0) : previous.favorites};
  if (missingBase) {seed.baselineProfile = target.profile; seed.baselinePolicyVersion = 1;}
  if (!validVotes(seed.ratingSample?.votes)) {
    const count = clamp(Math.round(4 + 40 * target.views / 50000 + (noise(book, 'count') - .5) * 14), 1, 50);
    const average = Number.isFinite(seed.rating) && seed.rating >= 1 && seed.rating <= 5 ? seed.rating : target.rating;
    const total = clamp(Math.round(average * count), count, count * 5);
    const votes = Array(count).fill(Math.floor(total / count));
    const order = Array.from({length:count}, (_, i) => i).sort((a,b) => noise(book, `vote-${a}`) - noise(book, `vote-${b}`));
    for (const index of order.slice(0, total % count)) votes[index]++;
    seed.ratingSample = {version:1, runId, initializedAt:now, views:target.views, votes};
  }
  seed.ratingWeight = seed.ratingSample.votes.length;
  seed.rating = seed.ratingSample.votes.reduce((sum,value) => sum + value, 0) / seed.ratingWeight;
  const summary = ratingSummary({statisticsSeed:seed}, readerAverage, readerCount);
  return {statisticsSeed:seed, views:(book.views || 0) + addedViews, rating:summary.rating, numRatings:summary.readerCount, numReviews:comments};
}

// Call within the upload/publication transaction. Missing data and new chapters
// commit together; a conflict or a retry cannot leave or duplicate a baseline.
export async function ensureBookStatistics(book, {session, writeAudit, runId, now = new Date()} = {}) {
  if (!needsBookStatistics(book)) return false;
  if (!session?.inTransaction()) throw Error('Statistics initialization requires the book transaction');
  await Book.updateOne({_id:book._id}, {$inc:{milestoneVersion:1}}, {session, timestamps:false});
  const [stats] = await Review.aggregate([{$match:{book:book._id}}, {$group:{_id:null, average:{$avg:'$rating'}, count:{$sum:1}}}]).session(session);
  const favorites = await Bookmark.countDocuments({bookId:book._id}).session(session);
  const comments = await Review.countDocuments({book:book._id, content:/\S/}).session(session);
  const update = initialStatisticsPlan(book, {favorites, readerAverage:stats?.average, readerCount:stats?.count, comments, now, runId});
  await writeAudit?.({phase:'prepared', id:String(book._id), title:book.title, before:{statisticsSeed:book.statisticsSeed, views:book.views, rating:book.rating, numRatings:book.numRatings, numReviews:book.numReviews}, update});
  await Book.updateOne({_id:book._id}, {$set:update}, {session, timestamps:false, runValidators:true});
  Object.assign(book, update);
  return true;
}
