import type {Book} from './api';
import {safeFetch} from './request';

export type LibraryTab = 'shelf' | 'history';
export type LibrarySort = 'combined' | 'read' | 'updated';
export type LibraryEntry = {bookId: string; book: Book | null; lastReadAt?: string; lastVisitedAt?: string; chapterId?: string; chapterTitle?: string; latestChapterTitle?: string};
export type LibraryQuery = {userId: string; tab: LibraryTab; sort: LibrarySort; page: number};
type Snapshot = {rows: LibraryEntry[] | null; total: number; error: string; updatedAt: number};
type Record = {snapshot: Snapshot; pending?: Promise<void>; controller?: AbortController};
const empty: Snapshot = {rows: null, total: 0, error: '', updatedAt: 0};
const records = new Map<string, Record>();
const listeners = new Set<() => void>();
let sessionUser: string | null = null;
const keyFor = (query: LibraryQuery) => [query.userId, query.tab, query.sort, query.page].join(':');
const notify = () => listeners.forEach(listener => listener());

// Private data belongs only to the confirmed session in this browser document.
// Clearing also prevents late responses from repopulating a signed-out account.
export function setLibraryUser(userId: string | null) {
  if (sessionUser === userId) return;
  sessionUser = userId;
  records.forEach(record => record.controller?.abort());
  records.clear();
  notify();
}

export function getLibrarySnapshot(query: LibraryQuery) {
  return query.userId === sessionUser ? records.get(keyFor(query))?.snapshot ?? empty : empty;
}
export const serverLibrarySnapshot = () => empty;
export function subscribeLibrary(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function loadLibrary(query: LibraryQuery, force = false): Promise<void> {
  if (!query.userId || query.userId !== sessionUser) return Promise.resolve();
  const key = keyFor(query);
  let record = records.get(key);
  if (record?.pending) return record.pending;
  if (!force && record?.snapshot.rows && Date.now() - record.snapshot.updatedAt < 60000) return Promise.resolve();
  record ??= {snapshot: empty};
  records.delete(key);
  records.set(key, record);
  while (records.size > 12) {
    const oldest = records.keys().next().value!;
    records.get(oldest)?.controller?.abort();
    records.delete(oldest);
  }
  const current = record;
  const controller = new AbortController();
  current.controller = controller;
  const valid = () => !controller.signal.aborted && sessionUser === query.userId && records.get(key) === current;
  current.pending = (async () => {
    try {
      const params = new URLSearchParams({tab: query.tab, sort: query.sort, page: String(query.page), limit: '20'});
      const response = await safeFetch('/api/users/' + encodeURIComponent(query.userId) + '/library?' + params, {
        cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      });
      if (response.status === 401 || response.status === 403) {
        if (valid()) current.snapshot = {...empty, error: '登录已失效，请重新登录'};
        return;
      }
      if (!response.ok) throw new Error('暂时加载失败，请重试');
      const rows: LibraryEntry[] = await response.json();
      if (valid()) current.snapshot = {rows, total: Number(response.headers.get('X-Total-Count') || rows.length), error: '', updatedAt: Date.now()};
    } catch (error) {
      if (valid()) current.snapshot = {...current.snapshot, error: error instanceof Error ? error.message : '暂时加载失败，请重试'};
    } finally {
      if (valid()) {current.pending = undefined; current.controller = undefined; notify();}
    }
  })();
  return current.pending;
}

export function invalidateLibrary(userId: string) {
  if (sessionUser !== userId) return;
  records.forEach(record => {
    record.controller?.abort();
    record.pending = undefined;
    record.snapshot = {...record.snapshot, updatedAt: 0, error: ''};
  });
  notify();
}

// Apply confirmed deletions even if the following refresh is unavailable.
export function removeLibraryEntries(userId: string, tab: LibraryTab, bookIds: string[]) {
  if (sessionUser !== userId || !bookIds.length) return;
  const removed = new Set(bookIds);
  records.forEach((record, key) => {
    if (!key.startsWith(`${userId}:${tab}:`)) return;
    record.controller?.abort(); record.controller = undefined; record.pending = undefined;
    const remaining = record.snapshot.rows?.filter(entry => !removed.has(entry.bookId)) ?? null;
    const removedHere = (record.snapshot.rows?.length ?? 0) - (remaining?.length ?? 0);
    record.snapshot = {...record.snapshot, rows: remaining, total: Math.max(0, record.snapshot.total - removedHere), updatedAt: 0};
  });
  notify();
}

export function prefetchLibrary(userId: string, sort: LibrarySort) {
  return Promise.all((['shelf', 'history'] as const).map(tab => loadLibrary({userId, tab, sort, page: 1})));
}
