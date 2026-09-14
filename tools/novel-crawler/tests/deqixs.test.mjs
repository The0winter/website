import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {loadSites, specForBook, parseSearch} from '../desktop/sources.mjs';
import {getCatalog, getChapter} from '../adapters.mjs';

test('deqixs keeps full catalogs, strips page counters and stops at the next chapter', async () => {
  const loaded = loadSites(), site = loaded.sites.find(s => s.id === 'deqixs');
  assert.deepEqual(loaded.errors, []); assert.equal(site.name, '得奇小说网');
  assert.equal(site.spec.browser.headless, true); assert.equal(site.search.delayMs, 5500);
  for (const id of ['128', '9041']) {
    const url = `${site.home}${id}/`, title = `测试${id}`, spec = specForBook({url, title, author: '测试作者'});
    const link = n => `${url}${n}.html`, requests = [];
    const pages = new Map([
      [url, `<div class="container"><div class="item"><div class="itemtxt"><h1><a>${title}</a>最新章节</h1><p><span>连载中</span><span>玄幻小说</span></p><p><a href="/modules/article/authorarticle.php?author=test">作者：测试作者</a></p><ul><li><a href="${link(2)}">最新章节，勿重复采集</a></li></ul></div></div><div class="des">作品简介。</div><div id="list"><ul><li><a href="${link(1)}">第三百九十四章 真君口谕</a></li><li><a href="${link(2)}">第三百九十五章 继续（上）</a></li></ul></div><div id="pages"><ul><a class="gr" href="#">下一页</a></ul></div><div class="des">网站说明，勿混入简介。</div></div>`],
      [link(1), `<h1><a>${title}</a> &gt; 第三百九十四章 真君口谕（1 / 2）</h1><div class="container"><div class="con">第一页正文。<br>他说：“现在是12:30。”<script>无关脚本</script></div><div class="prenext"><a href="${url}1_2.html">下一页</a></div></div>`],
      [url + '1_2.html', `<h1><a>${title}</a> &gt; 第三百九十四章 真君口谕（2 / 2）</h1><div class="container"><div class="con">第二页正文。<br>(本章完)</div><div class="prenext"><a href="${link(2)}">下一章</a></div></div>`],
      [link(2), `<h1><a>${title}</a> &gt; 第三百九十五章 继续（上）</h1><div class="container"><div class="con">单页正文。</div></div>`]
    ]);
    const client = {assertUrl(value) { assert.equal(new URL(value).hostname, 'www.deqixs.org'); return value; }, async get(value) { requests.push(value); assert.ok(pages.has(value), value); return {url: value, body: Buffer.from(pages.get(value)), contentType: 'text/html; charset=utf-8'}; }};
    const result = await getCatalog(spec, client), links = new Set(result.catalog.map(c => c.link));
    assert.equal(result.catalog.length, 2); assert.equal(result.actual.description, '作品简介。'); assert.equal(result.actual.status, '连载');
    const chapter = await getChapter(spec, result.catalog[0], links, client);
    assert.equal(chapter.title, '第三百九十四章 真君口谕');
    assert.equal(chapter.content, '第一页正文。\n他说：“现在是12:30。”\n第二页正文。');
    assert.equal(chapter.provenance.length, 2); assert.deepEqual(requests, [url, link(1), url + '1_2.html']);
    assert.equal((await getChapter(spec, result.catalog[1], links, client)).title, '第三百九十五章 继续（上）');
    pages.set(url + '1_2.html', pages.get(url + '1_2.html').replace('下一章', '下一页'));
    await assert.rejects(getChapter(spec, result.catalog[0], links, client), /另一章/);
    await assert.rejects(getCatalog({...spec, author: '其他作者'}, client), /身份不匹配/);
    assert.throws(() => specForBook({url: link(1), title, author: '测试作者'}), /不是章节/);
  }
});

test('deqixs search reads matching title and author together and accepts detail redirects', () => {
  const site = loadSites().sites.find(s => s.id === 'deqixs');
  const card = (id, author) => `<div class="item"><div class="itemtxt"><h3><a href="/${id}/">测试书</a></h3><p><a href="/modules/article/authorarticle.php?author=${author}">作者：${author}</a></p></div></div>`;
  const html = `<div class="container"><div class="content book">${card('12', '甲作者')}${card('99', '乙作者')}</div></div>`;
  assert.deepEqual(parseSearch(html, site.home, site).results.map(b => [b.author, b.url]), [['甲作者', site.home + '12/'], ['乙作者', site.home + '99/']]);
  assert.throws(() => parseSearch(html.replace('/12/', 'https://foreign.example/12/'), site.home, site), /详情页/);
  const redirect = parseSearch('<div class="itemtxt"><h1><a>测试书</a></h1><a href="/modules/article/authorarticle.php?author=test">作者：甲作者</a></div>', site.home + '12/', site);
  assert.equal(redirect.results[0].title, '测试书'); assert.equal(redirect.results[0].author, '甲作者');
  assert.deepEqual(parseSearch('<div class="container"><div class="content book"></div></div>', site.search.url, site).results, []);
});

test('site search delay rejects invalid values when loading adapters', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deqixs-sites-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const site = loadSites().sites.find(s => s.id === 'deqixs');
  for (const delayMs of ['5500', -1, 100, 60001]) {
    fs.writeFileSync(path.join(dir, 'site.json'), JSON.stringify({...site, search: {...site.search, delayMs}}));
    const result = loadSites(dir); assert.equal(result.sites.length, 0); assert.match(result.errors[0], /search.delayMs/);
  }
});
