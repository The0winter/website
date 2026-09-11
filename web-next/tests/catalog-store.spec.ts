import {test, expect} from '@playwright/test';
import {BookCatalog, catalogStrategy} from '../lib/book-catalog';

const fetchOriginal = globalThis.fetch;
test.afterEach(() => {globalThis.fetch = fetchOriginal;});
const rows = (offset: number, count: number) => Array.from({length: count}, (_, i) => ({id: `chapter-${offset + i}`, title: `章节 ${offset + i}`, chapter_number: offset + i + 1}));
const response = (offset: number, count: number, total = 10000, version = '0') => new Response(JSON.stringify({offset, total, version, activeIndex: null, rows: rows(offset, count)}));

test('a deep anchor is the first request and shared observers reuse its window', async () => {
  const calls: string[] = []; let release!: () => void; const gate = new Promise<void>(resolve => {release = resolve;});
  globalThis.fetch = async input => {calls.push(String(input)); await gate; return response(7936, 128);};
  const catalog = new BookCatalog('book', '0');
  const a = catalog.watch('chapter-8000', false), b = catalog.watch('chapter-8000', false);
  expect(calls).toHaveLength(1); expect(calls[0]).toContain('anchor=chapter-8000'); expect(calls[0]).toContain('limit=128');
  release(); await expect.poll(() => catalog.getSnapshot().indices.get('chapter-8000')).toBe(8000);
  expect(catalog.getSnapshot().rows.has(0)).toBe(false);
  a(); b(); const c = catalog.watch('chapter-8001', false); expect(calls).toHaveLength(1); c(); catalog.dispose();
});

test('an urgent scroll request can run while background filling is delayed', async () => {
  const calls: URL[] = []; let release!: () => void; const gate = new Promise<void>(resolve => {release = resolve;});
  globalThis.fetch = async input => {
    const url = new URL(String(input), 'http://local'); calls.push(url);
    if (url.searchParams.has('anchor')) return response(7936, 128);
    if (url.searchParams.get('limit') === '2048') await gate;
    const offset = Number(url.searchParams.get('offset')); return response(offset, Math.min(Number(url.searchParams.get('limit')), 10000 - offset));
  };
  const catalog = new BookCatalog('book', '0'), close = catalog.watch('chapter-8000', true);
  await expect.poll(() => calls.length).toBe(2);
  catalog.ensureRange(1000, 1030);
  await expect.poll(() => catalog.getSnapshot().rows.has(1000)).toBe(true);
  expect(catalog.getSnapshot().rows.has(0)).toBe(false);
  close(); release(); catalog.dispose();
});

test('version conflicts discard old positions before retrying the anchor', async () => {
  let count = 0;
  globalThis.fetch = async () => ++count === 1 ? new Response(JSON.stringify({version: '1'}), {status: 409}) : response(7990, 128, 10001, '1');
  const catalog = new BookCatalog('book', '0', {rows: rows(0, 30), total: 10000});
  const close = catalog.watch('chapter-8000', false);
  await expect.poll(() => catalog.getSnapshot().indices.get('chapter-8000')).toBe(8000);
  expect(catalog.getSnapshot().version).toBe('1'); expect(catalog.getSnapshot().rows.has(0)).toBe(false);
  expect(count).toBe(2); close(); catalog.dispose();
});

test('a failed target remains retryable and failed responses are not cached', async () => {
  let fail = true;
  globalThis.fetch = async () => fail ? new Response('', {status: 503}) : response(7936, 128);
  const catalog = new BookCatalog('book', '0'), close = catalog.watch('chapter-8000', false);
  await expect.poll(() => catalog.getSnapshot().error).toContain('重试');
  expect(catalog.getSnapshot().rows.size).toBe(0);
  fail = false; catalog.retry();
  await expect.poll(() => catalog.getSnapshot().rows.has(8000)).toBe(true);
  expect(catalog.getSnapshot().error).toBe(''); close(); catalog.dispose();
});

test('saved data mode fetches only requested windows; complete SSR catalogs need no request', async () => {
  const calls: string[] = [];
  globalThis.fetch = async input => {calls.push(String(input)); return response(7936, 128);};
  const small = new BookCatalog('small', '0', {rows: rows(0, 12), total: 12});
  const closeSmall = small.watch('chapter-10', true); expect(calls).toHaveLength(0); closeSmall(); small.dispose();
  const large = new BookCatalog('large', '0'), close = large.watch('chapter-8000', true, {saveData: true});
  await expect.poll(() => large.getSnapshot().rows.size).toBe(128);
  expect(calls).toHaveLength(1); close(); large.dispose();
});

test('batch selection distinguishes initial visibility, background work and constrained links', () => {
  expect(catalogStrategy(375)).toEqual({initial: 375, batch: 2048, background: true});
  expect(catalogStrategy(10000).initial).toBe(128);
  expect(catalogStrategy(375, {downlink: .5})).toEqual({initial: 128, batch: 512, background: true});
  expect(catalogStrategy(10000, {saveData: true}).background).toBe(false);
  expect(catalogStrategy(50000).background).toBe(false);
});

test('very large catalogs keep a bounded cache and reload discarded ranges on demand', async () => {
  globalThis.fetch = async input => {
    const url = new URL(String(input), 'http://local'), offset = Number(url.searchParams.get('offset'));
    return response(offset, 128, 50000);
  };
  const catalog = new BookCatalog('book', '0', {rows: rows(0, 20000), total: 50000});
  const close = catalog.watch('chapter-10000', false);
  catalog.ensureRange(40000, 40030);
  await expect.poll(() => catalog.getSnapshot().rows.has(40000)).toBe(true);
  expect(catalog.getSnapshot().rows.size).toBe(20000);
  expect(catalog.getSnapshot().indices.has('chapter-0')).toBe(false);
  catalog.ensureRange(0, 15);
  await expect.poll(() => catalog.getSnapshot().rows.has(0)).toBe(true);
  expect(catalog.getSnapshot().rows.size).toBe(20000); close(); catalog.dispose();
});
