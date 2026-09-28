import {test, expect} from '@playwright/test';
import {BookCatalog, catalogStrategy} from '../lib/book-catalog';

const fetchOriginal = globalThis.fetch;
test.afterEach(() => {globalThis.fetch = fetchOriginal;});
const rows = (offset: number, count: number) => Array.from({length: count}, (_, i) => ({id: `chapter-${offset + i}`, title: `章节 ${offset + i}`, chapter_number: offset + i + 1}));
const response = (offset: number, count: number, total = 10000, version = '0') => new Response(JSON.stringify({offset, total, version, activeIndex: null, rows: rows(offset, count)}));

test('a deep anchor is the first request and shared observers reuse its window', async () => {
  const calls: string[] = []; let release!: () => void; const gate = new Promise<void>(resolve => {release = resolve;});
  globalThis.fetch = async input => {calls.push(String(input)); await gate; return response(7800, 401);};
  const catalog = new BookCatalog('book', '0');
  const a = catalog.watch('chapter-8000', false), b = catalog.watch('chapter-8000', false);
  expect(calls).toHaveLength(1); expect(calls[0]).toContain('anchor=chapter-8000'); expect(calls[0]).toContain('limit=401');
  release(); await expect.poll(() => catalog.getSnapshot().indices.get('chapter-8000')).toBe(8000);
  expect(catalog.getSnapshot().rows.has(0)).toBe(false);
  a(); b(); const c = catalog.watch('chapter-8001', false); expect(calls).toHaveLength(1); c(); catalog.dispose();
});

test('a scrollbar jump cancels nearby prefetch and prioritizes the visible range', async () => {
  const calls: URL[] = []; let release!: () => void; const gate = new Promise<void>(resolve => {release = resolve;});
  globalThis.fetch = async input => {
    const url = new URL(String(input), 'http://local'); calls.push(url);
    if (url.searchParams.has('anchor')) return response(7800, 401);
    if (Number(url.searchParams.get('offset')) > 8000) await gate;
    const offset = Number(url.searchParams.get('offset')); return response(offset, Math.min(Number(url.searchParams.get('limit')), 10000 - offset));
  };
  const catalog = new BookCatalog('book', '0'), close = catalog.watch('chapter-8000', true);
  await expect.poll(() => catalog.getSnapshot().rows.has(8000)).toBe(true);
  catalog.ensureRange(8190, 8200);
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
  expect(catalogStrategy(375)).toEqual({initial: 375, batch: 256, radius: 200, background: true});
  expect(catalogStrategy(10000).initial).toBe(401);
  expect(catalogStrategy(375, {downlink: .5})).toEqual({initial: 128, batch: 128, radius: 64, background: true});
  expect(catalogStrategy(10000, {saveData: true}).background).toBe(false);
  expect(catalogStrategy(50000).background).toBe(true);
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

test('time does not expire catalogs; reopening validates only the version and edits rebuild', async () => {
  const calls: string[] = []; let version = '0';
  globalThis.fetch = async input => {
    const url = String(input); calls.push(url);
    return url.endsWith('/version') ? new Response(JSON.stringify({version})) : response(0, 12, 12, version);
  };
  const catalog = new BookCatalog('book', '0', {rows: rows(0, 12), total: 12});
  const now = Date.now;
  try {
    Date.now = () => now() + 24 * 3600_000;
    let close = catalog.watch('chapter-5', false, {}, 0, true);
    await expect.poll(() => calls.length).toBe(1);
    expect(calls[0]).toMatch(/\/catalog\/version$/);
    await expect.poll(() => catalog.getSnapshot().indices.get('chapter-5')).toBe(5);
    const snapshot = catalog.getSnapshot(); close();
    close = catalog.watch('chapter-6', false, {}, 0, true);
    await expect.poll(() => calls.length).toBe(2);
    expect(catalog.getSnapshot()).toBe(snapshot); close();
    version = '1'; close = catalog.watch('chapter-6', false, {}, 0, true);
    await expect.poll(() => catalog.getSnapshot().version).toBe('1');
    await expect.poll(() => catalog.getSnapshot().rows.size).toBe(12);
    expect(calls.filter(url => !url.endsWith('/version'))).toHaveLength(1);
    expect(catalog.getSnapshot().generation).toBe(1); close();
  } finally {Date.now = now; catalog.dispose();}
});

test('failed version checks can retry and closing cancels late refresh work', async () => {
  let fail = true, release!: () => void;
  globalThis.fetch = async () => fail ? new Response('', {status: 503}) : new Response(JSON.stringify({version: '0'}));
  const catalog = new BookCatalog('book', '0', {rows: rows(0, 12), total: 12});
  const close = catalog.watch('chapter-5', false, {}, 0, true);
  await expect.poll(() => catalog.getSnapshot().error).toContain('重试');
  fail = false; catalog.retry(); await expect.poll(() => catalog.getSnapshot().error).toBe('');
  expect(catalog.getSnapshot().rows.size).toBe(12); close();
  const gate = new Promise<void>(resolve => {release = resolve;});
  globalThis.fetch = async () => {await gate; return new Response(JSON.stringify({version: '1'}));};
  const cancel = catalog.watch('chapter-5', false, {}, 0, true);
  cancel(); release(); await new Promise(resolve => setTimeout(resolve, 0));
  expect(catalog.getSnapshot().version).toBe('0'); catalog.dispose();
});

test('an empty cached book discovers its first chapter on reopen', async () => {
  globalThis.fetch = async input => String(input).endsWith('/version') ? new Response(JSON.stringify({version: '1'})) : response(0, 1, 1, '1');
  const catalog = new BookCatalog('book', '0', {rows: [], total: 0});
  const close = catalog.watch(undefined, false, {}, 0, true);
  await expect.poll(() => catalog.getSnapshot().total).toBe(1);
  expect(catalog.getSnapshot().rows.get(0)?.id).toBe('chapter-0'); close(); catalog.dispose();
});

test('a newer chapter version supersedes an in-flight version check without stalling', async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => {release = resolve;});
  globalThis.fetch = async input => {
    if (String(input).endsWith('/version')) {await gate; return new Response(JSON.stringify({version: '0'}));}
    return response(0, 12, 12, '1');
  };
  const catalog = new BookCatalog('book', '0', {rows: rows(0, 12), total: 12});
  const first = catalog.watch('chapter-5', false, {}, 0, true);
  const second = catalog.watch('chapter-6', false, {}, 1, true);
  await expect.poll(() => catalog.getSnapshot().rows.size).toBe(12);
  release(); await new Promise(resolve => setTimeout(resolve, 0));
  expect(catalog.getSnapshot().version).toBe('1'); first(); second(); catalog.dispose();
});

