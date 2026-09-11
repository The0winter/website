import test from 'node:test';
import assert from 'node:assert/strict';
import {loadSites, parseSearch, specForBook} from '../desktop/sources.mjs';
import {getCatalog, getChapter} from '../adapters.mjs';

const site = loadSites().sites.find(s => s.id === 'banshanren');
const card = (id, author) => `<li class="novel_li"><a class="cover_box" href="/novel/${id}">封面</a><div class="title_box"><a class="title" href="/novel/${id}">测试书</a><div class="info_box"><span>推荐度 90%</span></div><div class="info_box">${author} · 连载中 · 20章 · 1000字</div><ul class="category_list"><li><a href="/all/0/">分类</a></li></ul><div class="novel_intro_box"><p>合成简介</p></div></div></li>`;

test('banshanren search excludes recommendations and nested category links, pairs each author', () => {
  const html = `<div class="main_box"><div class="search_box hide"><ul class="search_hot_box novel_list">${card('hot','推荐作者')}</ul></div><div class="search_tip"></div><ul class="novel_list">${card('alpha','甲作者')}${card('beta-2','乙作者')}</ul><div class="pagination_box"><div class="arrow_box" onclick="search('测试书', 2)"></div></div></div>`;
  const parsed = parseSearch(html, site.search.url.replace('${query}', encodeURIComponent('测试书')), site);
  assert.deepEqual(parsed.results.map(b=>[b.title,b.author,b.url]), [['测试书','甲作者',site.home+'novel/alpha'],['测试书','乙作者',site.home+'novel/beta-2']]);
  assert.equal(parsed.next, null);
  assert.equal(site.search.maxPages,1); // JS pagination is not an HTML next-page link.
  assert.deepEqual(parseSearch('<div class="main_box"><div class="search_tip"></div></div>',site.home+'search/index?keyword=empty',site).results,[]);
  assert.throws(()=>parseSearch(html.replace('/novel/alpha','https://foreign.example/novel/alpha').replace('href="/novel/alpha"','href="https://foreign.example/novel/alpha"'),site.home,site),/详情页/);
});

test('banshanren uses bare identity fields and book-specific catalogs, removes comment counts only', async () => {
  for(const id of ['alpha','beta-2']) {
    const url=site.home+'novel/'+id;
    const spec=specForBook({url,title:'测试书',author:'甲作者'},[site]);
    assert.equal(spec.variant,'desktop-banshanren-v2');
    assert.equal(spec.browser.responseMode,'source');
    const link=n=>url+'/'+(100+n);
    const metadata='<meta property="og:title" content="《测试书》甲作者_小说全本免费阅读"><div class="novel_title_box"><h1>测试书</h1><div class="info_box">推荐度</div><div class="info_box"><span class="hl">甲作者</span></div></div>';
    const pages=new Map([
      [url,metadata+`<a href="${link(2)}">最新章节</a><div class="catalog_box"><div class="volume_box"><ul class="chapter_list"><li class="volume_title_box"><div>第一卷</div></li><li class="volume_chapter parent_1"><div><a href="/novel/${id}/101">第1章 开始</a></div><span>日期</span></li><li><div><a href="/novel/${id}/102">第2章 继续</a></div><span>日期</span></li><li><a href="/novel/foreign/103">其他书</a></li></ul></div></div>`],
      [link(1),`<div class="chapter_head_box"><a href="${url}">返回书籍</a><a href="${link(2)}">下一章</a></div><div class="chapter_content_box"><h2>第1章 开始</h2><p>第一段合成正文。<span class="z count_0">99+</span></p><p>正文里的数字123和<span>正常强调</span>保留。<span class="nz count_1">0</span></p><p>故事中提到评论和下一章，也保留。</p></div><div class="chapter_navigation_box"><a href="${link(2)}">下一章</a></div><div class="comment_box">外部评论</div>`]
    ]);
    const requests=[];
    const client={
      assertUrl(value){assert.equal(new URL(value).hostname,'www.banshanren.com');return value;},
      async get(value){requests.push(value);assert.ok(pages.has(value));return {url:value,body:Buffer.from(pages.get(value)),contentType:'text/html; charset=utf-8',hash:'synthetic',fetchedAt:'2026-09-11T00:00:00Z'};}
    };
    const {actual,catalog}=await getCatalog(spec,client);
    assert.deepEqual(actual,{title:'测试书',author:'甲作者'});
    assert.deepEqual(catalog.map(c=>[c.link,c.chapter_number]),[[link(1),1],[link(2),2]]);
    const chapter=await getChapter(spec,catalog[0],new Set(catalog.map(c=>c.link)),client);
    assert.equal(chapter.title,'第1章 开始');
    assert.equal(chapter.content,'第一段合成正文。\n正文里的数字123和正常强调保留。\n故事中提到评论和下一章，也保留。');
    assert.deepEqual(requests,[url,link(1)]);
    await assert.rejects(getCatalog({...spec,author:'另一作者'},client),/身份不匹配/);
    pages.set(link(1),'<div class="chapter_content_box"><h2>第1章 开始</h2><p>不完整的合成片段</p><div class="limit_box">阅读限制</div></div>');
    await assert.rejects(getChapter(spec,catalog[0],new Set(),client), error => error.code === 'page-restricted' && error.stopSource && error.selector === '.chapter_content_box .limit_box' && /下一步|核对/.test(error.nextStep));
  }
  assert.throws(()=>specForBook({url:site.home+'novel/alpha/101',title:'测试书',author:'甲作者'},[site]),/不是章节/);
});
