import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {load} from 'cheerio';
import {extractBookStatus, normalizeBookStatus, getResource} from '../adapters.mjs';
import {loadSites, specForBook, applyVerifiedBookStatus} from '../desktop/sources.mjs';
import {acquire, localBookState, validateSpec} from '../core.mjs';
import {prepareImport} from '../../../infra/import-plan.mjs';

test('publication status recognizes explicit simplified/traditional labels, never completion of a download or chapter', () => {
  for (const value of ['全本', '完本', '已完结', '完結', '作品狀態： 已完結', 'completed']) assert.equal(normalizeBookStatus(value), '完结', value);
  for (const value of ['连载', '連載中', '正在连载', '未完结', 'ongoing']) assert.equal(normalizeBookStatus(value), '连载', value);
  for (const value of [undefined, '', '下载完成', '本章完', '完结小说推荐', '第200章 大结局', '暂停更新', '全本下载 连载中', '未完成']) assert.equal(normalizeBookStatus(value), undefined, value);
});

test('all sources read status only from the selected book; conflicting, missing and unfamiliar labels remain unknown', () => {
  const pages = {
    '69shuba': '<meta property="og:novel:status" content="全本"><div class="booknav2"><p>作者</p><p>分类</p><p>100万字 | 全本</p></div>',
    twkan: '<meta property="og:novel:status" content="已完結">',
    ixdzs8: '<h1>书名</h1><p><span class="end">已完结</span></p>',
    shudugu: '<div class="itemtxt"><h1>书名</h1><p><span>完结</span><span>玄幻</span></p></div>',
    banshanren: '<div class="novel_title_box"><div class="novel_summary_box pc"><p class="serializing"><img alt="完结状态">已完结</p></div></div><div class="novel_summary_box h5"><p class="serializing">已完结</p></div>',
  };
  for (const site of loadSites().sites) for (const metadata of [site.book.metadata, site.spec.metadata]) {
    const result = extractBookStatus(load(pages[site.id] + '<aside>连载小说推荐</aside>'), metadata.status, {url: 'https://example.test/book', hash: 'snapshot', fetchedAt: 'now'});
    assert.equal(result.status, '完结', site.id);
    assert.equal(result.statusDetection, 'collected');
    assert.equal(result.statusEvidence.hash, 'snapshot');
    assert.equal(extractBookStatus(load('<nav>完结</nav><h1>大结局</h1>'), metadata.status).status, undefined);
  }
  const rules = ['#a', '#b'];
  assert.equal(extractBookStatus(load('<p id="a">连载中</p><p id="b">已完结</p>'), rules).statusDetection, 'conflict');
  assert.equal(extractBookStatus(load('<p id="a">暂停更新</p>'), rules).statusDetection, 'unrecognized');
  assert.equal(extractBookStatus(load('<p class="status">完结</p><p class="status">连载</p>'), '.status').statusDetection, 'missing');
  assert.equal(extractBookStatus(load('')).statusDetection, 'unconfigured');
  assert.equal(extractBookStatus(load('<p id="a">wrong format</p>'), {selector:'#a',pattern:'^状态：(.*)$'}).statusDetection, 'missing');
});