test('idle open catalogs stop at the current window; scrolling buffers neighbors without filling the book', async () => {
  const calls: URL[] = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input), 'http://local'); calls.push(url);
    return url.searchParams.has('anchor') ? response(7800, 401)
      : response(Number(url.searchParams.get('offset')), Number(url.searchParams.get('limit')));
  };
  const catalog = new BookCatalog('bounded', '0'), close = catalog.watch('chapter-8000', true);
  await expect.poll(() => catalog.getSnapshot().rows.size).toBe(401);
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(calls).toHaveLength(1);
  catalog.ensureRange(8190, 8200);
  await expect.poll(() => catalog.getSnapshot().rows.has(8400)).toBe(true);
  expect(catalog.getSnapshot().rows.size).toBe(601);
  const count = calls.length; await new Promise(resolve => setTimeout(resolve, 30));
  expect(calls).toHaveLength(count); expect(catalog.getSnapshot().rows.has(0)).toBe(false);
  close(); catalog.dispose();
});

test('prefetch failures preserve readable rows and a later visible request can recover', async () => {
  let fail = true, calls = 0;
  globalThis.fetch = async input => {
    const url = new URL(String(input), 'http://local'); calls++;
    if (url.searchParams.has('anchor')) return response(7800, 401);
    return fail ? new Response('', {status: 503}) : response(Number(url.searchParams.get('offset')), Number(url.searchParams.get('limit')));
  };
  const catalog = new BookCatalog('recover', '0'), close = catalog.watch('chapter-8000', true);
  await expect.poll(() => catalog.getSnapshot().rows.has(8000)).toBe(true);
  catalog.ensureRange(8190, 8200);
  await expect.poll(() => calls).toBe(2);
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(catalog.getSnapshot().error).toBe(''); expect(catalog.getSnapshot().rows.has(8000)).toBe(true);
  fail = false; catalog.ensureRange(8300, 8320);
  await expect.poll(() => catalog.getSnapshot().rows.has(8300)).toBe(true);
  expect(catalog.getSnapshot().error).toBe(''); close(); catalog.dispose();
});

test('closing the last observer cancels pending title downloads and ignores late responses', async () => {
  let release!: () => void, signal: AbortSignal | null | undefined;
  const gate = new Promise<void>(resolve => {release = resolve;});
  globalThis.fetch = async (_input, init) => {signal = init?.signal; await gate; return response(7800, 401);};
  const catalog = new BookCatalog('closed', '0'), close = catalog.watch('chapter-8000', true);
  close(); expect(signal?.aborted).toBe(true); release();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(catalog.getSnapshot().rows.size).toBe(0); catalog.dispose();
});

test('two visible volumes separated by a collapsed volume both load, without downloading the gap', async () => {
  const calls: URL[] = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input), 'http://local'); calls.push(url);
    await new Promise(resolve => setTimeout(resolve, 10));
    return url.searchParams.has('anchor') ? response(4800, 401)
      : response(Number(url.searchParams.get('offset')), Number(url.searchParams.get('limit')));
  };
  const catalog = new BookCatalog('folded', '0'), close = catalog.watch('chapter-5000', true);
  await expect.poll(() => catalog.getSnapshot().rows.has(5000)).toBe(true);
  catalog.ensureRanges([{start: 1000, end: 1010}, {start: 9000, end: 9010}]);
  await expect.poll(() => catalog.getSnapshot().rows.has(1000) && catalog.getSnapshot().rows.has(9000)).toBe(true);
  await expect.poll(() => catalog.getSnapshot().rows.has(800) && catalog.getSnapshot().rows.has(9210)).toBe(true);
  expect(catalog.getSnapshot().rows.has(6000)).toBe(false);
  expect(catalog.getSnapshot().rows.size).toBeLessThan(1300);
  close(); catalog.dispose();
});
