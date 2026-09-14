import test from 'node:test';
import assert from 'node:assert/strict';
import {loadSites, specForBook} from '../desktop/sources.mjs';
import {getCatalog, getChapter} from '../adapters.mjs';

test('sjks88 keeps source sections in order and reads only the selected book and author', async () => {
  const site = loadSites().sites.find(s => s.id === 'sjks88');
  assert.ok(site);
  assert.equal(site.search, undefined);
  for (const [category, id, suffix] of [['chuanyue', '123', '(1-368)'], ['lishi', '9876', '']]) {
    const url = `${site.home}${category}/${id}.html`;
    const spec = specForBook({url, title: '测试故事', author: '测试作者'});
    const link = n => `${site.home}${category}/${id}/${n}.html`;
    const detail = `<div class="box-artic"><h1>测试故事${suffix}</h1><div class="autor2">作者：测试作者</div><div class="autor2">更新时间：今天</div><div class="autor2">类别：历史</div><div class="list"><li><a href="/${category}/${id}/1.html"> 第1节</a></li><li><a href="/${category}/${id}/2.html"> 第2节</a></li><li><a href="/${category}/999/1.html">其他作品</a></li></div></div>`;
    const requests = [];
    const client = {assertUrl(requested) { assert.equal(new URL(requested).hostname, 'www.sjks88.com'); return requested; }, async get(requested) {
      requests.push(requested);
      const html = requested === url ? detail : '<div class="box-artic"><h1>测试故事 第1节</h1><div class="content">第一章 山间<br>前半段。<br>第二章 河岸<br>后半段。</div><div class="artic_pages"><a>下一节</a></div></div>';
      return {url: requested, body: Buffer.from(html), contentType: 'text/html; charset=utf-8', hash: 'fixture', fetchedAt: '2026-09-14T00:00:00Z'};
    }};
    const result = await getCatalog(spec, client);
    assert.deepEqual(result.catalog.map(c => [c.title, c.link]), [['第1节', link(1)], ['第2节', link(2)]]);
    const chapter = await getChapter(spec, result.catalog[0], new Set(result.catalog.map(c => c.link)), client);
    assert.equal(chapter.title, '第1节');
    assert.match(chapter.content, /第一章 山间\s+前半段。\s+第二章 河岸\s+后半段。/u);
    assert.doesNotMatch(chapter.content, /下一节/u);
    assert.deepEqual(requests, [url, link(1)]);
    await assert.rejects(getCatalog({...spec, author: '其他作者'}, client), /身份不匹配/);
    assert.throws(() => specForBook({url: link(1), title: '测试故事', author: '测试作者'}), /不是章节/);
  }
});
