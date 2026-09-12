import type {Book} from './api';
import {safeFetch} from './request';

export type LibraryTab = 'shelf' | 'history';
export type LibrarySort = 'combined' | 'read' | 'updated';
export type LibraryEntry = {bookId: string; book: Book | null; lastReadAt?: string; lastVisitedAt?: string; chapterId?: string; firstChapterId?: string | null; chapterTitle?: string; latestChapterTitle?: string};
export type LibraryQuery = {userId: string; tab: LibraryTab; sort: LibrarySort; page: number};
type Snapshot = {rows: LibraryEntry[] | null; total: number; error: string; updatedAt: number};
type Record = {query: LibraryQuery; snapshot: Snapshot; pending?: Promise<void>; controller?: AbortController};
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
  record ??= {query: {...query}, snapshot: empty};
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

// Refresh the actual visited pages too, including URL-selected sorts and pages
// other than the first. Do this while the reader is open, before returning.
export function refreshLibrary(userId: string) {
  if (sessionUser !== userId) return Promise.resolve([]);
  const queries = [...records.values()].map(record => record.query);
  invalidateLibrary(userId);
  return Promise.all(queries.map(query => loadLibrary(query, true)));
}

// The loading paper already covers the source when this runs. Update cached
// lists immediately; the confirmed server write then refreshes exact page edges.
export function prepareLibraryRead(query: LibraryQuery, entry: LibraryEntry, chapterId: string) {
  if (sessionUser !== query.userId) return () => {};
  const now = Date.now(), readAt = new Date(now).toISOString();
  const clicked = {...entry, chapterId, lastReadAt: readAt, lastVisitedAt: readAt,
    chapterTitle: entry.chapterId === chapterId ? entry.chapterTitle : undefined};
  const cached = [...records.values()];
  const onShelf = query.tab === 'shelf' || cached.some(record => record.query.tab === 'shelf' && record.snapshot.rows?.some(row => row.bookId === entry.bookId));
  const inHistory = Boolean(entry.lastVisitedAt || entry.lastReadAt) || cached.some(record => record.query.tab === 'history' && record.snapshot.rows?.some(row => row.bookId === entry.bookId));
  const changes: {record: Record; before: Snapshot; after: Snapshot}[] = [];
  const time = (value?: string) => value ? Date.parse(value) || 0 : 0;
  for (const tab of ['shelf', 'history'] as const) for (const sort of ['combined', 'read', 'updated'] as const) {
    if (tab === 'shelf' && !onShelf) continue;
    const pages = new Map(cached.filter(record => record.query.tab === tab && record.query.sort === sort).map(record => [record.query.page, record]));
    const prefix: LibraryEntry[] = [];
    let pageCount = 0;
    while (pages.get(pageCount + 1)?.snapshot.rows) {
      const rows = pages.get(++pageCount)!.snapshot.rows!;
      prefix.push(...rows);
      if (rows.length < 20) break;
    }
    const reordered = [...prefix.filter(row => row.bookId !== entry.bookId), clicked];
    const rank = (row: LibraryEntry) => {
      const read = time(row.lastReadAt || (tab === 'history' ? row.lastVisitedAt : undefined));
      const updated = time(row.book?.lastUpdated);
      return [sort === 'read' ? read : sort === 'updated' ? updated : Math.max(read, updated), read, updated];
    };
    reordered.sort((a, b) => {const x = rank(a), y = rank(b); return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];});
    for (const [page, record] of pages) {
      if (!record.snapshot.rows) continue;
      const before = record.snapshot;
      record.controller?.abort(); record.controller = undefined; record.pending = undefined;
      // Across a gap we cannot invent the preceding page's boundary row. Keep
      // its existing rows until the eager server refresh supplies the exact page.
      const rows = page <= pageCount ? reordered.slice((page - 1) * 20, page * 20)
        : before.rows!.map(row => row.bookId === entry.bookId ? clicked : row);
      const after = {...before, rows, total: before.total + (tab === 'history' && !inHistory ? 1 : 0), updatedAt: now};
      record.snapshot = after;
      changes.push({record, before, after});
    }
  }
  notify();
  // A failed write must not leave an invented reading order behind, nor undo a
  // newer read, refresh, deletion or account change that has replaced our data.
  return () => {
    for (const {record, before, after} of changes) if (record.snapshot === after) record.snapshot = before;
    if (sessionUser === query.userId) notify();
  };
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
