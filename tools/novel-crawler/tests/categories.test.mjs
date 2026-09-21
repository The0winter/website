import '../../test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {load} from 'cheerio';
import {extractBookCategory} from '../adapters.mjs';
import {acquire, extractionHash, localBookState} from '../core.mjs';
import {normalizeBookCategory, mergeBookCategory, applyVerifiedBookCategory} from '../categories.mjs';
import {parsePublisherSearch, parsePublisherCategory, lookupPublisherCategory} from '../publisher-category.mjs';
import {planUpload} from '../desktop/upload.mjs';
import {atomicWrite, hash} from '../storage.mjs';
import {updateLocalBookCategory} from '../category-update.mjs';
import {continuationKey} from '../continuation.mjs';

const temporary = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'categories-')); t.after(() => fs.rmSync(dir, {recursive:true, force:true})); return dir; };
test('category extraction ignores recommendations, tags, numeric IDs and conflicts', () => {
  const $ = load('<aside>仙侠小说推荐</aside><span id="main">都市生活</span><span id="sub">都市</span><span id="tag">系统流</span><b>仙侠</b>');
  assert.equal(extractBookCategory($, ['#main', '#sub']).category, '都市');
  assert.equal(extractBookCategory($, ['#main', 'b']).categoryDetection, 'conflict');
  assert.equal(extractBookCategory($, '#tag').category, undefined);
  assert.equal(extractBookCategory($, '#missing').category, undefined);
  assert.equal(extractBookCategory($, undefined).category, undefined);
  for (const label of ['其他', '3', '穿越', '重生', '都市 · 仙侠', '都市小说免费阅读']) assert.equal(normalizeBookCategory(label), undefined, label);
});
test('publisher identities and search cards must match both title and author', () => {
  const book = {title:'测试书',author:'测试作者'};
  const card = author => `<li><div class="book-mid-info"><h2><a href="//www.qidian.com/book/123/">测试书</a></h2><p class="author"><a class="name">${author}</a></p></div></li>`;
  assert.deepEqual(parsePublisherSearch(`<div class="book-img-text">${card('同名作者')}${card(book.author)}</div>`, book), ['https://www.qidian.com/book/123/']);
  const html = `<div class="book-info"><h1><em>测试书</em><a class="writer">测试作者</a></h1><p class="tag"><a href="/all/">都市</a><a href="/all/">都市生活</a><a href="/tag/">系统流</a></p></div><aside>仙侠</aside>`;
  const found = parsePublisherCategory(html, book, {url:'https://www.qidian.com/book/123/',hash:'abc',checkedAt:new Date().toISOString()});
  assert.equal(found.category,'都市');
  assert.equal(found.categoryEvidence.kind,'publisher');
  assert.throws(() => parsePublisherCategory(html,{...book,author:'别的作者'},{}),/身份不匹配/);
});
test('verification responses have a shared bounded cooldown', async t => {
  const dir = temporary(t); let requests = 0;
  const fetchPage = async () => { requests++; return {status:202,text:async () => '<html>verification</html>'}; };
  for (const title of ['甲','乙','丙']) assert.equal((await lookupPublisherCategory({title,author:'作者'}, dir, {fetchPage,now:1000})).categoryDetection,'publisher-unavailable');
  assert.equal(requests,1);
  await lookupPublisherCategory({title:'甲',author:'作者'},dir,{fetchPage,now:1000+7*3600000});
  assert.equal(requests,2);
});
test('manual, registry and publisher choices survive blanks and stale mirror labels', t => {
  const dir = temporary(t), identity = {title:'书',author:'作者',sourceUrl:'https://example.org/1'};
  assert.equal(mergeBookCategory({category:'都市'},{category:'未分类'}).category,'都市');
  assert.equal(mergeBookCategory({category:'都市'},{category:'仙侠',categoryEvidence:{kind:'source'}}).category,'都市');
  assert.equal(mergeBookCategory({category:'玄幻',categoryEvidence:{kind:'source'}},{category:'奇幻',categoryEvidence:{kind:'publisher'}}).category,'奇幻');
  atomicWrite(path.join(dir,'book-categories.json'),{books:[{...identity,category:'悬疑',evidence:{kind:'publisher',url:'https://www.qidian.com/book/1/',checkedAt:new Date().toISOString()}}]});
  assert.equal(applyVerifiedBookCategory({...identity,category:'都市'},dir).category,'悬疑');
  assert.equal(applyVerifiedBookCategory({...identity,author:'同名作者',category:'都市'},dir).category,'都市');
});
test('adding metadata rules preserves chapter checkpoints and protects edited exports', async t => {
  const dir = temporary(t); let label = '都市生活', reads = 0;
  const server = http.createServer((req,res) => {
    res.setHeader('Content-Type','text/html;charset=utf-8');
    if(req.url==='/book') res.end(`<h1>分类测试</h1><b>作者</b><span id="category">${label}</span><nav><a href="/chapter">第一章 正文</a></nav>`);
    else { reads++; res.end(`<h1>第一章 正文</h1><article>${'窗外的风吹过树梢，小舟停在安静的湖畔。'.repeat(40)}</article>`); }
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); t.after(()=>new Promise(resolve=>server.close(resolve)));
  const spec={version:1,kind:'html',title:'分类测试',author:'作者',sourceUrl:`http://127.0.0.1:${server.address().port}/book`,metadata:{title:'h1',author:'b'},catalog:{links:'nav a'},chapter:{title:'h1',content:'article'},delayMs:200};
  const options={stateDir:dir,outputDir:path.join(dir,'out'),mode:'download'};
  const initial=await acquire(spec,options), upgraded={...spec,metadata:{...spec.metadata,category:'#category'}};
  assert.equal(extractionHash(spec),extractionHash(upgraded));
  assert.equal(localBookState(upgraded,options).state,'complete');
  const first=await acquire(upgraded,options); assert.equal(first.category,'都市'); assert.equal(reads,1);
  label='未分类'; const blank=await acquire(upgraded,options); assert.equal(blank.category,'都市'); assert.equal(blank.reusedExport,true);
  label='仙侠'; const changed=await acquire(upgraded,options); assert.equal(changed.category,'都市'); assert.equal(reads,1);
  assert.deepEqual(JSON.parse(fs.readFileSync(initial.exportFile)).chapters,JSON.parse(fs.readFileSync(first.exportFile)).chapters);
  fs.appendFileSync(first.exportFile,' ');
  assert.equal((await acquire(upgraded,options)).exportFile,null);
});
test('routine upload fills a missing category and preserves an existing website choice', () => {
  const book={title:'书',author:'作者',sourceUrl:'https://example.org/1',category:'都市生活',chapters:[]};
  const remote={book:{...book,category:'未分类'},chapters:[]};
  assert.equal(planUpload(book,remote,[{chapters:[]}]).batches[0].category,'都市');
  assert.equal(planUpload(book,{...remote,book:{...remote.book,category:'悬疑'}},[{chapters:[]}]).batches.length,0);
  assert.equal(planUpload({...book,category:'未分类'},remote,[{chapters:[]}]).batches.length,0);
});

test('metadata backfill keeps a readable export and its checkpoint in sync, rejecting outside edits', async t => {
  const dir=temporary(t),stateDir=path.join(dir,'state'),outputDir=path.join(dir,'out'),backupDir=path.join(dir,'backup');
  const book={title:'补全测试',author:'作者',sourceUrl:'https://example.org/book',chapters:[{title:'第一章',chapter_number:1,content:'保持原来的正文。'}]};
  const file=path.join(outputDir,'book.json'),job=path.join(stateDir,'jobs','a'.repeat(20));
  atomicWrite(file,book);atomicWrite(path.join(job,'export.json'),{path:file,hash:hash(fs.readFileSync(file))});atomicWrite(path.join(job,'spec.json'),book);
  const plan={...book,file:'book.json',hash:hash(fs.readFileSync(file))},record={...book,category:'都市',categoryEvidence:{kind:'source',url:book.sourceUrl,checkedAt:new Date().toISOString()}};
  const result=await updateLocalBookCategory({record,plan,stateDir,outputDir,backupDir});
  assert.equal(result.unchangedContent,true);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)).chapters,book.chapters);
  assert.equal(JSON.parse(fs.readFileSync(path.join(job,'export.json'))).hash,hash(fs.readFileSync(file)));
  assert.equal((await updateLocalBookCategory({record,plan,stateDir,outputDir,backupDir})).reused,true);
  fs.appendFileSync(file,' ');
  await assert.rejects(updateLocalBookCategory({record,plan,stateDir,outputDir,backupDir}),/文件发生变化/);
});

