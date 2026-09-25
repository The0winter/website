import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import mongoose from '../server/node_modules/mongoose/index.js';
import Book from '../server/models/Book.js';
import Chapter from '../server/models/Chapter.js';
import {connectDatabase} from '../server/database/index.js';
import {recordBookUpdate} from '../server/services/book-update-time.js';

export async function inspectBookUpdateTimes(now = new Date()) {
  // Simple field accumulators execute in both MongoDB and D1, returning only
  // one metadata row per book. Never fetch chapter bodies for this repair.
  const [books, publications] = await Promise.all([
    Book.find({deletedAt: null}).select('_id title lastUpdated createdAt').lean(),
    Chapter.aggregate([{$match: {deletedAt: null}}, {$group: {_id: '$bookId',
      created: {$max: '$createdAt'}, published: {$max: '$published_at'}}}]),
  ]);
  const byId = new Map(publications.map(row => [String(row._id), row]));
  const plan = [], unknown = [], invalid = [];
  for (const book of books) {
    const id = String(book._id), publication = byId.get(id);
    const times = [publication?.created, publication?.published].filter(value => value != null).map(value => +new Date(value));
    if (!times.length) {unknown.push({id, title: book.title}); continue;}
    const at = Math.max(...times);
    if (!Number.isFinite(at) || at > +now) {invalid.push({id, title: book.title}); continue;}
    // Historical updatedAt may reflect source-link enrichment, storage moves,
    // statistics or reads. Use recorded publication evidence, never repair time.
    if (book.lastUpdated && +new Date(book.lastUpdated) >= at) continue;
    plan.push({id, title: book.title, before: book.lastUpdated ?? null, after: new Date(at)});
  }
  return {observedAt: now.toISOString(), books: books.length, plan, unknown, invalid};
}

export async function main(args) {
  const [directory, flag] = args;
  if (!directory || args.length > 2 || flag && flag !== '--apply') throw Error('Usage: repair-book-update-times.mjs AUDIT_DIRECTORY [--apply]');
  if (flag && process.env.WRITE_MODE !== 'readwrite') throw Error('A writable target is required');
  await fs.mkdir(directory, {recursive: true, mode: 0o700});
  await connectDatabase();
  try {
    const report = await inspectBookUpdateTimes(), runId = 'book-update-time-' + crypto.randomUUID();
    const file = path.join(directory, runId + '.json');
    // Persist original values before any writes. The update is monotonic, so a
    // concurrent publication cannot be replaced by this older historical value.
    const audit = await fs.open(file, 'wx', 0o600);
    try {await audit.writeFile(JSON.stringify(report, null, 2)); await audit.sync();} finally {await audit.close();}
    let repaired = 0;
    if (flag) {
      await Book.collection.createIndex({deletedAt: 1, lastUpdated: -1, _id: 1});
      for (const row of report.plan) {await recordBookUpdate(row.id, null, row.after); repaired++;}
      const verification = await inspectBookUpdateTimes();
      await fs.writeFile(path.join(directory, runId + '-verified.json'), JSON.stringify(verification, null, 2), {mode: 0o600, flag: 'wx'});
      if (verification.plan.length || verification.invalid.length) throw Error('Unresolved update times; see repair audit');
    }
    console.log(JSON.stringify({report: file, books: report.books, candidates: report.plan.length, repaired,
      unknown: report.unknown.length, invalid: report.invalid.length, examples: report.plan.slice(0, 5)}));
  } finally {await mongoose.disconnect();}
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main(process.argv.slice(2)).catch(error => {console.error(error.message); process.exitCode = 1;});
