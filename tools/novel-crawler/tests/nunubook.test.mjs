import '../../test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {loadSites, searchBooks, parseSearch, specForBook} from '../desktop/sources.mjs';
import {getChapter} from '../adapters.mjs';
import {hash} from '../storage.mjs';

test('nunubook searches POST fields once, follows redirects with GET, and ignores movie results', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-nunu-search-'));
  t.after(() => {
    assert.ok(path.isAbsolute(dir) && dir.startsWith(os.tmpdir() + path.sep) && path.basename(dir).startsWith('novel-nunu-search-'));
    fs.rmSync(dir, {recursive: true, force: true});
  });
  const source = loadSites().sites.find(site => site.id === 'nunubook');
  const row = (title, kind, author, url) => `<a href="${url}"><div class="book-base-info"><h3 class="book-title"><span class="title">${title}</span><span class="book-search-count">${kind}</span></h3><h5 class="book-author">作者:${author}</h5></div></a>`;
  const events = [];
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const part of req) body += part;
    events.push({url: req.url, method: req.method, body});
    if (req.url === '/search') { res.writeHead(303, {Location: '/results'}); res.end(); }
    else if (req.url === '/results') res.end(row('旧故事', '小说', '乙作者', '/wuxia/other/') + row('山间 & 故事', '电视剧', '', '/dianshiju/movie/') + '<a href="/results?page=2">下一页</a>');
    else res.end(row('山间 &amp; 故事', '小说', '甲作者', '/wuxia/story/'));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const site = {...source, hosts: [...source.hosts, '127.0.0.1'], search: {...source.search, url: base + '/search'}, spec: {...source.spec, delayMs: 1}};
  const result = await searchBooks({website: source.home, title: '山间 & 故事', author: '甲作者', stateDir: dir, sites: [site]});
  assert.deepEqual(result.map(book => [book.title, book.author, book.url]), [['山间 & 故事', '甲作者', base + '/wuxia/story/']]);
  assert.deepEqual(events.map(event => event.method), ['POST', 'GET', 'GET']);
  assert.equal(new URLSearchParams(events[0].body).get('keyboard'), '山间 & 故事');
  assert.ok(events.slice(1).every(event => event.body === ''));
  assert.equal(parseSearch(row('同名', '电视剧', '', '/dianshiju/movie/'), source.home, source).results.length, 0);
});

test('nunubook preserves nested poetry and excludes navigation captured by malformed markup', async () => {
  const url = 'https://www.nunubook.com/guoxueguji/7154/';
  const spec = specForBook({url, title: '山间故事', author: '甲作者'});
  const chapterUrl = new URL('288508.html', url).href;
  const html = '<h1 id="title">第一回 山间来客</h1><div id="text"><div class="poetry">第一段诗句。<div class="poetry">第二段正文。<div id="bottomBar">上一章 目录 下一章</div><div id="sub_nav">设置 字号 20 小 大 主题</div>';
  const client = {assertUrl: value => value, get: async value => {
    assert.equal(value, chapterUrl);
    const body = Buffer.from(html);
    return {url: value, body, hash: hash(body), contentType: 'text/html; charset=utf-8', fetchedAt: '2026-09-26T00:00:00Z'};
  }};
  const chapter = await getChapter(spec, {title: '第一回 山间来客', link: chapterUrl, chapter_number: 1}, new Set([chapterUrl]), client);
  assert.equal(chapter.content, '第一段诗句。\n第二段正文。');
});