test('an active continuation protects dormant checkpoints while category metadata is updated', async t => {
  const dir=temporary(t),stateDir=path.join(dir,'state'),outputDir=path.join(dir,'out'),backupDir=path.join(dir,'backup');
  const book={title:'换源测试',author:'作者',sourceUrl:'https://example.org/book',chapters:[{title:'第一章',chapter_number:1,content:'已核实的阅读版。'}]},file=path.join(outputDir,'book.json'),job=path.join(stateDir,'jobs','a'.repeat(20));
  atomicWrite(file,book);atomicWrite(path.join(job,'spec.json'),book);atomicWrite(path.join(job,'export.json'),{path:file,hash:'old-export'});
  const plan={...book,file:'book.json',hash:hash(fs.readFileSync(file))},key=continuationKey(plan),binding={outputPath:file,exportHash:plan.hash,source:{url:'https://other.example/1'},revision:1};
  atomicWrite(path.join(stateDir,'continuations',key,'binding.json'),{value:binding,hash:hash(binding)});
  await updateLocalBookCategory({record:{...book,category:'都市',categoryEvidence:{url:book.sourceUrl,checkedAt:new Date().toISOString()}},plan,stateDir,outputDir,backupDir});
  assert.equal(JSON.parse(fs.readFileSync(path.join(job,'export.json'))).hash,'old-export');
  assert.equal(JSON.parse(fs.readFileSync(path.join(stateDir,'continuations',key,'binding.json'))).value.exportHash,hash(fs.readFileSync(file)));
  assert.equal(JSON.parse(fs.readFileSync(file)).category,'都市');
});
