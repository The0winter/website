import Book from '../models/Book.js';

// Content publication time is separate from Mongoose's general updatedAt:
// views, ratings, cover changes and unchanged import retries are not updates.
export async function recordBookUpdate(bookId, session, at = new Date()) {
  await Book.updateOne({_id: bookId}, {$max: {lastUpdated: at}}, {session, timestamps: false});
}
