import '../../test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadSites, parseSearch, specForBook} from '../desktop/sources.mjs';
import {getCatalog, getChapter} from '../adapters.mjs';

const loaded = loadSites();
const site = loaded.sites.find(s => s.id === 'diyibanzhu');
const home = 'https://m.diyibanzhu.click/';
const card = (id, author) => `<li class="column-2"><div class="right"><a class="name" href="/list/${id}.html">测试作品</a><p class="update"><a href="/view/999.html">最新章节</a></p><p class="info">作者：${author}<span class="words">字数：10000</span></p></div></li>`;
const detail = `<div class="right"><h1>测试作品</h1><p class="info">作者：甲作者<br>类型：玄幻奇幻<br>字数：10000<br>人气：0</p><span class="status is-serialize">连载中••</span></div><div class="book-intro"><div class="bd">合成作品简介</div></div>`;
const catalog = (label, rows) => `<div class="chapter-list"><div class="hd"><h4>测试作品${label}</h4></div><div class="bd"><ul class="list">${rows.map(([id,title])=>`<li><a href="/view/${id}.html">${title}</a> 09-23</li>`).join('')}</ul></div></div>`;
function clientFor(pages) {
  const requests = [];
  return {requests, assertUrl(url) { assert.equal(new URL(url).hostname, new URL(home).hostname); return url; }, async get(url) { requests.push(url); assert.ok(Object.hasOwn(pages, url), `Unexpected request: ${url}`); return {url, body:Buffer.from(pages[url]), contentType:'text/html; charset=utf-8', hash:'fixture', fetchedAt:'2026-09-23T00:00:00Z'}; }};
}

test('diyibanzhu loads independently and pairs search cards with authors and numbered next pages', () => {
  assert.deepEqual(loaded.errors, []);
  assert.ok(site);
  assert.ok(loaded.sites.some(s => s.id === 'banshanren'));
  const html = `<ul>${card('100','甲作者')}${card('200','乙作者')}</ul><div class="pagelistbox"><a href="/search_top_test_50_1.html">1</a><strong>2</strong><a href="/search_top_test_50_3.html">3</a><a class="endPage" href="/search_top_test_50_9.html">末页</a></div>`;
  const result = parseSearch(html, home+'wap.php?action=search', site);
  assert.deepEqual(result.results.map(b => [b.title,b.author,b.url]), [['测试作品','甲作者',home+'list/100.html'],['测试作品','乙作者',home+'list/200.html']]);
  assert.equal(result.next, home+'search_top_test_50_3.html');
  assert.deepEqual(parseSearch('<h1>没有结果</h1>',home+'wap.php?action=search',site), {results:[], next:null});
  assert.equal(parseSearch('<div class="pagelistbox"><a href="/search_top_test_50_8.html">8</a><strong>9</strong></div>',home+'wap.php?action=search',site).next, null);
  assert.throws(() => parseSearch(card('100','甲作者').replace('/list/100.html','https://other.example/list/100.html'),home,site),/详情页/);
  assert.equal(site.spec.browser.responseMode,'dom');
  assert.equal(site.search.form.input,"form.search-form input[name='wd']");
});

test('diyibanzhu reads the full paginated catalog, excluding reverse latest chapters and recommendations', async () => {
  for (const id of ['100','200']) {
    const url = home+`list/${id}.html`, next=home+`list/${id}_3_2.html`;
    const spec=specForBook({url,title:'测试作品',author:'甲作者'},[site]);
    const client=clientFor({[url]:detail+catalog('最新章节',[[13,'第三章']])+catalog('章节列表',[[11,'第一章'],[12,'第二章']])+`<div class="pagelistbox"><a class="nextPage" href="/list/${id}_3_2.html">下页</a></div><a href="/list/999.html">推荐</a>`, [next]:detail+catalog('章节列表',[[13,'第三章']])+`<div class="pagelistbox"><a class="indexPage" href="/list/${id}.html">首页</a><strong>2</strong></div>`});
    const result=await getCatalog(spec,client);
    assert.equal(result.actual.author,'甲作者');
    assert.equal(result.actual.status,'连载');
    assert.equal(result.actual.description,'合成作品简介');
    assert.equal(result.pages,2);
    assert.deepEqual(result.catalog.map(c=>[c.title,c.link]),[['第一章',home+'view/11.html'],['第二章',home+'view/12.html'],['第三章',home+'view/13.html']]);
    assert.deepEqual(client.requests,[url,next]);
  }
  for (const url of [home+'view/11.html',home+'list/100_30_2.html']) assert.throws(()=>specForBook({url,title:'测试作品',author:'甲作者'},[site]),/不是章节/);
});

test('diyibanzhu follows numbered chapter pages without joining the next chapter or saving pagination notices', async () => {
  const spec=specForBook({url:home+'list/100.html',title:'测试作品',author:'甲作者'},[site]);
  const first=home+'view/11.html',second=home+'view/11_2.html',next=home+'view/12.html';
  const html=(content,pager,notice='')=>`<h1 class="page-title">第一章</h1><div class="page-content"><p id="announceinfo">站点公告</p><div id="nr1">${content}${notice}<center class="chapterPages">${pager}</center></div></div><div class="page-control"><a class="next" href="${next}">下一章</a></div>`;
  const client=clientFor({[first]:html('第一段。<br>第二段。','<span class="curr">【1】</span><a href="/view/11_2.html">【2】</a>','<font color="blue">本章未完，点击[ 数字分页 ]继续阅读--&gt;&gt;</font>'),[second]:html('第三段。<br><font color="blue">需要保留的普通文字。</font>','<a href="/view/11_1.html">【1】</a><span class="curr">【2】</span>')});
  const chapter=await getChapter(spec,{title:'第一章',link:first},new Set([first,next]),client);
  assert.deepEqual(client.requests,[first,second]);
  assert.equal(chapter.content,'第一段。\n第二段。\n第三段。\n需要保留的普通文字。');
  assert.equal(chapter.provenance.length,2);
  const bad=clientFor({[first]:html('正文','<span class="curr">【1】</span><a href="/view/12.html">【2】</a>')});
  await assert.rejects(getChapter(spec,{title:'第一章',link:first},new Set([first,next]),bad),/下一页指向另一章/);
});
