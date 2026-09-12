import type {Book} from './api';
import {safeFetch} from './request';

export type RankingQuery = {visit: string; orderBy: string; category: string};
type Snapshot = {books: Book[] | null; error: boolean};
type Record = {key: string; snapshot: Snapshot; scroll?: {top: number; categories: number}; readingMs: number; controller?: AbortController; pending?: Promise<void>};
const empty: Snapshot = {books: null, error: false};
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
  record = {key, snapshot: empty, scroll: record?.key === key ? record.scroll : undefined, readingMs: 0};
  records.delete(query.visit);
  records.set(query.visit, record);
  // Each visit retains only its displayed list (at most 100 books).
  while (records.size > 3) release(records.keys().next().value!);
  const current = record, controller = new AbortController();
  current.controller = controller;
  const valid = () => !controller.signal.aborted && records.get(query.visit) === current;
  const params = new URLSearchParams({orderBy: query.orderBy, limit: '100'});
  if (query.category !== '全部') params.set('category', query.category);
  current.pending = (async () => {
    try {
      const response = await safeFetch(`/api/books?${params}`, {signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)])});
      if (!response.ok) throw new Error('Ranking unavailable');
      const books: Book[] = await response.json();
      if (!Array.isArray(books)) throw new Error('Invalid ranking');
      if (valid()) current.snapshot = {books, error: false};
    } catch {
      if (valid()) current.snapshot = {books: null, error: true};
    } finally {
      if (valid()) {current.pending = undefined; current.controller = undefined; notify();}
    }
  })();
  notify();
  return current.pending;
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
