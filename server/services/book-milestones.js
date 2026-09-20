import Book from '../models/Book.js';
import Bookmark from '../models/Bookmark.js';
import {reachedMilestones, milestoneThresholds} from '../../shared/book-milestones.mjs';

const key = event => `${event.kind}:${event.threshold}`;

// Call only while holding this book's write lock in the same transaction as
// the statistic change. The snapshot uses the counts BEFORE that change.
export async function recordBookMilestones(book, before, after, session, now = new Date()) {
  const history = (book.milestoneHistory || []).map(event => ({kind: event.kind, threshold: event.threshold, achievedAt: event.achievedAt ?? null}));
  const known = new Set(history.map(key));
  const append = events => {
    for (const event of events) if (!known.has(key(event))) {known.add(key(event)); history.push(event);}
  };
  if (!book.milestonesInitializedAt) {
    const favorites = before.favorites ?? await Bookmark.countDocuments({bookId: book._id}).session(session);
    append(reachedMilestones({views: book.views, ...before, favorites}));
  }
  append(reachedMilestones(after, now));
  if (!book.milestonesInitializedAt || history.length !== (book.milestoneHistory?.length || 0)) {
    await Book.updateOne({_id: book._id}, {$set: {milestoneHistory: history, milestonesInitializedAt: book.milestonesInitializedAt || now}}, {session, timestamps: false});
  }
  return history;
}

export async function bookMilestones(book) {
  const favorites = await Bookmark.countDocuments({bookId: book._id}).maxTimeMS(3000);
  const counts = {favorites, views: Math.max(0, book.views || 0)};
  const events = (book.milestoneHistory || []).map(event => ({kind: event.kind, threshold: event.threshold, achievedAt: event.achievedAt ?? null}));
  const known = new Set(events.map(key));
  // Legacy totals prove attainment, but cannot prove its original date.
  for (const event of reachedMilestones(counts)) if (!known.has(key(event))) events.push(event);
  events.sort((a, b) => (+new Date(b.achievedAt || 0) - +new Date(a.achievedAt || 0)) || b.threshold - a.threshold || a.kind.localeCompare(b.kind));
  return {counts, events, next: Object.fromEntries(Object.entries(milestoneThresholds).map(([kind, steps]) =>
    [kind, steps.find(threshold => !events.some(event => event.kind === kind && event.threshold === threshold)) ?? null]))};
}
