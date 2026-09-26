import {decode, identifier, literal} from '../database/codec.js';
import {fieldSql, filterPlan} from '../database/query.js';

// Only overlapping reads are shared. A completed ranking is never retained,
// so publication/privacy changes and new-day counters are visible immediately.
const pendingByTransport = new WeakMap();
async function queryOnce(transport, sql) {
  let pending = pendingByTransport.get(transport);
  if (!pending) {pending = new Map(); pendingByTransport.set(transport, pending);}
  if (pending.has(sql)) return pending.get(sql);
  const request = transport.query(sql).finally(() => pending.delete(sql));
  pending.set(sql, request);
  return request;
}

export async function rankedSqlBooks(connection, books, filter, period, direction, skip, limit) {
  if (!connection.transport || !books.scalarFields) return;
  const plan = filterPlan(filter, books.scalarFields());
  // Search regexes and other non-scalar predicates keep the document adapter's
  // exact filtering semantics instead of ranking an SQL superset.
  if (!plan.exact) return;
  if (!Number.isSafeInteger(skip) || skip < 0 || !Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid ranking page');
  await Promise.all([connection.ensureCollection(books.name), ...(period ? [connection.ensureCollection('readdailies')] : [])]);
  const dailyBook = fieldSql('bookId'), dailyViews = fieldSql('views'), day = fieldSql('day');
  const periods = period ? `periods AS (
    SELECT ${dailyBook} AS bookId, SUM(${dailyViews}) AS views FROM "readdailies"
    WHERE ${day} >= ${literal(period.start)} AND ${day} <= ${literal(period.today)}
      AND ${dailyBook} IN (SELECT id FROM selected_books) GROUP BY ${dailyBook}
  ),` : '';
  const views = period ? 'p.views' : fieldSql('views', 'b.document');
  const sort = direction === 1 ? 'ASC' : 'DESC';
  // One database snapshot computes the category-wide maximum, final 80/20
  // score, deterministic ordering, pagination and total. Only this page of
  // documents crosses the D1 network boundary; no all-book transfer or ID list.
  const sql = `SELECT * FROM (
    WITH selected_books AS (SELECT id, document FROM ${identifier(books.name)} WHERE ${plan.sql}),
    ${periods}
    candidates AS (
      SELECT b.id, b.document, MAX(0, COALESCE(${views}, 0)) AS rankingViews,
        MIN(5, MAX(0, COALESCE(${fieldSql('rating', 'b.document')}, 0))) AS rankingRating
      FROM selected_books b ${period ? 'LEFT JOIN periods p ON p.bookId = b.id' : ''}
    ),
    scores AS (
      SELECT *, COALESCE(80.0 * (1.0 * rankingViews / NULLIF(MAX(rankingViews) OVER (), 0)), 0)
        + 4 * rankingRating AS rankingScore FROM candidates
    ),
    page AS (
      SELECT * FROM scores ORDER BY rankingScore ${sort}, rankingViews ${sort}, rankingRating ${sort}, id ASC
        LIMIT ${limit} OFFSET ${skip}
    )
    SELECT page.document, page.rankingViews, page.rankingScore, summary.total
      FROM (SELECT COUNT(*) AS total FROM selected_books) summary LEFT JOIN page ON 1 = 1
      ORDER BY rankingScore ${sort}, rankingViews ${sort}, rankingRating ${sort}, id ASC
  )`;
  const result = await queryOnce(connection.transport, sql);
  return {rows: result.filter(row => row.document !== null).map(row => ({...decode(row.document),
    rankingViews: row.rankingViews, rankingScore: row.rankingScore})), total: result[0].total};
}
