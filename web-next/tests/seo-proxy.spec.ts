import {test, expect} from '@playwright/test';
import {NextRequest} from 'next/server';
import {proxy} from '../proxy';

const book = '111111111111111111111111';
const chapter = '222222222222222222222222';
const realFetch = globalThis.fetch;
const originalApi = process.env.INTERNAL_API_URL;
test.beforeEach(() => {process.env.INTERNAL_API_URL = 'http://127.0.0.1:5000/api';});
test.afterEach(() => {globalThis.fetch = realFetch; if (originalApi === undefined) delete process.env.INTERNAL_API_URL; else process.env.INTERNAL_API_URL = originalApi;});

test('missing documents return 404 before streaming, and outages remain retryable', async () => {
  for (const backendStatus of [404, 429, 500, 503]) {
    globalThis.fetch = async () => new Response('{}', {status: backendStatus});
    for (const path of [`/book/${book}`, `/author/${book}`, `/forum/${book}`, `/forum/question/${book}`]) {
      const response = await proxy(new NextRequest('https://jiutianxiaoshuo.com' + path));
      expect(response.status).toBe(backendStatus === 404 ? 404 : 503);
      expect(response.headers.get('x-robots-tag')).toBe('noindex');
      if (backendStatus !== 404) expect(response.headers.get('retry-after')).toBe('60');
    }
  }
});

test('chapter belongs to the requested book; only catalog metadata is fetched', async () => {
  let active: number | null = null;
  globalThis.fetch = async input => {
    expect(String(input)).toBe(`http://127.0.0.1:5000/api/books/${book}/catalog?anchor=${chapter}&limit=1`);
    return Response.json({activeIndex: active, rows: [{id: chapter}]});
  };
  const request = new NextRequest(`https://jiutianxiaoshuo.com/book/${book}/${chapter}`);
  expect((await proxy(request)).status).toBe(404);
  active = 0;
  expect((await proxy(request)).headers.get('x-middleware-next')).toBe('1');
});

test('malformed IDs are 404; SPA navigation and compose page need no extra lookup', async () => {
  globalThis.fetch = async () => {throw new Error('Unexpected API call');};
  for (const path of ['/book/invalid', '/author/invalid', '/forum/invalid']) expect((await proxy(new NextRequest('https://jiutianxiaoshuo.com' + path))).status).toBe(404);
  expect((await proxy(new NextRequest(`https://jiutianxiaoshuo.com/book/${book}`, {headers: {rsc: '1'}}))).headers.get('x-middleware-next')).toBe('1');
  expect((await proxy(new NextRequest('https://jiutianxiaoshuo.com/forum/create'))).headers.get('x-middleware-next')).toBe('1');
  expect((await proxy(new NextRequest(`https://jiutianxiaoshuo.com/book/${book}`))).status).toBe(503);
});
