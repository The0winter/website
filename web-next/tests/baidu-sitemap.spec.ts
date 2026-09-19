import {test, expect} from '@playwright/test';
import {splitBaiduEntries, baiduXmlResponse, cacheBaiduFiles} from '../lib/baidu-sitemap';
import {GET as getRoot} from '../app/sitemap-baidu.xml/route';
import {GET as getManifest} from '../app/sitemap-baidu.json/route';
import {GET as getPart} from '../app/sitemaps/baidu/[page]/route';

const base = 'https://jiutianxiaoshuo.com';
const entry = (n: number) => `<url><loc>${base}/book/${n.toString(16).padStart(24, '0')}</loc></url>`;

test('50,001 URLs split without losing or duplicating the boundary entry', async () => {
  const rows = Array.from({length: 50001}, (_, n) => entry(n));
  const files = splitBaiduEntries(rows);
  expect(files.map(file => file.urls)).toEqual([50000, 1]);
  const result = (await Promise.all(files.map(file => baiduXmlResponse(file, base).text())));
  expect(result.flatMap(xml => [...xml.matchAll(/<url>.*?<\/url>/g)].map(match => match[0]))).toEqual(rows);
  files.forEach((file, index) => expect(file.bytes).toBe(Buffer.byteLength(result[index])));
});

test('UTF-8 byte limits split before count limit, including XML envelope', async () => {
  const row = '<url><loc>https://example.com/中文书籍</loc></url>';
  const single = splitBaiduEntries([row])[0];
  const files = splitBaiduEntries([row, row, row], {urls: 50000, bytes: single.bytes + Buffer.byteLength(row)});
  expect(files.map(file => file.urls)).toEqual([2, 1]);
  expect(() => splitBaiduEntries([row], {urls: 50000, bytes: single.bytes - 1})).toThrow('byte limit');
  expect(() => splitBaiduEntries([])).toThrow('Empty sitemap');
});

test('overlapping requests share complete generations; refresh errors retry instead of serving partial data', async () => {
  let time = 0, calls = 0, fail = false;
  const files = splitBaiduEntries([entry(1)]);
  const read = cacheBaiduFiles(async () => {calls++; if (fail) throw new Error('upstream'); return files;}, 300, () => time);
  expect(await Promise.all([read(), read()])).toEqual([files, files]);
  expect(calls).toBe(1);
  time = 301; fail = true;
  await expect(read()).rejects.toThrow('upstream');
  fail = false;
  expect(await read()).toEqual(files);
  expect(calls).toBe(3);
});

test('real routes agree on coverage, reject invalid pages and fail closed on unavailable sources', async () => {
  const previousFetch = globalThis.fetch;
  const previousSite = process.env.NEXT_PUBLIC_SITE_URL, previousApi = process.env.INTERNAL_API_URL;
  const state = globalThis as typeof globalThis & {baiduSitemapFiles?: unknown};
  const id = '111111111111111111111111', author = '222222222222222222222222';
  let fail = false;
  try {
    process.env.NEXT_PUBLIC_SITE_URL = base; process.env.INTERNAL_API_URL = 'http://127.0.0.1:5000/api';
    delete state.baiduSitemapFiles;
    globalThis.fetch = async input => {
      const url = new URL(String(input));
      if (fail) return new Response('', {status: 503});
      if (url.pathname.endsWith('/sitemap-books')) return Response.json([{_id: id, chapters: 1}]);
      if (url.pathname.endsWith('/chapters')) return Response.json([{id: author}]);
      if (url.pathname.endsWith('/books')) return Response.json([{author_profile_id: author}]);
      throw new Error('Unexpected source ' + url.pathname);
    };
    const manifest = await (await getManifest()).json();
    const response = await getRoot(), xml = await response.text();
    expect(response.status).toBe(200);
    expect(manifest.urls).toBe(6);
    expect(manifest.files).toEqual([{url: base + '/sitemap-baidu.xml', urls: 6, bytes: Buffer.byteLength(xml)}]);
    expect(xml).toContain(`${base}/book/${id}/${author}`);
    expect(xml).toContain(`${base}/author/${author}`);
    for (const page of ['0.xml', '1.xml', '2.xml', '01.xml', 'invalid.xml', '9007199254740993.xml']) {
      expect((await getPart(new Request(base), {params: Promise.resolve({page})})).status).toBe(404);
    }
    fail = true; delete state.baiduSitemapFiles;
    const unavailable = await getRoot();
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get('retry-after')).toBe('60');
    fail = false;
    expect((await getRoot()).status).toBe(200);
    // Exercise the numbered route with a real multi-part source, not just the
    // pure splitter: preserve chapter boundaries and reject truncated sources.
    delete state.baiduSitemapFiles;
    globalThis.fetch = async input => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/sitemap-books')) return Response.json([{_id: id, chapters: 50001}]);
      if (url.pathname.endsWith('/books')) return Response.json([]);
      const page = Number(url.searchParams.get('page'));
      const first = (page - 1) * 200;
      if (fail && page === 100) return new Response('', {status: 503});
      return Response.json(Array.from({length: Math.max(0, Math.min(200, 50001 - first))}, (_, n) => ({id: (first + n + 1).toString(16).padStart(24, '0')})));
    };
    const expanded = await (await getManifest()).json();
    expect(expanded.files.map((file: {urls: number}) => file.urls)).toEqual([50000, 5]);
    const second = await getPart(new Request(base), {params: Promise.resolve({page: '2.xml'})});
    expect(second.status).toBe(200);
    expect((await second.text()).match(/<url>/g)).toHaveLength(5);
    delete state.baiduSitemapFiles; fail = true;
    expect((await getManifest()).status).toBe(503);
  } finally {
    globalThis.fetch = previousFetch; delete state.baiduSitemapFiles;
    if (previousSite === undefined) delete process.env.NEXT_PUBLIC_SITE_URL; else process.env.NEXT_PUBLIC_SITE_URL = previousSite;
    if (previousApi === undefined) delete process.env.INTERNAL_API_URL; else process.env.INTERNAL_API_URL = previousApi;
  }
});
