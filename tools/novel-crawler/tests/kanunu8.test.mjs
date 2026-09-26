import '../../test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import iconv from 'iconv-lite';
import {loadSites, specForBook} from '../desktop/sources.mjs';
import {getCatalog, getChapter} from '../adapters.mjs';
import {hash} from '../storage.mjs';

for (const layout of ['modern', 'legacy-heading', 'legacy-font']) test(`kanunu8 ${layout} pages preserve chapter order and exclude recommendations`, async () => {
  const old = layout !== 'modern';
  const site = loadSites().sites.find(site => site.id === 'kanunu8');
  const url = old ? 'https://www.kanunu8.com/files/old/2011/123.html' : 'https://www.kanunu8.com/book6/story/index.html';
  const chapterUrl = new URL(old ? '123/456.html' : '456.html', url).href;
  const spec = specForBook({url, title: '山间故事', author: '甲作者'});
  const entry = `<a href="${chapterUrl}">第一回 山间来客</a>`;
  const detail = old
    ? `<table><tr><td><h2><b>山间故事</b></h2></td></tr><tr><td height="30" class="l15">来源：　作者：甲作者 发布时间：2011-04-02</td></tr></table><table bgcolor="#D4D0C8"><tr><td>${entry}</td></tr></table>`
    : `<div class="catalog"><h1>山间故事</h1><div class="info">作者：甲作者</div><div class="intro">一段山间往事。</div></div><div class="mulu-list">${entry}<a href=""></a></div>`;
  const heading = layout === 'legacy-font' ? '<table><tr><td height="60"><strong><font color="#dc143c" size="4">第一回 山间来客</font></strong></td></tr></table>' : old ? '<h2><font color="#dc143c">第一回 山间来客</font></h2>' : '<div class="path"><div class="crumb">书坊 &gt; 山间故事 &gt; 正文 第一回 山间来客</div></div>';
  const prose = '<p>山间有一条小路。<br>客人沿河而来。</p><script>广告代码</script><iframe>广告</iframe>';
  const body = old ? `<table><tr><td width="820" align="left">${prose}</td></tr></table>` : `<div id="neirong">${prose}</div>`;
  const pages = new Map([[url, `${detail}<div class="common-list1"><a href="/book6/other/">推荐书</a></div>`], [chapterUrl, heading + body + '<div class="book-nav"><a href="457.html">下一章</a></div>']]);
  const client = {assertUrl: value => value, get: async value => {
    assert.ok(pages.has(value), 'must not follow another chapter or recommendation');
    const bytes = iconv.encode(pages.get(value), 'gb18030');
    return {url: value, body: bytes, hash: hash(bytes), contentType: 'text/html', fetchedAt: '2026-09-26T00:00:00Z'};
  }};
  const source = await getCatalog(spec, client);
  assert.deepEqual(source.actual.title, '山间故事');
  assert.equal(source.actual.author, '甲作者');
  assert.equal(source.catalog.length, 1);
  const chapter = await getChapter(spec, source.catalog[0], new Set([chapterUrl]), client);
  assert.equal(chapter.title, '第一回 山间来客');
  assert.equal(chapter.content, '山间有一条小路。\n客人沿河而来。');
  await assert.rejects(getCatalog({...spec, author: '乙作者'}, client), /身份不匹配/);
  assert.equal(site.search, undefined, 'only reviewed detail pages are supported');
  assert.throws(() => specForBook({url: chapterUrl, title: '山间故事', author: '甲作者'}), /详情页/);
});