test('status can be added to old downloads, refreshed and retained without re-fetching chapters or overwriting edits', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-status-'));
  t.after(() => { assert.ok(dir.startsWith(os.tmpdir() + path.sep)); assert.ok(path.basename(dir).startsWith('novel-status-')); fs.rmSync(dir, {recursive:true,force:true}); });
  let label = '连载中', chapterRequests = 0;
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (req.url === '/book') res.end(`<h1>测试书</h1><b>测试作者</b><p id="status">${label}</p><nav><a href="/chapter">第1章 春天</a></nav>`);
    else { chapterRequests++; res.end(`<h1>第1章 春天</h1><article>${'春天的风穿过河岸，行人走过石桥。'.repeat(25)}</article>`); }
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const spec = {version:1,kind:'html',title:'测试书',author:'测试作者',sourceUrl:`http://127.0.0.1:${server.address().port}/book`,metadata:{title:'h1',author:'b'},catalog:{links:'nav a'},chapter:{title:'h1',content:'article'},delayMs:200};
  const options = {stateDir:dir,outputDir:path.join(dir,'out'),mode:'download'};
  const first = await acquire(spec,options);
  assert.equal(first.completeAgainstSource,true);
  assert.equal(JSON.parse(fs.readFileSync(first.exportFile)).status,undefined);
  const upgraded = {...spec,metadata:{...spec.metadata,status:'#status'}};
  assert.equal(localBookState(upgraded,options).state,'complete');
  const serial = await acquire(upgraded,options);
  assert.equal(serial.status,'连载');
  assert.equal(serial.jobId,first.jobId);
  assert.equal(serial.completeAgainstSource,true);
  label = '已完结';
  const completed = await acquire(upgraded,options);
  assert.equal(completed.status,'完结');
  assert.equal(completed.statusDetection,'collected');
  assert.equal(completed.statusEvidence.matches[0].raw,label);
  assert.equal(chapterRequests,1);
  const exported = JSON.parse(fs.readFileSync(completed.exportFile));
  const batches = prepareImport({...exported,chapters:Array.from({length:21},(_,i)=>({...exported.chapters[0],chapter_number:i+1}))});
  assert.ok(batches.every(b=>b.status==='完结'));
  label = '';
  const retained = await acquire(upgraded,options);
  assert.equal(retained.status,'完结');
  assert.equal(retained.statusDetection,'retained');
  assert.equal(retained.reusedExport,true);
  assert.equal(chapterRequests,1);
  label = '连载中';
  const reopened = await acquire(upgraded,options);
  assert.equal(reopened.status,'完结');
  assert.equal(reopened.statusDetection,'conflict-retained');
  assert.equal(reopened.statusEvidence.conflictingSource.matches[0].status,'连载');
  assert.equal(chapterRequests,1);
  fs.appendFileSync(reopened.exportFile,' ');
  const protectedResult = await acquire(upgraded,options);
  assert.equal(protectedResult.exportFile,null);
  assert.match(protectedResult.failures[0].error,/拒绝覆盖/);
  assert.equal(localBookState({...upgraded,chapter:{...upgraded.chapter,content:'main'}},options).state,'incompatible');
  assert.throws(()=>validateSpec({...spec,status:'下载完成'}),/作品状态/);
});

test('desktop specs carry status and resource acquisitions read publication metadata', async t => {
  const site = loadSites().sites.find(s=>s.id==='69shuba');
  const spec = specForBook({url:'https://www.69shuba.com/book/123.htm',title:'测试书',author:'作者',status:'完结',statusDetection:'collected',statusEvidence:{hash:'h'}},[site]);
  assert.equal(spec.status,'完结'); assert.equal(spec.statusEvidence.hash,'h');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'novel-status-resource-'));
  t.after(()=>{assert.ok(dir.startsWith(os.tmpdir()+path.sep));assert.ok(path.basename(dir).startsWith('novel-status-resource-'));fs.rmSync(dir,{recursive:true,force:true});});
  fs.writeFileSync(path.join(dir,'book-statuses.json'), JSON.stringify({books:[{title:spec.title,author:spec.author,sourceUrl:spec.sourceUrl,status:'完结',evidence:{url:'https://publisher.test/book',checkedAt:'now'}}]}));
  assert.equal(applyVerifiedBookStatus({...spec,status:'连载'},dir).status,'完结');
  assert.equal(applyVerifiedBookStatus({...spec,status:'连载',author:'另一作者'},dir).status,'连载');
  assert.equal(applyVerifiedBookStatus({...spec,status:'连载',sourceUrl:'https://www.69shuba.com/book/124.htm'},dir).status,'连载');
  const source = await getResource({title:'测试书',author:'作者',kind:'txt',sourceUrl:'https://example.test/book',metadata:{title:'h1',author:'b',status:'#status'},resource:{url:'https://example.test/book.txt'}},{get:async url=>({url,body:Buffer.from(url.endsWith('.txt')?'第1章 春天\n正文':'<h1>测试书</h1><b>作者</b><p id="status">已完结</p>'),hash:'h',fetchedAt:'now',contentType:'text/plain; charset=utf-8'})},dir);
  assert.equal(source.actual.status,'完结');
});
