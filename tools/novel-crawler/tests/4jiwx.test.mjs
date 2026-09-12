import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {load} from 'cheerio';
import {loadSites, parseSearch, specForBook} from '../desktop/sources.mjs';
import {getCatalog, getChapter, cleanHtml} from '../adapters.mjs';
import {validateSpec} from '../core.mjs';
import {makeClient} from '../http.mjs';
import {createDesktop} from '../desktop/server.mjs';

const site = loadSites().sites.find(s => s.id === '4jiwx');
const watermark = '「得」「奇」「小」「说」「网」「首」「发」「d」「e」「q」「i」「x」「s」「.」「」';
const card = (url, author) => `<div class="book-card" onclick="window.open('?action=go&t=${Buffer.from(url).toString('base64')}', '_blank')"><h3 class="book-card__title">测试书</h3><div><span class="book-card__meta-item">作者：${author}</span><span class="book-card__meta-item">分类：测试</span></div></div>`;

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-4jiwx-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('novel-4jiwx-'));
    fs.rmSync(dir, {recursive: true, force: true});
  });
  return dir;
}

test('4jiwx pairs search cards and validates decoded destinations without executing onclick', () => {
  const html = `<div id="resultContainer"><div class="book-list">${card(site.home + 'book/A1.html', '甲作者')}${card(site.home + 'book/B2Z.html', '乙作者')}</div></div>${card(site.home + 'book/HOT.html', '推荐作者')}`;
  const result = parseSearch(html, site.search.url, site);
  assert.deepEqual(result.results.map(b => [b.author, b.url]), [['甲作者', site.home + 'book/A1.html'], ['乙作者', site.home + 'book/B2Z.html']]);
  assert.deepEqual(parseSearch('<div id="resultContainer">无结果</div>', site.search.url, site).results, []);
  for (const url of ['https://foreign.example/book/A1.html', site.home + 'book/A1-1.html', 'file:///tmp/unsafe']) {
    assert.throws(() => parseSearch(`<div id="resultContainer"><div class="book-list">${card(url, '甲作者')}</div></div>`, site.search.url, site));
  }
});

test('4jiwx removes complete noise signatures repeatedly while preserving surrounding prose and quotes', () => {
  const rule = site.spec.chapter;
  const html = `<article><p>前文${watermark}后文。</p><p>&lt;img src=\\ 第一段。</p><p>「得」和「奇」分别出现，正常保留。</p><p>小说网首发、deqixs. 和普通的 src= 也保留。</p><p>${watermark.split('」「').join('」\n「')}</p><p>第二段&lt;img src=\\ 结尾。<img src="/ad.jpg"></p></article>`;
  assert.equal(cleanHtml(load(html), 'article', rule.remove, rule.removeText), '前文后文。\n第一段。\n「得」和「奇」分别出现，正常保留。\n小说网首发、deqixs. 和普通的 src= 也保留。\n第二段结尾。');
  assert.ok(cleanHtml(load(html), 'article').includes(watermark)); // Other sources are unchanged.
  const spec = specForBook({url: site.home + 'book/A1.html', title: '测试书', author: '甲作者'});
  for (const removeText of ['wrong', [''], ['.*'], ['[']]) assert.throws(() => validateSpec({...spec, chapter: {...spec.chapter, removeText}}));
});

test('4jiwx preserves catalog order across volume numbering and joins only pages of the same chapter', async () => {
  for (const id of ['A1', 'B2Z']) {
    const url = site.home + `book/${id}.html`;
    const spec = specForBook({url, title: '测试书', author: '甲作者'});
    const link = n => site.home + `book/${id}-${n}.html`;
    const metadata = '<meta property="og:novel:book_name" content="测试书"><meta property="og:novel:author" content="甲作者"><div class="bookDetail"><div class="txtb"><dl><dt>总章节：</dt><dd>2章</dd></dl></div></div>';
    const pages = new Map([
      [url, metadata + `<div class="chapBox"><div class="direList"><ul><li><div class="name"><a href="/book/${id}-2.html">第一章 夏</a></div></li></ul></div></div><div class="chapter_list"><ul><li><div class="name"><a href="/book/${id}-1.html">第九章 春</a></div></li><li><div class="name"><a href="/book/${id}-2.html">第一章 夏</a></div></li><li><div class="name"><a href="/book/OTHER-1.html">别的书</a></div></li></ul></div>`],
      [link(1), `<div class="conBox"><div class="conC"><h1>第九章 春</h1><div class="content"><p>首段${watermark}正文。</p></div></div><div class="readPage"><a href="${url}">目录</a><a href="/book/${id}-1-2.html">下一页</a></div></div>`],
      [link('1-2'), `<div class="conBox"><div class="conC"><h1>第九章 春</h1><div class="content"><p>&lt;img src=\\ 尾段正文。</p></div></div><div class="readPage"><a href="${url}">目录</a><a href="/book/${id}-2.html">下一章</a></div></div>`],
    ]);
    const requests = [];
    const client = {
      assertUrl(value) { assert.equal(new URL(value).hostname, 'www.4jiwx.com'); return value; },
      async get(value, options) {
        requests.push(value);
        if (value === url) assert.deepEqual(options.selectPages, spec.catalog.selectPages);
        assert.ok(pages.has(value));
        return {url: value, body: Buffer.from(pages.get(value)), contentType: 'text/html; charset=utf-8', hash: 'synthetic', fetchedAt: '2026-09-12T00:00:00Z'};
      },
    };
    const {catalog} = await getCatalog(spec, client);
    assert.deepEqual(catalog.map(c => [c.title, c.chapter_number]), [['第九章 春', 1], ['第一章 夏', 2]]);
    const chapter = await getChapter(spec, catalog[0], new Set(catalog.map(c => c.link)), client);
    assert.equal(chapter.content, '首段正文。\n尾段正文。');
    assert.equal(chapter.provenance.length, 2);
    assert.deepEqual(requests, [url, link(1), link('1-2')]);
    await assert.rejects(getCatalog({...spec, author: '乙作者'}, client), /身份不匹配/);
    pages.set(url, pages.get(url).replace('2章</dd>', '1章</dd>'));
    await assert.rejects(getCatalog(spec, client), /目录数量/);
    pages.set(link('1-2'), pages.get(link('1-2')).replace('下一章', '下一页'));
    await assert.rejects(getChapter(spec, catalog[0], new Set(catalog.map(c => c.link)), client), /另一章/);
  }
});

