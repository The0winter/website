import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import mongoose from '../server/node_modules/mongoose/index.js';
import Book from '../server/models/Book.js';
import {connectDatabase} from '../server/database/index.js';
import {baselineTargets, ensureBookStatistics, needsBookStatistics} from '../server/services/initial-book-statistics.js';

export async function main(args) {
  const [directory, flag] = args;
  if (!directory || args.length > 2 || flag && flag !== '--apply') throw Error('Usage: node --env-file=... infra/ensure-book-statistics.mjs AUDIT_DIRECTORY [--apply]');
  if (flag && process.env.WRITE_MODE !== 'readwrite') throw Error('A writable target is required');
  await fs.mkdir(directory, {recursive:true, mode:0o700});
  await connectDatabase();
  try {
    const books = await Book.find({deletedAt:null, visibility:{$ne:'private'}}).sort({_id:1}).lean();
    const candidates = books.filter(needsBookStatistics);
    const runId = 'book-baseline-' + crypto.randomUUID(), prefix = path.join(directory, runId);
    const report = {runId, observedAt:new Date().toISOString(), books:books.length,
      plan:candidates.map(book => ({id:String(book._id), title:book.title, author:book.author, sourceUrl:book.sourceUrl, currentViews:book.views || 0, target:baselineTargets(book)}))};
    await fs.writeFile(prefix + '.json', JSON.stringify(report, null, 2), {mode:0o600, flag:'wx'});
    const initialized = [];
    if (flag) {
      const audit = await fs.open(prefix + '.jsonl', 'ax', 0o600);
      const writeAudit = async row => {await audit.write(JSON.stringify(row) + '\n'); await audit.sync();};
      try {
        for (const row of report.plan) {
          const changed = await mongoose.connection.transaction(async session => {
            const book = await Book.findById(row.id).session(session);
            if (!book || !needsBookStatistics(book)) return false;
            return ensureBookStatistics(book, {session, runId, writeAudit});
          });
          if (changed) {initialized.push(row.id); await writeAudit({phase:'completed', id:row.id});}
        }
      } finally {await audit.close();}
      const current = await Book.find({deletedAt:null, visibility:{$ne:'private'}}).lean();
      const missing = current.filter(needsBookStatistics).map(book => String(book._id));
      report.verification = {books:current.length, initialized, missing};
      await fs.writeFile(prefix + '-verified.json', JSON.stringify(report, null, 2), {mode:0o600, flag:'wx'});
      if (missing.length) throw Error(`${missing.length} books still need statistics; see ${prefix}-verified.json`);
    }
    console.log(JSON.stringify({runId, report:prefix + '.json', books:books.length, missing:candidates.length, initialized:initialized.length,
      profiles:Object.fromEntries(['upper-middle','middle'].map(profile => [profile, report.plan.filter(row => row.target.profile === profile).length]))}));
  } finally {await mongoose.disconnect();}
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main(process.argv.slice(2)).catch(error => {console.error(error.message);process.exitCode=1;});
