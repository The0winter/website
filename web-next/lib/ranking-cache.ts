import type {Book} from './api';
import {safeFetch} from './request';

export type RankingQuery = {visit: string; orderBy: string; category: string};
type Snapshot = {books: Book[] | null; error: boolean; loadingMore: boolean; moreError: boolean; hasMore: boolean; fetchMs: number};
type Record = {key: string; snapshot: Snapshot; nextPage: number; scroll?: {top: number; categories: number}; readingMs: number; controller?: AbortController; pending?: Promise<void>};
const empty: Snapshot = {books: null, error: false, loadingMore: false, moreError: false, hasMore: false, fetchMs: 600};
export const rankingPageSize = 20;
const rankingLimit = 100;
const records = new Map<string, Record>();
const listeners = new Set<() => void>();
const readingLimit = 5 * 60 * 1000;
let readingVisit: string | undefined;
let startedAt: number | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
const keyFor = (query: RankingQuery) => `${query.orderBy}:${query.category}`;
const notify = () => listeners.forEach(listener => listener());

export const serverRankingSnapshot = () => empty;
export const getRankingSnapshot = (query: RankingQuery) => records.get(query.visit)?.key === keyFor(query) ? records.get(query.visit)!.snapshot : empty;
export function subscribeRanking(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};}

function release(visit: string) {
  records.get(visit)?.controller?.abort();
  records.delete(visit);
  notify();
}

function fetchPage(query: RankingQuery, current: Record) {
  const controller = new AbortController(), page = current.nextPage, started = performance.now();
  const previous = current.snapshot.books;
  current.controller = controller;
  current.snapshot = {...current.snapshot, loadingMore: Boolean(previous), moreError: false};
  const valid = () => !controller.signal.aborted && records.get(query.visit) === current;
  const params = new URLSearchParams({orderBy: query.orderBy, limit: String(rankingPageSize), page: String(page)});
  if (query.category !== '全部') params.set('category', query.category);
  current.pending = (async () => {
    try {
      const response = await safeFetch(`/api/books?${params}`, {signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)])});
      if (!response.ok) throw new Error('Ranking unavailable');
      const books: Book[] = await response.json();
      if (!Array.isArray(books)) throw new Error('Invalid ranking');
      if (valid()) {
        const combined = [...new Map([...(previous || []), ...books].map(book => [book.id, book])).values()].slice(0, rankingLimit);
        const count = response.headers.get('X-Total-Count');
        const total = count !== null && Number.isFinite(Number(count)) ? Math.min(Number(count), rankingLimit) : rankingLimit;
        current.nextPage = page + 1;
        current.snapshot = {books: combined, error: false, loadingMore: false, moreError: false,
          hasMore: books.length >= rankingPageSize && page * rankingPageSize < total,
          fetchMs: Math.max(200, Math.min(5000, performance.now() - started))};
      }
    } catch {
      if (valid()) current.snapshot = {...current.snapshot, loadingMore: false, error: !previous, moreError: Boolean(previous)};
    } finally {
      if (valid()) {current.pending = undefined; current.controller = undefined; notify();}
    }
  })();
  notify();
  return current.pending;
}

export function loadRanking(query: RankingQuery, force = false) {
  if (!query.visit) return Promise.resolve();
  const key = keyFor(query);
  let record = records.get(query.visit);
  if (record?.key === key && !force) {
    records.delete(query.visit); records.set(query.visit, record);
    if (record.pending) return record.pending;
    if (record.snapshot.books || record.snapshot.error) return Promise.resolve();
  }
  record?.controller?.abort();
  record = {key, snapshot: empty, nextPage: 1, scroll: record?.key === key ? record.scroll : undefined, readingMs: 0};
  records.delete(query.visit); records.set(query.visit, record);
  // Retain loaded pages and scroll for three visits, with at most 100 books each.
  while (records.size > 3) release(records.keys().next().value!);
  return fetchPage(query, record);
}

export function loadMoreRanking(query: RankingQuery) {
  const record = records.get(query.visit);
  if (record?.key !== keyFor(query) || !record.snapshot.books || !record.snapshot.hasMore) return Promise.resolve();
  return record.pending || fetchPage(query, record);
}

export function rememberRankingScroll(query: RankingQuery, top: number, categories: number) {
  const record = records.get(query.visit);
  if (record?.key === keyFor(query)) record.scroll = {top, categories};
}
export const rankingScroll = (query: RankingQuery) => records.get(query.visit)?.key === keyFor(query) ? records.get(query.visit)!.scroll : undefined;

// Count foreground time in the reader across chapter changes and brief detail
// visits. Browsing details or leaving the browser in the background costs none.
function checkpoint() {
  clearTimeout(timer); timer = undefined;
  if (readingVisit && startedAt !== undefined) {
    const record = records.get(readingVisit);
    if (record) {
      record.readingMs += Math.max(0, Date.now() - startedAt);
      if (record.readingMs >= readingLimit) release(readingVisit);
    }
  }
  startedAt = undefined;
}
function resume() {
  const record = readingVisit ? records.get(readingVisit) : undefined;
  if (!record || document.visibilityState !== 'visible') return;
  startedAt = Date.now();
  timer = setTimeout(() => {checkpoint(); resume();}, Math.max(1, readingLimit - record.readingMs));
}
export function trackRankingReading(visit: string | undefined, reading: boolean) {
  checkpoint();
  readingVisit = reading ? visit : undefined;
  resume();
}
export function installRankingCache() {
  const visibility = () => {checkpoint(); resume();};
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pagehide', checkpoint);
  window.addEventListener('pageshow', visibility);
  return () => {checkpoint(); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', checkpoint); window.removeEventListener('pageshow', visibility);};
}