test('browser search submits the normal form; select pagination waits for actual content and records every page', async t => {
  const dir = temp(t), submissions = [];
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (req.url === '/search') return res.end(`<form action="/results" method="post" onsubmit="document.querySelector('#signature').value='from-handler'"><input id="keyword" name="keyword"><input id="signature" name="signature" type="hidden"><button id="submit">搜索</button></form>`);
    if (req.url === '/results') {
      let body = ''; req.on('data', data => body += data); req.on('end', () => { submissions.push(Object.fromEntries(new URLSearchParams(body))); res.end('<div id="results">搜索完成</div>'); }); return;
    }
    if (req.url === '/catalog') {
      if (req.headers['if-none-match']) { res.statusCode = 304; return res.end(); }
      res.setHeader('ETag', '"catalog-v1"');
      return res.end(`<h1>目录</h1><select id="pages" onchange="setTimeout(()=>document.querySelector('#list').innerHTML='<a href=/c'+this.value+'>第'+this.value+'章</a>',100)"><option value="1">第一页</option><option value="2">第二页</option><option value="3">第三页</option></select><div id="list"><a href="/c1">第1章</a></div>`);
    }
    if (req.url === '/stale') return res.end('<select id="pages"><option value="1">1</option><option value="2">2</option></select><div id="list"><a href="/c1">第1章</a></div>');
    if (req.url === '/denied') return res.end('<select id="pages" onchange="fetch(\'/catalog-api\')"><option value="1">1</option><option value="2">2</option></select><div id="list"><a href="/c1">第1章</a></div>');
    if (req.url === '/catalog-api') { res.statusCode = 403; return res.end('Forbidden'); }
    res.end('<div>其他</div>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = makeClient({cacheDir: path.join(dir, 'cache'), allowedHosts: ['127.0.0.1'], delayMs: 200, timeoutMs: 2000, browser: {headless: true}});
  t.after(async () => { await client.close(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const form = {input: '#keyword', submit: '#submit', value: '春天 & 秋天'};
  const result = await client.get(base + '/search', {render: true, readySelector: '#results', searchForm: form});
  assert.equal(result.url, base + '/results');
  assert.deepEqual(submissions, [{keyword: '春天 & 秋天', signature: 'from-handler'}]);
  await client.get(base + '/search', {render: true, readySelector: '#results', searchForm: {...form, value: '另一部书'}});
  assert.equal(submissions.length, 2); // Search terms must not share a cached response.
  const selectPages = {selector: '#pages', content: '#list', maxPages: 3};
  const catalog = await client.get(base + '/catalog', {render: true, selectPages});
  assert.deepEqual(load(catalog.body.toString())('#list a').map((i, e) => e.attribs.href).get(), ['/c1', '/c2', '/c3']);
  assert.deepEqual(catalog.browserPages.map(p => p.value), ['1', '2', '3']);
  assert.equal((await client.get(base + '/catalog', {fresh: true, render: true, selectPages})).browserPages.length, 3);
  await assert.rejects(client.get(base + '/catalog', {render: true, selectPages: {...selectPages, maxPages: 2}}), /超过上限/);
  await assert.rejects(client.get(base + '/stale', {render: true, selectPages}), /没有更新/);
  await assert.rejects(client.get(base + '/denied', {render: true, selectPages: {...selectPages, responseUrl: '/catalog-api'}}), /HTTP 403/);
  await assert.rejects(client.get(base + '/catalog', {selectPages}), /DOM 模式/);
});

test('4jiwx appears in the desktop source list without a hardcoded UI entry', async t => {
  const app = await createDesktop({stateDir: temp(t), openDirectory: async () => {}});
  t.after(() => app.close());
  const response = await fetch(app.baseUrl + '/api/state', {headers: {'x-desktop-token': app.token}});
  const state = await response.json();
  assert.ok(state.sites.some(s => s.id === '4jiwx' && s.home === site.home));
});
