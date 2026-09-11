import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {load} from 'cheerio';
import {extractDescription} from '../adapters.mjs';
import {loadSites} from '../desktop/sources.mjs';
import {acquire, localBookState} from '../core.mjs';
import {prepareImport} from '../../../infra/import-plan.mjs';

test('all desktop sources extract full paragraphs, excluding controls, SEO and duplicate mobile copies', () => {
  const pages = {
    '69shuba': '<div class="navtxt"><p>第一段。<br>第二段。</p><p>小说关键词：网站推广</p></div>',
    banshanren: '<div class="novel_intro_box pc"><p>第一段。<br>第二段。</p><p class="hl">更新时间</p></div><div class="novel_intro_box h5"><p>手机版重复简介</p></div>',
    ixdzs8: '<p id="intro">第一段。<br>第二段。<span class="c-more">展开</span><script>bad()</script></p>',
    shudugu: '<div class="container"><div class="des bb"><p>第一段。</p><p>第二段。</p></div><div class="des bb">推广说明</div></div>',
    twkan: '<div id="tab_info"><div class="navtxt"><p>第一段。</p><p>第二段。</p>小說關鍵詞：網站推廣</div></div>',
  };
  for (const site of loadSites().sites) {
    for (const metadata of [site.book.metadata, site.spec.metadata]) {
      assert.deepEqual(extractDescription(load(pages[site.id]), metadata.description), {description: '第一段。\n第二段。', descriptionStatus: 'collected'}, site.id);
      assert.equal(extractDescription(load('<p>无简介页面</p>'), metadata.description).description, undefined);
    }
  }
});

test('optional descriptions skip ambiguous containers, respect fallbacks and bound Unicode without broken surrogates', () => {
  const $ = load('<div class="intro">甲</div><div class="intro">乙</div><meta property="og:description" content="来源简介">');
  assert.deepEqual(extractDescription($, '.intro'), {descriptionStatus: 'missing'});
  assert.equal(extractDescription($, ['.intro', {selector: 'meta[property="og:description"]', attribute: 'content'}]).description, '来源简介');
  assert.equal(extractDescription($).descriptionStatus, 'unconfigured');
  const long = extractDescription(load(`<div id="intro">${'字'.repeat(4999)}📚结尾</div>`), '#intro');
  assert.equal(long.descriptionStatus, 'truncated');
  assert.equal(long.description, '字'.repeat(4999));
});

test('old downloads gain and refresh descriptions without requesting saved chapters; missing descriptions preserve saved metadata', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-description-'));
  t.after(() => {
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(dir).startsWith('novel-description-'));
    fs.rmSync(dir, {recursive: true, force: true});
  });
  let intro = '<p>初次简介。</p><p>第二段。</p>', chapterRequests = 0;
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (req.url === '/book') res.end(`<h1>测试书</h1><b>测试作者</b><div id="intro">${intro}</div><nav><a href="/chapter">第1章 春天</a></nav>`);
    else { chapterRequests++; res.end(`<h1>第1章 春天</h1><article>${'春天的风穿过河岸，行人走过石桥。'.repeat(25)}</article>`); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const spec = {version: 1, kind: 'html', title: '测试书', author: '测试作者', sourceUrl: `http://127.0.0.1:${server.address().port}/book`, metadata: {title: 'h1', author: 'b'}, catalog: {links: 'nav a'}, chapter: {title: 'h1', content: 'article'}, delayMs: 200};
  const options = {stateDir: dir, outputDir: path.join(dir, 'out'), mode: 'download'};
  const first = await acquire(spec, options);
  assert.equal(first.structuralPass, true);
  assert.equal(JSON.parse(fs.readFileSync(first.exportFile)).description, undefined);
  const upgraded = {...spec, metadata: {...spec.metadata, description: '#intro'}};
  assert.equal(localBookState(upgraded, options).state, 'complete');
  const second = await acquire(upgraded, options);
  assert.equal(second.jobId, first.jobId);
  assert.equal(second.completeAgainstSource, true);
  assert.equal(second.description, '初次简介。\n第二段。');
  assert.equal(second.reusedExport, false);
  assert.equal(chapterRequests, 1);
  const exported = JSON.parse(fs.readFileSync(second.exportFile));
  assert.equal(exported.description, second.description);
  const batches = prepareImport({...exported, chapters: Array.from({length: 21}, (_, i) => ({...exported.chapters[0], chapter_number: i + 1}))});
  assert.equal(batches.length, 2);
  assert.ok(batches.every(batch => batch.description === second.description));
  intro = '<p>更新后的简介。</p>';
  const refreshed = await acquire(upgraded, options);
  assert.equal(refreshed.description, '更新后的简介。');
  assert.equal(chapterRequests, 1);
  intro = '';
  const retained = await acquire(upgraded, options);
  assert.equal(retained.descriptionStatus, 'retained');
  assert.equal(retained.description, refreshed.description);
  assert.equal(retained.reusedExport, true);
  assert.equal(chapterRequests, 1);
  assert.equal(localBookState({...upgraded, chapter: {...upgraded.chapter, content: 'main'}}, options).state, 'incompatible');
  fs.appendFileSync(retained.exportFile, ' ');
  const protectedResult = await acquire(upgraded, options);
  assert.equal(protectedResult.exportFile, null);
  assert.match(protectedResult.failures[0].error, /拒绝覆盖/);
});
