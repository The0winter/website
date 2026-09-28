import mongoose from 'mongoose';
import Chapter from '../models/Chapter.js';
import {buildCatalogVolumes, buildCatalogVolumeRuns, catalogVolumePattern} from '../../shared/catalog-volumes.mjs';
import {versionedBookCache} from './versioned-book-cache.js';
import {verifyBookVersion} from './book-version.js';
import {bookReadingIndex} from './book-reading-index.js';

// Match JavaScript trim (including BOM), rather than MongoDB's different default.
const whitespace = ' \t\n\r\v\f\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
const trim = input => ({$trim: {input, chars: whitespace}});

// Only volume boundaries and counts cross the Atlas connection. Ordinary
// chapter titles are projected away before the window stages. Compress equal
// raw markers first, then apply the inherited-volume rules in JS.
export const bookCatalog = versionedBookCache(async (bookId, version) => {
  let total, volumes;
  if (mongoose.connection.transport) {
    // The local SQL adapter doesn't implement MongoDB's shift window operator.
    const chapters = await Chapter.find({bookId, deletedAt: null}).select('_id title volume_title volume_number')
      .sort({chapter_number: 1}).maxTimeMS(3000).lean();
    total = chapters.length; volumes = buildCatalogVolumes(chapters);
  } else {
    const runs = await Chapter.aggregate([
      {$match: {bookId: new mongoose.Types.ObjectId(bookId), deletedAt: null}},
      {$sort: {chapter_number: 1}},
      {$project: {chapter_number: 1, volume_number: 1,
        explicit: trim({$cond: [{$eq: [{$type: '$volume_title'}, 'string']}, '$volume_title', '']}),
        prefix: {$regexFind: {input: trim('$title'), regex: catalogVolumePattern}}}},
      {$project: {chapter_number: 1, marker: {
        title: {$cond: [{$ne: ['$explicit', '']}, '$explicit', trim({$ifNull: [{$arrayElemAt: ['$prefix.captures', 0]}, {$ifNull: [{$arrayElemAt: ['$prefix.captures', 1]}, '']}]})]},
        explicit: {$ne: ['$explicit', '']},
        number: {$cond: [{$ne: ['$explicit', '']}, {$ifNull: ['$volume_number', null]}, null]},
        missingNumber: {$or: [{$eq: ['$explicit', '']}, {$eq: [{$type: '$volume_number'}, 'missing']}]},
      }}},
      {$setWindowFields: {sortBy: {chapter_number: 1}, output: {
        position: {$documentNumber: {}}, previous: {$shift: {output: '$marker', by: -1, default: null}},
        total: {$sum: 1, window: {documents: ['unbounded', 'unbounded']}},
      }}},
      {$match: {$expr: {$ne: ['$marker', '$previous']}}},
      {$setWindowFields: {sortBy: {position: 1}, output: {next: {$shift: {output: '$position', by: 1, default: null}}}}},
      {$project: {marker: 1, position: 1, total: 1, count: {$subtract: [{$ifNull: ['$next', {$add: ['$total', 1]}]}, '$position']}}},
      {$sort: {position: 1}},
    ]).option({maxTimeMS: 3000});
    total = runs[0]?.total ?? 0;
    volumes = buildCatalogVolumeRuns(runs.map(run => ({id: String(run._id), count: run.count,
      title: run.marker.title, explicit: run.marker.explicit,
      number: run.marker.missingNumber ? undefined : run.marker.number})));
  }
  await verifyBookVersion(bookId, version);
  return {total, volumes};
}, value => 256 + value.volumes.reduce((bytes, volume) => bytes + 256 + volume.title.length * 2, 0),
{name: 'catalog', maxEntries: 512, maxBytes: 8 * 1024 * 1024});

export const CATALOG_PAGE_SIZE = 256;
const catalogPage = versionedBookCache(async (key, version) => {
  const [bookId, page] = key.split(':');
  const chapters = await Chapter.find({bookId, deletedAt: null}).select('_id title chapter_number')
    .sort({chapter_number: 1}).skip(Number(page) * CATALOG_PAGE_SIZE).limit(CATALOG_PAGE_SIZE)
    .batchSize(CATALOG_PAGE_SIZE).setOptions({singleBatch: true}).maxTimeMS(3000).lean();
  await verifyBookVersion(bookId, version);
  return chapters.map(chapter => ({id: String(chapter._id), title: chapter.title, chapter_number: chapter.chapter_number}));
}, rows => rows.reduce((bytes, row) => bytes + 256 + 2 * row.title.length, 256),
{name: 'catalogPages', maxEntries: 512, maxBytes: 32 * 1024 * 1024});

const anchorPosition = versionedBookCache(async (key, version) => {
  const [bookId, chapterId] = key.split(':');
  const chapter = await Chapter.findOne({_id: chapterId, bookId, deletedAt: null}).select('chapter_number').maxTimeMS(3000).lean();
  const position = chapter ? await Chapter.countDocuments({bookId, deletedAt: null, chapter_number: {$lt: chapter.chapter_number}}).maxTimeMS(3000) : null;
  await verifyBookVersion(bookId, version);
  return position;
}, () => 256, {name: 'catalogAnchors', maxEntries: 2048, maxBytes: 1024 * 1024});

export async function readCatalogWindow(bookId, version, {anchor, offset: requestedOffset, limit}) {
  const summary = bookCatalog(bookId, version);
  const reading = bookReadingIndex.peek(bookId, version);
  // Opening from a book/reader normally reuses the already warm position index.
  // Direct catalog requests count to their anchor without downloading all IDs.
  const position = anchor ? (reading ? reading.then(index => index.indices.get(anchor.toLowerCase()) ?? null)
    : anchorPosition(`${bookId}:${anchor.toLowerCase()}`, version)) : Promise.resolve(null);
  const window = (async () => {
    const activeIndex = await position;
    const total = reading ? (await reading).ids.length : (await summary).total;
    const offset = anchor ? (activeIndex === null || total <= limit ? 0 : Math.max(0, activeIndex - Math.floor(limit / 2))) : Math.min(requestedOffset, total);
    const end = Math.min(total, offset + limit), first = Math.floor(offset / CATALOG_PAGE_SIZE);
    const pages = await Promise.all(Array.from({length: end <= offset ? 0 : Math.ceil(end / CATALOG_PAGE_SIZE) - first},
      (_, i) => catalogPage(`${bookId}:${first + i}`, version)));
    return {offset, activeIndex, rows: pages.flat().slice(offset % CATALOG_PAGE_SIZE, offset % CATALOG_PAGE_SIZE + end - offset)};
  })();
  const [catalog, rows] = await Promise.all([summary, window]);
  return {...catalog, ...rows, version: String(version)};
}
