import {test, expect} from '@playwright/test';
import {getLibrarySnapshot, loadLibrary, prepareLibraryRead, refreshLibrary, setLibraryUser, type LibraryEntry, type LibraryQuery} from '../lib/library-cache';

const originalFetch = globalThis.fetch;
const query: LibraryQuery = {userId: 'reader', tab: 'shelf', sort: 'read', page: 1};
const entry = (bookId: string, updated = '2020-01-01'): LibraryEntry => ({bookId, book: {id: bookId, title: bookId, description: '', lastUpdated: updated}, lastReadAt: '2020-02-01', lastVisitedAt: '2020-02-01', chapterId: 'first'});
const response = (rows: LibraryEntry[], total = rows.length) => new Response(JSON.stringify(rows), {headers: {'X-Total-Count': String(total)}});
test.beforeEach(() => setLibraryUser(query.userId));
test.afterEach(() => {setLibraryUser(null); globalThis.fetch = originalFetch;});

test('reading updates both tabs immediately while respecting the selected sorting rule', async () => {
  const leading = entry('leading', '2025-01-01'), clicked = entry('clicked');
  globalThis.fetch = async () => response([leading, clicked]);
  for (const tab of ['shelf', 'history'] as const) for (const sort of ['read', 'combined', 'updated'] as const) await loadLibrary({...query, tab, sort});
  prepareLibraryRead(query, clicked, 'next');
  for (const tab of ['shelf', 'history'] as const) for (const sort of ['read', 'combined', 'updated'] as const) {
    const rows = getLibrarySnapshot({...query, tab, sort}).rows!;
    expect(rows.map(row => row.bookId)).toEqual(sort === 'updated' ? ['leading', 'clicked'] : ['clicked', 'leading']);
    expect(rows.find(row => row.bookId === 'clicked')?.chapterId).toBe('next');
  }
});

test('moving a second-page book updates cached page boundaries without duplicates', async () => {
  const rows = Array.from({length: 21}, (_, index) => entry(String(index)));
  globalThis.fetch = async input => new URL(String(input), 'http://local').searchParams.get('page') === '2' ? response(rows.slice(20), 21) : response(rows.slice(0, 20), 21);
  await loadLibrary(query); await loadLibrary({...query, page: 2});
  prepareLibraryRead({...query, page: 2}, rows[20], 'first');
  const first = getLibrarySnapshot(query), second = getLibrarySnapshot({...query, page: 2});
  expect(first.rows!.map(row => row.bookId)).toEqual(['20', ...rows.slice(0, 19).map(row => row.bookId)]);
  expect(second.rows!.map(row => row.bookId)).toEqual(['19']);
  expect(first.total).toBe(21); expect(second.total).toBe(21);
});

test('a fresh history entry is added without adding a history-only book to the shelf', async () => {
  globalThis.fetch = async () => response([]);
  await loadLibrary(query); await loadLibrary({...query, tab: 'history'});
  const clicked = {...entry('new'), lastVisitedAt: undefined, lastReadAt: undefined};
  prepareLibraryRead({...query, tab: 'history'}, clicked, 'first');
  expect(getLibrarySnapshot(query).rows).toEqual([]);
  expect(getLibrarySnapshot({...query, tab: 'history'}).rows?.[0].bookId).toBe('new');
  expect(getLibrarySnapshot({...query, tab: 'history'}).total).toBe(1);
});

test('an older response cannot restore the old order, and a failed write restores its snapshot', async () => {
  const rows = [entry('leading'), entry('clicked')];
  globalThis.fetch = async () => response(rows);
  await loadLibrary(query);
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  globalThis.fetch = async () => {await gate; return response(rows);};
  const stale = loadLibrary(query, true);
  const rollback = prepareLibraryRead(query, rows[1], 'next');
  release(); await stale;
  expect(getLibrarySnapshot(query).rows?.[0].bookId).toBe('clicked');
  rollback();
  expect(getLibrarySnapshot(query).rows).toEqual(rows);
});

test('confirmed writes refresh all visited queries, including a sparse later page and URL-selected sort', async () => {
  globalThis.fetch = async () => response([entry('old')], 81);
  const queries: LibraryQuery[] = [query, {...query, tab: 'history', sort: 'updated', page: 5}];
  for (const query of queries) await loadLibrary(query);
  const calls: string[] = [];
  globalThis.fetch = async input => {calls.push(String(input)); return response([entry('new')], 81);};
  await refreshLibrary(query.userId);
  expect(calls).toHaveLength(2);
  expect(calls.some(url => url.includes('tab=history&sort=updated&page=5'))).toBe(true);
  for (const query of queries) expect(getLibrarySnapshot(query).rows?.[0].bookId).toBe('new');
});

test('rollback never overwrites newer data or restores another account', async () => {
  globalThis.fetch = async () => response([entry('leading'), entry('clicked')]);
  await loadLibrary(query);
  const rollback = prepareLibraryRead(query, entry('clicked'), 'first');
  globalThis.fetch = async () => response([entry('confirmed')]);
  await refreshLibrary(query.userId);
  rollback();
  expect(getLibrarySnapshot(query).rows?.[0].bookId).toBe('confirmed');
  setLibraryUser('other'); rollback();
  expect(getLibrarySnapshot(query).rows).toBeNull();
});
