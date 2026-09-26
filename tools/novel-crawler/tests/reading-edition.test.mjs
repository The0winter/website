import '../../test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {acquire, bindReadingEdition, localBookState, jobId, validateSpec, extractionHash, reviewReadingNumbering, reviewReadingCatalogNumber} from '../core.mjs';
import {atomicWrite, readJson, hash} from '../storage.mjs';
import {formatChapterForExport} from '../titles.mjs';
import {loadReadingEdition, recordReadingNoticeReview, preserveReviewedCatalogLabels} from '../reading-edition.mjs';
import {createDesktop} from '../desktop/server.mjs';

async function fixture(t, {sourceOrder = false, titles = {}, fullCatalog = false} = {}) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-edition-'));
  const state = {count: 5, titles: {...titles}, bodyTitles: {}, bodies: sourceOrder ? {4: '核实过的独立完整正文。'.repeat(90)} : {}, requests: []};
  const ids = [90, 12, 70, 21, 60, 31, 50, 41, 81, 82];
  const title = n => state.titles[n] || `第${[1,3,1,2,2][n - 1] || n - 2}章 场景${n === 3 ? 1 : n}`;
  const body = n => state.bodies[n] || (n === 4 ? '銆锛鈥鐨勬姹熸'.repeat(100) : Array.from({length: 100}, (_, i) => String.fromCodePoint(0x4e00 + (n === 3 ? 1 : n) * 200 + i)).join('').repeat(8));
  const chapterPath = n => `/book/A-${ids[n - 1]}.html`;
  const anchor = n => `<a href="${chapterPath(n)}">${title(n)}</a>`;
  const server = http.createServer((req, res) => {
    state.requests.push(req.url);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (req.url === '/book/A.html') return res.end(`<h1>测试书</h1><b>甲作者</b><i>${state.count}</i><ul>${(fullCatalog ? Array.from({length:state.count},(_,i)=>i+1) : [1,2]).map(anchor).join('')}</ul><aside>${[state.count,state.count-1].map(anchor).join('')}</aside>`);
    const n = ids.findIndex(id => req.url === `/book/A-${id}.html`) + 1;
    if (!n || n > state.count) { res.statusCode = 404; return res.end(); }
    res.end(`<h1>${state.bodyTitles[n] || title(n)}</h1><article>${body(n)}</article><nav><a class="book" href="/book/A.html">目录</a><a class="next" href="${n < state.count ? chapterPath(n+1) : '/book/A.html'}">下一章</a></nav>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); assert.equal(path.dirname(stateDir), os.tmpdir()); assert.ok(path.basename(stateDir).startsWith('novel-edition-')); fs.rmSync(stateDir, {recursive: true, force: true}); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const spec = validateSpec({version: 1, kind: 'html', variant: 'edition-v1', title: '测试书', author: '甲作者', sourceUrl: base + '/book/A.html', delayMs: 200, retries: 0, metadata: {title: 'h1', author: 'b'}, catalog: {links: 'ul a', count: 'i', walk: {next: '.next', bookLink: '.book', chapterPattern: '^/book/A-(?<chapterId>[0-9]+)\\.html$', recentLinks: 'aside a', recentReverse: true}}, chapter: {title: 'h1', content: 'article'}});
  if (fullCatalog) { delete spec.catalog.walk; delete spec.catalog.count; }
  const options = {stateDir, outputDir: path.join(stateDir, 'exports')};
  const initial = await acquire(spec, {...options, mode: 'download'});
  assert.equal(initial.completeAgainstSource, true);
  assert.ok(initial.errors >= (sourceOrder ? 1 : 2));
  assert.equal(initial.exportFile, null);
  const dir = path.join(stateDir, 'jobs', jobId(spec)), file = path.join(options.outputDir, '测试书--网站阅读版.json');
  const raw = n => readJson(path.join(dir, 'chapters', hash(base + chapterPath(n)) + '.json')).chapter;
  const book = {title: spec.title, author: spec.author, sourceUrl: spec.sourceUrl, chapters: [1,5,2].map((n, i) => ({...formatChapterForExport(raw(n)), chapter_number: i + 1, sourceChapterNumber: n, sourceChapterUrl: raw(n).link}))};
  atomicWrite(file, book);
  const binding = path.join(dir, 'reading-edition.json');
  const bind = () => bindReadingEdition(spec, file, options);
  return {spec, options, dir, file, binding, state, raw, bind, base, chapterPath, book};
}

test('source-order review pins duplicate omissions while preserving historical numbering and all other entries', async t => {
  const f = await fixture(t, {sourceOrder: true});
  const select = positions => ({...f.book, chapters: positions.map((n, i) => ({...formatChapterForExport(f.raw(n)), chapter_number: i + 1, sourceChapterNumber: n, sourceChapterUrl: f.raw(n).link}))});
  const book = select([1,2,4,5]);
  const review = {catalogHash: hash(readJson(path.join(f.dir, 'catalog.json'))), reason: '已核对当前来源重号，保留原始顺序；只移出已确认的重复项。', pairs: [{omit: 3, keep: 1, omitHash: hash(f.raw(3).content), keepHash: hash(f.raw(1).content), reason: '两个来源条目全文相同。'}]};
  const bind = r => bindReadingEdition(f.spec, f.file, {...f.options, sourceOrderReview: r});
  atomicWrite(f.file, book);
  for (const r of [{...review, catalogHash: 'stale'}, {...review, pairs: []}, {...review, pairs: [{...review.pairs[0], omitHash: 'stale'}]}, {...review, pairs: [{...review.pairs[0], keep: 2, keepHash: hash(f.raw(2).content)}]}]) await assert.rejects(bind(r));
  atomicWrite(f.file, select([2,1,4,5])); await assert.rejects(bind(review), /不能重排/);
  atomicWrite(f.file, select([1,2,5])); await assert.rejects(bind(review), /不得遗漏/);
  atomicWrite(f.file, {...book, chapters: book.chapters.map((c, i) => ({...c, chapter_number: i + 2}))}); await assert.rejects(bind(review), /顺序号/);
  atomicWrite(f.file, book);
  assert.equal((await bind(review)).readingEntries, 4);
  assert.deepEqual(readJson(f.file), book);
  const unchanged = await acquire(f.spec, {...f.options, mode: 'download'});
  assert.equal(unchanged.reusedExport, true);
  assert.equal(unchanged.acceptedSourceOrder.pairs.length, 1);
  f.state.count = 6; f.state.titles[6] = '第99章 未核对跳号';
  const blocked = await acquire(f.spec, {...f.options, mode: 'download'});
  assert.equal(blocked.exportFile, null); assert.deepEqual(readJson(f.file), book);
});

test('source-order review rechecks a pinned duplicate whose identical copy hid the direct near match', async t => {
  const f = await fixture(t, {sourceOrder: true, titles: {2:'第1章 场景1',3:'第1章 场景1'}});
  const original = Array.from({length: 1400}, (_, i) => String.fromCodePoint(0x6000 + i)).join('');
  f.state.bodies[1] = original;
  f.state.bodies[2] = f.state.bodies[3] = original + '。';
  const report = await acquire(f.spec, {...f.options, mode: 'download', refresh: true});
  assert.ok(report.issues.some(i => i.code === 'duplicate-title-body' && i.chapter === 2 && i.otherChapter === 1));
  assert.ok(report.issues.some(i => i.code === 'duplicate-body' && i.chapter === 3 && i.otherChapter === 2));
  assert.ok(!report.issues.some(i => i.code.startsWith('duplicate') && i.chapter === 3 && i.otherChapter === 1));
  const originals = [1,2,3,4,5].map(f.raw);
  const book = {...f.book, chapters: [1,4,5].map((n,i) => ({...formatChapterForExport(f.raw(n)), chapter_number:i+1, sourceChapterNumber:n, sourceChapterUrl:f.raw(n).link}))};
  atomicWrite(f.file, book);
  const pair = omit => ({omit,keep:1,omitHash:hash(f.raw(omit).content),keepHash:hash(f.raw(1).content),reason:'同题重复副本，逐对核实，保留首次正文。'});
  const review = {catalogHash:hash(readJson(path.join(f.dir,'catalog.json'))),reason:'保留原始来源次序',pairs:[pair(2),pair(3)]};
  const bind = r => bindReadingEdition(f.spec,f.file,{...f.options,sourceOrderReview:r});
  await assert.rejects(bind({...review,pairs:[pair(2),{...pair(3),keep:4,keepHash:hash(f.raw(4).content)}]}), /未检测为重复/);
  assert.equal((await bind(review)).readingEntries, 3);
  assert.deepEqual([1,2,3,4,5].map(f.raw), originals);
  assert.deepEqual(readJson(f.file), book);
});

test('reviewed glyph differences admit only pinned detected near duplicates and preserve original checkpoints', async t => {
  const f = await fixture(t, {sourceOrder: true, titles: {3: '第1章 错贴的另一标题'}});
  const original = Array.from({length: 1400}, (_, i) => String.fromCodePoint(0x6000 + i)).join('');
  f.state.bodies[1] = original;
  f.state.bodies[3] = original.slice(0, 61) + '差' + original.slice(62);
  const report = await acquire(f.spec, {...f.options, mode: 'download', refresh: true});
  assert.ok(report.issues.some(i => i.code === 'similar-body' && i.chapter === 3 && i.otherChapter === 1));
  const select = () => ({...f.book, chapters: [1,2,4,5].map((n,i) => ({...formatChapterForExport(f.raw(n)), chapter_number:i+1, sourceChapterNumber:n, sourceChapterUrl:f.raw(n).link}))});
  let book = select();
  atomicWrite(f.file, book);
  const glyphReview = {differences:[{offset:61,omit:'差',keep:original[61]}], evidence:{url:f.raw(3).link,checkedAt:new Date().toISOString(),detail:'逐字核实正文只有一处字形差异，另一标题错贴相同正文。'}};
  const pair = {omit:3,keep:1,omitHash:hash(f.raw(3).content),keepHash:hash(f.raw(1).content),reason:'核实错贴重复项，保留原文与哈希。',glyphReview};
  const review = {catalogHash:hash(readJson(path.join(f.dir,'catalog.json'))),reason:'保留来源次序，只移出逐字核实的错贴项。',pairs:[pair]};
  const bind = p => bindReadingEdition(f.spec,f.file,{...f.options,sourceOrderReview:{...review,pairs:[p]}});
  for (const bad of [
    {...pair,glyphReview:undefined}, {...pair,omitHash:'stale'},
    {...pair,glyphReview:{...glyphReview,evidence:{...glyphReview.evidence,checkedAt:'invalid'}}},
    {...pair,glyphReview:{...glyphReview,differences:[]}},
    {...pair,glyphReview:{...glyphReview,differences:[{offset:62,omit:'差',keep:original[61]}]}},
    {...pair,glyphReview:{...glyphReview,differences:[{offset:61,omit:'错',keep:original[61]}]}},
    {...pair,glyphReview:{...glyphReview,differences:Array.from({length:33},()=>glyphReview.differences[0])}},
    {...pair,keep:2,keepHash:hash(f.raw(2).content)},
  ]) await assert.rejects(bind(bad));
  // Even a complete, correct difference list cannot approve a large revision.
  f.state.bodies[3] = '改'.repeat(20) + original.slice(20);
  const larger = await acquire(f.spec,{...f.options,mode:'download',refresh:true});
  assert.ok(larger.issues.some(i=>i.code==='similar-body' && i.chapter===3 && i.otherChapter===1));
  book=select();atomicWrite(f.file,book);
  await assert.rejects(bind({...pair,omitHash:hash(f.raw(3).content),glyphReview:{...glyphReview,differences:Array.from({length:20},(_,offset)=>({offset,omit:'改',keep:original[offset]}))}}),/未逐字核实/);
  f.state.bodies[3] = original.slice(0,61)+'差'+original.slice(62);
  await acquire(f.spec,{...f.options,mode:'download',refresh:true});
  book=select();atomicWrite(f.file,book);
  const checkpoint = path.join(f.dir,'chapters',hash(f.raw(3).link)+'.json'), originalBytes=fs.readFileSync(checkpoint);
  await bind(pair);
  assert.deepEqual(fs.readFileSync(checkpoint),originalBytes);
  assert.deepEqual(readJson(f.file),book);
  const resumed=await acquire(f.spec,{...f.options,mode:'download'});
  assert.equal(resumed.reusedExport,true);
  assert.deepEqual(resumed.acceptedSourceOrder.pairs[0].glyphReview,glyphReview);
  f.state.count=6;f.state.titles[6]='第3章 新的相似错贴';f.state.bodies[6]=original.slice(0,-1)+'新';
  assert.equal((await acquire(f.spec,{...f.options,mode:'download'})).exportFile,null);
  assert.deepEqual(readJson(f.file),book);
});

test('reviewed nonstandard notices preserve the full text and cannot excuse stale content or missing numbered chapters', async t => {
  const f = await fixture(t); await f.bind();
  f.state.count = 6; f.state.titles[6] = '定时操作失误，提前更了'; f.state.bodies[6] = '晚上的章节提前发布了，今晚没有更新。';
  const before = fs.readFileSync(f.file);
  assert.equal((await acquire(f.spec, {...f.options, mode: 'download'})).exportFile, null);
  const notice = f.raw(6), review = {link: notice.link, contentHash: hash(notice.content), reason: '完整正文仅说明定时发布失误，属于作者公告，原文保留。'};
  const record = value => recordReadingNoticeReview(f.dir, f.spec, extractionHash(f.spec), f.options.outputDir, value);
  assert.throws(() => record({...review, contentHash: 'stale'}), /哈希/);
  record(review); assert.deepEqual(fs.readFileSync(f.file), before);
  const checkpoint = path.join(f.dir, 'chapters', hash(notice.link) + '.json'), saved = readJson(checkpoint);
  const changed = {...notice, content: notice.content + '改动'}; atomicWrite(checkpoint, {chapter: changed, hash: hash(changed)});
  assert.equal((await acquire(f.spec, {...f.options, mode: 'download'})).exportFile, null);
  atomicWrite(checkpoint, saved);
  const result = await acquire(f.spec, {...f.options, mode: 'download'});
  assert.equal(result.readingAdded, 1, JSON.stringify(result.failures));
  assert.equal(readJson(f.file).chapters.at(-1).content, notice.content);
  f.state.count = 7; f.state.titles[7] = '第5章 缺少第四章';
  assert.equal((await acquire(f.spec, {...f.options, mode: 'download'})).exportFile, null);
  assert.throws(() => record({link: f.raw(7).link, contentHash: hash(f.raw(7).content), reason: '不能把正文当公告'}), /正文章号/);
});

test('Chinese chapter numbers preserve reviewed exports, append in sequence and still reject new gaps', async t => {
  const f = await fixture(t, {sourceOrder: true, titles:{1:'第一章 开始', 2:'第二章 经过', 3:'第一章 开始', 4:'第三章 转折', 5:'第四章 后续'}});
  const book = {...f.book, chapters:[1,2,4,5].map((n,i)=>({...formatChapterForExport(f.raw(n)), chapter_number:i+1, sourceChapterNumber:n, sourceChapterUrl:f.raw(n).link}))};
  atomicWrite(f.file, book);
  const review = {catalogHash:hash(readJson(path.join(f.dir,'catalog.json'))), reason:'核实中文章号与重复项，保持来源顺序', pairs:[{omit:3, keep:1, omitHash:hash(f.raw(3).content), keepHash:hash(f.raw(1).content), reason:'完整正文相同'}]};
  await bindReadingEdition(f.spec, f.file, {...f.options, sourceOrderReview:review});
  const original = fs.readFileSync(f.file);
  const unchanged = await acquire(f.spec, {...f.options, mode:'download'});
  assert.equal(unchanged.structuralPass, true); assert.equal(unchanged.reusedExport, true);
  assert.deepEqual(fs.readFileSync(f.file), original);
  f.state.count = 6; f.state.titles[6] = '第五章 新章';
  const update = await acquire(f.spec, {...f.options, mode:'download'});
  assert.equal(update.completeAgainstSource, true); assert.equal(update.readingAdded, 1);
  const appended = fs.readFileSync(f.file);
  assert.equal(readJson(f.file).chapters.at(-1).title, '第五章 新章');
  f.state.count = 7; f.state.titles[7] = '第七章 未补齐第六章';
  const blocked = await acquire(f.spec, {...f.options, mode:'download'});
  assert.equal(blocked.exportFile, null); assert.match(blocked.failures[0].error, /章号不连续/);
  assert.deepEqual(fs.readFileSync(f.file), appended);
});

test('bare numeric chapter headings append across punctuation styles without waiving gaps or notice protection', async t => {
  const f = await fixture(t, {sourceOrder: true, titles: {1:'1 开始',2:'2、经过',3:'1 开始',4:'３．转折',5:'4 后续'}});
  const book = {...f.book, chapters: [1,2,4,5].map((n,i) => ({...formatChapterForExport(f.raw(n)),chapter_number:i+1,sourceChapterNumber:n,sourceChapterUrl:f.raw(n).link}))};
  atomicWrite(f.file, book);
  await bindReadingEdition(f.spec, f.file, {...f.options, sourceOrderReview: {catalogHash:hash(readJson(path.join(f.dir,'catalog.json'))),reason:'核对重复项与数字章号',pairs:[{omit:3,keep:1,omitHash:hash(f.raw(3).content),keepHash:hash(f.raw(1).content),reason:'完整正文相同'}]}});
  f.state.count = 6; f.state.titles[6] = '５　新增（4k）';
  const result = await acquire(f.spec, {...f.options,mode:'download'});
  assert.equal(result.readingAdded, 1, JSON.stringify(result.failures));
  assert.deepEqual(readJson(f.file).chapters.slice(0,4), book.chapters);
  assert.equal(readJson(f.file).chapters.at(-1).title, '５　新增（4k）');
  const accepted = fs.readFileSync(f.file);
  f.state.count = 7; f.state.titles[7] = '７ 缺少第六章';
  const blocked = await acquire(f.spec, {...f.options,mode:'download'});
  assert.equal(blocked.exportFile,null); assert.match(blocked.failures[0].error,/章号不连续/);
  assert.deepEqual(fs.readFileSync(f.file),accepted);
  const chapter = f.raw(7);
  assert.throws(() => recordReadingNoticeReview(f.dir,f.spec,extractionHash(f.spec),f.options.outputDir,{link:chapter.link,contentHash:hash(chapter.content),reason:'不能将数字正文章节改为公告'}),/正文章号/);
});

test('joined numeric Chinese headings preserve prose and monthly notices without accepting gaps or repeats', async t => {
  for (const invalid of ['7缺少第六章', '5重复第五章']) await t.test(invalid, async t => {
    const f = await fixture(t, {sourceOrder: true, titles: {1:'1 开始',2:'2、经过',3:'1 开始',4:'3 转折',5:'4 后续'}});
    const book = {...f.book, chapters: [1,2,4,5].map((n,i) => ({...formatChapterForExport(f.raw(n)),chapter_number:i+1,sourceChapterNumber:n,sourceChapterUrl:f.raw(n).link}))};
    atomicWrite(f.file, book);
    await bindReadingEdition(f.spec, f.file, {...f.options, sourceOrderReview: {catalogHash:hash(readJson(path.join(f.dir,'catalog.json'))),reason:'核对完整重复项',pairs:[{omit:3,keep:1,omitHash:hash(f.raw(3).content),keepHash:hash(f.raw(1).content),reason:'完整正文相同'}]}});
    f.state.count = 7; f.state.titles[6] = '５研判（4K）'; f.state.titles[7] = '6月总结';
    const result = await acquire(f.spec, {...f.options,mode:'download'});
    assert.equal(result.readingAdded, 2, JSON.stringify(result.failures));
    const updated = readJson(f.file), accepted = fs.readFileSync(f.file);
    assert.deepEqual(updated.chapters.slice(0,4), book.chapters);
    assert.deepEqual(updated.chapters.slice(-2).map(c=>[c.title,c.content]), [f.raw(6),f.raw(7)].map(c=>[c.title,c.content]));
    f.state.count = 8; f.state.titles[8] = invalid;
    const blocked = await acquire(f.spec, {...f.options,mode:'download'});
    assert.equal(blocked.exportFile,null); assert.match(blocked.failures[0].error,/章号不连续/);
    assert.deepEqual(fs.readFileSync(f.file),accepted);
    const chapter = f.raw(8);
    assert.throws(() => recordReadingNoticeReview(f.dir,f.spec,extractionHash(f.spec),f.options.outputDir,{link:chapter.link,contentHash:hash(chapter.content),reason:'不能将无空格的数字章节认作公告'}),/正文章号/);
  });
});

test('zero-padded bracket chapter headings retain originals and reject missing chapters as notices', async t => {
  const f = await fixture(t, {sourceOrder: true, titles: {1:'0001【开始】',2:'0002【经过】',3:'0001【开始】',4:'0003【转折】',5:'0004【后续】'}});
  const book = {...f.book, chapters: [1,2,4,5].map((n,i) => ({...formatChapterForExport(f.raw(n)),chapter_number:i+1,sourceChapterNumber:n,sourceChapterUrl:f.raw(n).link}))};
  atomicWrite(f.file, book);
  await bindReadingEdition(f.spec, f.file, {...f.options, sourceOrderReview: {catalogHash:hash(readJson(path.join(f.dir,'catalog.json'))),reason:'保留来源方头括号章名与前置零，仅移出完整重复项',pairs:[{omit:3,keep:1,omitHash:hash(f.raw(3).content),keepHash:hash(f.raw(1).content),reason:'完整正文相同'}]}});
  f.state.count = 6; f.state.titles[6] = '０００５【坐仓法的运转逻辑】';
  const result = await acquire(f.spec, {...f.options,mode:'download'});
  assert.equal(result.readingAdded, 1, JSON.stringify(result.failures));
  assert.deepEqual(readJson(f.file).chapters.slice(0,4), book.chapters);
  assert.equal(readJson(f.file).chapters.at(-1).title, f.state.titles[6]);
  const accepted = fs.readFileSync(f.file);
  f.state.count = 7; f.state.titles[7] = '0007【缺少第六章】';
  const blocked = await acquire(f.spec, {...f.options,mode:'download'});
  assert.equal(blocked.exportFile,null); assert.match(blocked.failures[0].error,/章号不连续/);
  assert.deepEqual(fs.readFileSync(f.file),accepted);
  const chapter = f.raw(7);
  assert.throws(() => recordReadingNoticeReview(f.dir,f.spec,extractionHash(f.spec),f.options.outputDir,{link:chapter.link,contentHash:hash(chapter.content),reason:'不能将方头括号正文章节认作公告'}),/正文章号/);
});

test('half-numbered interludes append without consuming the next required integer chapter', async t => {
  const f=await fixture(t); await f.bind(); const old=readJson(f.file);
  f.state.count=6; f.state.titles[6]='第３．５章 聊天番外';
  assert.equal((await acquire(f.spec,{...f.options,mode:'download'})).readingAdded,1);
  assert.deepEqual(readJson(f.file).chapters.slice(0,old.chapters.length),old.chapters);
  assert.equal(readJson(f.file).chapters.at(-1).title,f.state.titles[6]);
  f.state.count=7; f.state.titles[7]='第4章 新的正篇';
  assert.equal((await acquire(f.spec,{...f.options,mode:'download'})).readingAdded,1);
  const accepted=fs.readFileSync(f.file);
  f.state.count=8; f.state.titles[8]='第6章 缺第五章';
  const blocked=await acquire(f.spec,{...f.options,mode:'download'});
  assert.equal(blocked.exportFile,null); assert.match(blocked.failures[0].error,/章号不连续/);
  assert.deepEqual(fs.readFileSync(f.file),accepted);
});

test('decimal headings cannot waive missing or repeated half chapters through notice review', async t => {
  for(const title of ['第4.5章 缺少第四章','第3.5章 重复的半章','第3.25章 非标准小数']) await t.test(title,async t=>{
    const f=await fixture(t); await f.bind();
    f.state.count=6; f.state.titles[6]='第3.5章 聊天番外';
    assert.equal((await acquire(f.spec,{...f.options,mode:'download'})).readingAdded,1);
    const accepted=fs.readFileSync(f.file);
    f.state.count=7; f.state.titles[7]=title;
    const blocked=await acquire(f.spec,{...f.options,mode:'download'});
    assert.equal(blocked.exportFile,null); assert.match(blocked.failures[0].error,/章号不连续/);
    assert.deepEqual(fs.readFileSync(f.file),accepted);
    const c=f.raw(7);
    assert.throws(()=>recordReadingNoticeReview(f.dir,f.spec,extractionHash(f.spec),f.options.outputDir,{link:c.link,contentHash:hash(c.content),reason:'不得当作无章号公告'}),/正文章号/);
  });
});

test('reviewed new numbering defects require independent consecutive titles and all three unchanged bodies',async t=>{
  const f=await fixture(t);await f.bind();const original=fs.readFileSync(f.file),old=readJson(f.file);
  Object.assign(f.state.titles,{6:'第4章 前奏',7:'第4章 重号正篇',8:'第5章 收束'});f.state.count=8;
  assert.equal((await acquire(f.spec,{...f.options,mode:'download'})).exportFile,null);
  const titles=['第4章 前奏','第5章 重号正篇','第6章 收束'],bodyFile=path.join(f.options.stateDir,'publisher.html');
  const evidence='<h1>测试书</h1><b>甲作者</b>'+titles.map(x=>`<p>${x}</p>`).join('');fs.writeFileSync(bodyFile,evidence);
  const review={exportHash:hash(original),links:[6,7,8].map(n=>f.raw(n).link),hashes:[6,7,8].map(n=>hash(f.raw(n).content)),reason:'核对独立目录，三个同名完整章节连续；保留来源重号与原文',reference:{url:'https://publisher.example/book',bodyFile,hash:hash(evidence),chapters:titles}};
  const record=r=>reviewReadingNumbering(f.spec,r,f.options);
  for(const bad of [{...review,exportHash:'stale'},{...review,links:[review.links[0],review.links[2],review.links[1]]},{...review,hashes:['stale',...review.hashes.slice(1)]},{...review,reference:{...review.reference,chapters:['第4章 前奏','第6章 重号正篇','第7章 收束']}},{...review,reference:{...review.reference,url:f.spec.sourceUrl}}]){
    await assert.rejects(record(bad));assert.deepEqual(fs.readFileSync(f.file),original);
  }
  const decision=await record(review);assert.deepEqual(fs.readFileSync(f.file),original);
  for(const n of [6,7,8]){
    const file=path.join(f.dir,'chapters',hash(f.raw(n).link)+'.json'),saved=readJson(file),changed={...saved.chapter,content:saved.chapter.content+'变化'};
    atomicWrite(file,{...saved,chapter:changed,hash:hash(changed)});
    assert.equal((await acquire(f.spec,{...f.options,mode:'download'})).exportFile,null);assert.deepEqual(fs.readFileSync(f.file),original);
    atomicWrite(file,saved);
  }
  const savedEvidence=path.join(f.dir,'reading-numbering-evidence',decision.reference.hash+'.bin');fs.writeFileSync(savedEvidence,'changed');
  assert.equal((await acquire(f.spec,{...f.options,mode:'download'})).exportFile,null);assert.deepEqual(fs.readFileSync(f.file),original);fs.writeFileSync(savedEvidence,evidence);
  const result=await acquire(f.spec,{...f.options,mode:'download'});
  assert.equal(result.readingAdded,3,JSON.stringify(result.failures));assert.equal(result.acceptedSourceNumbering.length,1);
  assert.deepEqual(readJson(f.file).chapters.slice(0,old.chapters.length),old.chapters);
  assert.deepEqual(readJson(f.file).chapters.slice(-3).map(c=>c.title),[6,7,8].map(n=>f.state.titles[n]));
  assert.equal((await acquire(f.spec,{...f.options,mode:'download'})).reusedExport,true);
});

test('a proven boundary numbering error pins the old final chapter and preserves its complete edition',async t=>{
  const f=await fixture(t,{sourceOrder:true,fullCatalog:true,titles:{1:'第1章 开始',2:'第2章 经过',3:'第1章 开始',4:'第3章 转折',5:'第4章 后续'}});
  const book={...f.book,chapters:[1,2,4,5].map((n,i)=>({...formatChapterForExport(f.raw(n)),chapter_number:i+1,sourceChapterNumber:n,sourceChapterUrl:f.raw(n).link}))};
  atomicWrite(f.file,book);
  await bindReadingEdition(f.spec,f.file,{...f.options,sourceOrderReview:{catalogHash:hash(readJson(path.join(f.dir,'catalog.json'))),reason:'仅移出已核实重复项',pairs:[{omit:3,keep:1,omitHash:hash(f.raw(3).content),keepHash:hash(f.raw(1).content),reason:'全文相同'}]}});
  const original=fs.readFileSync(f.file);
  Object.assign(f.state.titles,{6:'第6章 新章',7:'第7章 收束'});f.state.count=7;
  assert.equal((await acquire(f.spec,{...f.options,mode:'download'})).exportFile,null);
  const titles=['第4章 后续','第5章 新章','第6章 收束'],bodyFile=path.join(f.options.stateDir,'publisher.html'),evidence='测试书 甲作者 '+titles.join(' ');fs.writeFileSync(bodyFile,evidence);
  const review={exportHash:hash(original),boundary:{chapterHash:hash(book.chapters.at(-1))},links:[5,6,7].map(n=>f.raw(n).link),hashes:[5,6,7].map(n=>hash(f.raw(n).content)),reason:'独立目录证明边界三个同名章节连续，保留原题原文',reference:{url:'https://publisher.example/book',bodyFile,hash:hash(evidence),chapters:titles}};
  for(const bad of [{...review,boundary:undefined},{...review,boundary:{chapterHash:'stale'}},{...review,exportHash:'stale'},{...review,hashes:['stale',...review.hashes.slice(1)]},{...review,links:[f.raw(4).link,...review.links.slice(1)]},{...review,reference:{...review.reference,chapters:['第4章 后续','第6章 新章','第7章 收束']}}]) {
    await assert.rejects(reviewReadingNumbering(f.spec,bad,f.options));assert.deepEqual(fs.readFileSync(f.file),original);
  }
  const decision=await reviewReadingNumbering(f.spec,review,f.options);
  assert.equal(decision.boundary.chapterHash,hash(book.chapters.at(-1)));
  for(const n of [5,6,7]){
    const file=path.join(f.dir,'chapters',hash(f.raw(n).link)+'.json'),saved=readJson(file),chapter={...saved.chapter,content:saved.chapter.content+'变化'};
    atomicWrite(file,{...saved,chapter,hash:hash(chapter)});
    assert.equal((await acquire(f.spec,{...f.options,mode:'download'})).exportFile,null);assert.deepEqual(fs.readFileSync(f.file),original);atomicWrite(file,saved);
  }
  const result=await acquire(f.spec,{...f.options,mode:'download'});
  assert.equal(result.readingAdded,2,JSON.stringify(result.failures));
  assert.deepEqual(readJson(f.file).chapters.slice(0,book.chapters.length),book.chapters);
  assert.deepEqual(readJson(f.file).chapters.slice(-2).map(c=>c.title),['第6章 新章','第7章 收束']);
  assert.equal((await acquire(f.spec,{...f.options,mode:'download'})).reusedExport,true);
});

test('the latest chapter may retain a proven numbering defect only with its complete preceding window',async t=>{
  const f=await fixture(t);await f.bind();const original=fs.readFileSync(f.file);
  Object.assign(f.state.titles,{6:'第4章 前奏',7:'第5章 经过',8:'第5章 末章'});f.state.count=8;
  assert.equal((await acquire(f.spec,{...f.options,mode:'download'})).exportFile,null);
  const titles=['4、前奏','5、经过','6、末章'],bodyFile=path.join(f.options.stateDir,'publisher.html'),evidence='测试书 甲作者 '+titles.join(' ');fs.writeFileSync(bodyFile,evidence);
  const review={exportHash:hash(original),links:[6,7,8].map(n=>f.raw(n).link),hashes:[6,7,8].map(n=>hash(f.raw(n).content)),reason:'独立目录证明最新三章同名顺序连续，原始标题保留',reference:{url:'https://publisher.example/book',bodyFile,hash:hash(evidence),chapters:titles}};
  assert.equal((await reviewReadingNumbering(f.spec,review,f.options)).anomalyIndex,2);
  const result=await acquire(f.spec,{...f.options,mode:'download'});assert.equal(result.readingAdded,3,JSON.stringify(result.failures));
  assert.deepEqual(readJson(f.file).chapters.slice(0,3),JSON.parse(original).chapters);
  assert.equal(readJson(f.file).chapters.at(-1).title,'第5章 末章');
});

test('reviewed final-number corrections preserve old prose and reject body changes, new gaps and damaged evidence', async t => {
  const f = await fixture(t, {sourceOrder:true,fullCatalog:true,titles:{1:'第1章 开始',2:'第2章 经过',3:'第1章 开始',4:'第3章 转折',5:'第4章 后续'}});
  const book={...f.book,chapters:[1,2,4,5].map((n,i)=>({...formatChapterForExport(f.raw(n)),chapter_number:i+1,sourceChapterNumber:n,sourceChapterUrl:f.raw(n).link}))};
  atomicWrite(f.file,book);
  await bindReadingEdition(f.spec,f.file,{...f.options,sourceOrderReview:{catalogHash:hash(readJson(path.join(f.dir,'catalog.json'))),reason:'仅移出已核实重复项',pairs:[{omit:3,keep:1,omitHash:hash(f.raw(3).content),keepHash:hash(f.raw(1).content),reason:'全文相同'}]}});
  f.state.count=8; Object.assign(f.state.titles,{6:'第5章 前奏',7:'第6章 经过',8:'第6章 末章'});
  const before=fs.readFileSync(f.file);
  assert.equal((await acquire(f.spec,{...f.options,mode:'download'})).exportFile,null);
  const titles=['5、前奏','6、经过','7、末章'],bodyFile=path.join(f.options.stateDir,'publisher.html'),evidence='测试书 甲作者 '+titles.join(' ');
  fs.writeFileSync(bodyFile,evidence);
  await reviewReadingNumbering(f.spec,{exportHash:hash(before),links:[6,7,8].map(n=>f.raw(n).link),hashes:[6,7,8].map(n=>hash(f.raw(n).content)),reason:'独立目录核实末章重号',reference:{url:'https://publisher.example/book',bodyFile,hash:hash(evidence),chapters:titles}},f.options);
  assert.equal((await acquire(f.spec,{...f.options,mode:'download'})).readingAdded,3);
  const accepted=fs.readFileSync(f.file),checkpoint=fs.readFileSync(path.join(f.dir,'chapters',hash(f.raw(8).link)+'.json'));
  f.state.titles[8]='第7章 末章';
  assert.equal((await acquire(f.spec,{...f.options,mode:'download'})).exportFile,null);
  const review={exportHash:hash(accepted),link:f.raw(8).link,title:f.state.titles[8],reason:'来源仅修正末章编号，全文一致'};
  await assert.rejects(reviewReadingCatalogNumber(f.spec,{...review,exportHash:'stale'},f.options),/哈希/);
  await assert.rejects(reviewReadingCatalogNumber(f.spec,{...review,title:'第99章 末章'},f.options),/末章/);
  f.state.bodies[8]='改变了情节和完整正文。'.repeat(100);
  await assert.rejects(reviewReadingCatalogNumber(f.spec,review,f.options),/正文变化/);
  delete f.state.bodies[8];
  const decision=await reviewReadingCatalogNumber(f.spec,review,f.options);
  assert.equal(decision.title,'第7章 末章');
  assert.deepEqual(fs.readFileSync(f.file),accepted);
  assert.deepEqual(fs.readFileSync(path.join(f.dir,'chapters',hash(f.raw(8).link)+'.json')),checkpoint);
  f.state.count=9; f.state.titles[9]='第8章 新章';
  const updated=await acquire(f.spec,{...f.options,mode:'download'});
  assert.equal(updated.readingAdded,1,JSON.stringify(updated.failures));
  assert.deepEqual(readJson(f.file).chapters.slice(0,7),JSON.parse(accepted).chapters);
  assert.equal(readJson(f.file).chapters.at(-1).title,'第8章 新章');
  const final=fs.readFileSync(f.file);
  f.state.count=10; f.state.titles[10]='第10章 缺少第九章';
  const blocked=await acquire(f.spec,{...f.options,mode:'download'});
  assert.match(blocked.failures[0].error,/章号不连续/);assert.deepEqual(fs.readFileSync(f.file),final);
  fs.writeFileSync(path.join(f.dir,'reading-catalog-evidence',decision.evidence[0].hash+'.bin'),'changed');
  assert.match((await acquire(f.spec,{...f.options,mode:'download'})).failures[0].error,/原始证据/);
  assert.deepEqual(fs.readFileSync(f.file),final);
});

test('title mismatch review pins exact retained text and blocks unreviewed or changed source titles', async t => {
  const f = await fixture(t, {sourceOrder: true});
  f.state.bodyTitles[4] = '第2章 正文页的原名';
  await acquire(f.spec, {...f.options, mode: 'download', refresh: true});
  const book = {...f.book, chapters: [1,2,4,5].map((n,i) => ({...formatChapterForExport(f.raw(n)), chapter_number:i+1, sourceChapterNumber:n, sourceChapterUrl:f.raw(n).link}))};
  atomicWrite(f.file, book);
  const chapter = f.raw(4), item = {position:4, link:chapter.link, title:chapter.title, catalogTitle:chapter.catalogTitle, contentHash:hash(chapter.content), reason:'已逐项核对正文页标题和原始顺序', evidence:{url:chapter.link, checkedAt:new Date().toISOString(), detail:'目录旧名与正文页原名有差异，保留两者及完整正文'}};
  const review = {catalogHash:hash(readJson(path.join(f.dir,'catalog.json'))), reason:'核实目录旧名和重复项', pairs:[{omit:3,keep:1,omitHash:hash(f.raw(3).content),keepHash:hash(f.raw(1).content),reason:'完整正文相同'}], titleMappings:[item]};
  const bind = r => bindReadingEdition(f.spec,f.file,{...f.options,sourceOrderReview:r});
  await assert.rejects(bind({...review,titleMappings:[]}), /title-mismatch/);
  for (const bad of [{...item,contentHash:'stale'}, {...item,title:'其他标题'}, {...item,evidence:{}}, {...item,position:3}]) await assert.rejects(bind({...review,titleMappings:[bad]}));
  await bind(review);
  assert.deepEqual(readJson(f.file),book);
  const previous = readJson(path.join(f.dir,'catalog.json')), state = readJson(f.binding).value;
  const corrected = previous.map((entry,i)=>i===3?{...entry,title:item.title}:entry);
  assert.deepEqual(preserveReviewedCatalogLabels(corrected,previous,f.dir,state),previous);
  for (const change of [{title:'另一章'}, {link:f.base+'/reused.html'}, {chapter_number:99}]) {
    const unsafe=corrected.map((entry,i)=>i===3?{...entry,...change}:entry);
    assert.deepEqual(preserveReviewedCatalogLabels(unsafe,previous,f.dir,state)[3],unsafe[3]);
  }
  assert.deepEqual(preserveReviewedCatalogLabels(corrected,previous,f.dir,{...state,sourceOrderReview:{pairs:[]}}),corrected);
  assert.deepEqual(fs.readFileSync(f.file),Buffer.from(JSON.stringify(book,null,2)+'\n'));
  assert.equal((await acquire(f.spec,{...f.options,mode:'download'})).structuralPass,true);
  f.state.count=6; f.state.titles[6]='第3章 新章目录'; f.state.bodyTitles[6]='第3章 新章异名';
  const blocked=await acquire(f.spec,{...f.options,mode:'download'});
  assert.equal(blocked.exportFile,null); assert.deepEqual(readJson(f.file),book);
  const changedChapter = {...f.raw(4), title:'第2章 又一次变化'};
  atomicWrite(path.join(f.dir,'chapters',hash(changedChapter.link)+'.json'), {chapter:changedChapter,hash:hash(changedChapter)});
  assert.throws(()=>preserveReviewedCatalogLabels(corrected,previous,f.dir,state),/正文或映射/);
  const changed=await acquire(f.spec,{...f.options,mode:'download'});
  assert.equal(changed.exportFile,null); assert.deepEqual(readJson(f.file),book);
});

test('source gaps require pinned evidence, preserve raw text and never report source completeness', async t => {
  const f = await fixture(t, {sourceOrder: true});
  f.state.bodies[4] = '出于版权保护，本章暂不支持网页阅读';
  await acquire(f.spec, {...f.options, mode: 'download', refresh: true});
  const rawReport = readJson(path.join(f.dir, 'download-report.json'));
  assert.ok(rawReport.issues.some(i => i.code === 'placeholder' && i.chapter === 4));
  assert.equal(rawReport.exportFile, null);
  const book = {...f.book, chapters: [1,2,5].map((n,i) => ({...formatChapterForExport(f.raw(n)), chapter_number: i+1, sourceChapterNumber: n, sourceChapterUrl: f.raw(n).link}))};
  atomicWrite(f.file, book);
  const review = {catalogHash: hash(readJson(path.join(f.dir, 'catalog.json'))), reason: '核实原文重复和缺文提示，保留其他章节顺序。', pairs: [{omit: 3, keep: 1, omitHash: hash(f.raw(3).content), keepHash: hash(f.raw(1).content), reason: '完整正文相同'}], gaps: [{position: 4, link: f.raw(4).link, contentHash: hash(f.raw(4).content), kind: 'placeholder', reason: '只有缺文提示', evidence: {url: f.raw(4).link, checkedAt: new Date().toISOString(), detail: '源页仅含提示'}}]};
  const bind = r => bindReadingEdition(f.spec, f.file, {...f.options, sourceOrderReview:r});
  for (const gap of [{...review.gaps[0],contentHash:'wrong'}, {...review.gaps[0],evidence:{}}, {...review.gaps[0],kind:'unknown'}, {...review.gaps[0],kind:'truncated',actualCharacters:1,expectedCharacters:3000}]) await assert.rejects(bind({...review,gaps:[gap]}));
  await assert.rejects(bind({...review,gaps:[]}), /不得遗漏/);
  await bind(review);
  const report = await acquire(f.spec, {...f.options, mode:'download'});
  assert.equal(report.structuralPass,true,JSON.stringify(report.failures)); assert.equal(report.completeAgainstSource,false);
  assert.equal(report.completeSelectedScope,true); assert.equal(report.sourceGaps.length,1);
  assert.deepEqual(readJson(f.file),book); assert.equal(f.raw(4).content,f.state.bodies[4]);
  f.state.count = 6; f.state.titles[6] = '第3章 新增缺文'; f.state.bodies[6] = '请到手机端QQAPP查看本章';
  const blocked = await acquire(f.spec, {...f.options, mode:'download'});
  assert.equal(blocked.exportFile,null); assert.equal(blocked.structuralPass,false); assert.deepEqual(readJson(f.file),book);
});

test('reviewed truncated tail cannot silently skip a hole on the next update', async t => {
  const f = await fixture(t, {sourceOrder:true});
  const book = {...f.book,chapters:[1,2,4].map((n,i)=>({...formatChapterForExport(f.raw(n)),chapter_number:i+1,sourceChapterNumber:n,sourceChapterUrl:f.raw(n).link}))};
  atomicWrite(f.file,book);
  const gap={position:5,link:f.raw(5).link,contentHash:hash(f.raw(5).content),kind:'truncated',actualCharacters:f.raw(5).content.replace(/\s/gu,'').length,expectedCharacters:3000,reason:'完整分页仍显著少于独立字数证据',evidence:{url:f.base+'/original-catalog',checkedAt:new Date().toISOString(),detail:'独立目录字数3000'}};
  const review={catalogHash:hash(readJson(path.join(f.dir,'catalog.json'))),reason:'仅保留核实可读部分',pairs:[{omit:3,keep:1,omitHash:hash(f.raw(3).content),keepHash:hash(f.raw(1).content),reason:'相同正文'}],gaps:[gap]};
  await assert.rejects(bindReadingEdition(f.spec,f.file,{...f.options,sourceOrderReview:{...review,gaps:[{...gap,expectedCharacters:800}]}}),/实际字数/);
  await bindReadingEdition(f.spec,f.file,{...f.options,sourceOrderReview:review});
  assert.equal((await acquire(f.spec,{...f.options,mode:'download'})).completeSelectedScope,true);
  f.state.count=6; f.state.titles[6]='第4章 新增章节';
  const report=await acquire(f.spec,{...f.options,mode:'download'});
  assert.equal(report.exportFile,null); assert.match(report.failures[0].error,/章号不连续/); assert.deepEqual(readJson(f.file),book);
});

test('a consecutive explicitly reviewed old tail gap stays missing while new complete chapters append safely', async t => {
  const f = await fixture(t, {sourceOrder:true, titles:{2:'第2章 场景2',4:'第3章 场景4',5:'第4章 已核实缺文'}});
  const book = {...f.book,chapters:[1,2,4].map((n,i)=>({...formatChapterForExport(f.raw(n)),chapter_number:i+1,sourceChapterNumber:n,sourceChapterUrl:f.raw(n).link}))};
  atomicWrite(f.file,book);
  const gap={position:5,link:f.raw(5).link,contentHash:hash(f.raw(5).content),kind:'truncated',actualCharacters:f.raw(5).content.replace(/\s/gu,'').length,expectedCharacters:3000,reason:'全部分页仍显著缺文',evidence:{url:f.base+'/original-catalog',checkedAt:new Date().toISOString(),detail:'独立目录3000字'}};
  const review={catalogHash:hash(readJson(path.join(f.dir,'catalog.json'))),reason:'保留已核实缺口',pairs:[{omit:3,keep:1,omitHash:hash(f.raw(3).content),keepHash:hash(f.raw(1).content),reason:'完整正文相同'}],gaps:[gap]};
  await bindReadingEdition(f.spec,f.file,{...f.options,sourceOrderReview:review});
  f.state.count=6; f.state.titles[6]='第5章 新章节';
  const checkpoint=path.join(f.dir,'chapters',hash(gap.link)+'.json'),saved=readJson(checkpoint),changed={...saved.chapter,content:saved.chapter.content+'变化'};
  atomicWrite(checkpoint,{...saved,chapter:changed,hash:hash(changed)});
  assert.equal((await acquire(f.spec,{...f.options,mode:'download'})).exportFile,null); assert.deepEqual(readJson(f.file),book);
  atomicWrite(checkpoint,saved);
  const report=await acquire(f.spec,{...f.options,mode:'download'});
  assert.equal(report.readingAdded,1,JSON.stringify(report.failures)); assert.equal(report.structuralPass,true); assert.equal(report.completeSelectedScope,true);
  assert.equal(report.completeAgainstSource,false); assert.equal(report.sourceGaps.length,1);
  const next=readJson(f.file); assert.deepEqual(next.chapters.slice(0,book.chapters.length),book.chapters); assert.equal(next.chapters.at(-1).title,'第5章 新章节');
  f.state.count=7;f.state.titles[7]='第7章 未核实缺章';
  const blocked=await acquire(f.spec,{...f.options,mode:'download'}); assert.equal(blocked.exportFile,null); assert.deepEqual(readJson(f.file),next);
});

test('reviewed tail gaps may surround a preserved old notice without discarding or duplicating it', async t => {
  const f = await fixture(t, {sourceOrder:true,titles:{2:'第2章 场景2',4:'第3章 场景4',5:'第4章 缺文'}});
  f.state.count=7;f.state.titles[6]='公告';f.state.titles[7]='第5章 缺文';
  await acquire(f.spec,{...f.options,mode:'download'});
  const book={...f.book,chapters:[1,2,4,6].map((n,i)=>({...formatChapterForExport(f.raw(n)),chapter_number:i+1,sourceChapterNumber:n,sourceChapterUrl:f.raw(n).link}))};atomicWrite(f.file,book);
  const gaps=[5,7].map(n=>({position:n,link:f.raw(n).link,contentHash:hash(f.raw(n).content),kind:'truncated',actualCharacters:f.raw(n).content.replace(/\s/gu,'').length,expectedCharacters:3000,reason:'分页完整仍缺文',evidence:{url:f.base+'/independent',checkedAt:new Date().toISOString(),detail:'独立目录字数3000'}}));
  const review={catalogHash:hash(readJson(path.join(f.dir,'catalog.json'))),reason:'缺文与公告均已逐项核实',pairs:[{omit:3,keep:1,omitHash:hash(f.raw(3).content),keepHash:hash(f.raw(1).content),reason:'完全重复'}],gaps};
  await bindReadingEdition(f.spec,f.file,{...f.options,sourceOrderReview:review});
  f.state.count=8;f.state.titles[8]='第6章 完整新章';
  const report=await acquire(f.spec,{...f.options,mode:'download'});
  assert.equal(report.readingAdded,1,JSON.stringify(report.failures));assert.equal(report.sourceGaps.length,2);assert.equal(report.completeAgainstSource,false);
  assert.deepEqual(readJson(f.file).chapters.slice(0,4),book.chapters);
});

test('bound updates preserve reviewed order, bypass only pinned source errors, and append after restart', async t => {
  const f = await fixture(t);
  const original = fs.readFileSync(f.file), mtime = fs.statSync(f.file).mtimeMs;
  assert.equal((await f.bind()).readingEntries, 3);
  assert.equal(localBookState(f.spec, f.options).state, 'complete');
  assert.match(localBookState(f.spec, f.options).message, /自动沿用/);
  const probe = await acquire(f.spec, {...f.options, mode: 'probe'});
  assert.equal(probe.structuralPass, true); assert.equal(probe.readingEdition, true);
  assert.ok(readJson(probe.rawReportFile).errors >= 2);
  f.state.requests = [];
  const unchanged = await acquire(f.spec, {...f.options, mode: 'download'});
  assert.equal(unchanged.reusedExport, true); assert.equal(unchanged.expected, 3); assert.equal(unchanged.sourceExpected, 5);
  assert.equal(fs.statSync(f.file).mtimeMs, mtime); assert.deepEqual(fs.readFileSync(f.file), original);
  assert.deepEqual(f.state.requests, ['/book/A.html']);
  for (const count of [6,7]) {
    f.state.count = count;
    f.state.requests = [];
    assert.equal((await acquire(f.spec, {...f.options, mode: 'probe'})).structuralPass, true);
    const update = await acquire(f.spec, {...f.options, mode: 'download'});
    assert.equal(update.errors, 0); assert.equal(update.readingAdded, 1); assert.equal(update.expected, count - 2);
    assert.deepEqual(f.state.requests, ['/book/A.html', f.chapterPath(count), '/book/A.html']);
    const book = readJson(f.file);
    assert.deepEqual(book.chapters.slice(0,3), f.book.chapters);
    assert.equal(book.chapters.at(-1).sourceChapterNumber, count);
    assert.equal(book.chapters.at(-1).chapter_number, count - 2);
    // Loading solely from disk is the same path used by a newly launched worker.
    assert.equal(loadReadingEdition(f.dir, f.spec, extractionHash(f.spec), f.options.outputDir).sources.length, count);
  }
  assert.ok(!readJson(path.join(f.options.stateDir, 'sources.json')).sites['127.0.0.1'].verifiedBooks);
  assert.equal(readJson(path.join(f.dir, 'partial.json')).chapters.length, 7);
});

test('adoption rejects unrelated books, altered text and unsafe output destinations', async t => {
  const f = await fixture(t);
  for (const book of [{...f.book, author: '乙作者'}, {...f.book, sourceUrl: f.base + '/book/B.html'}, {...f.book, chapters: f.book.chapters.map((c, i) => i ? c : {...c, content: c.content + '改动'})}]) {
    atomicWrite(f.file, book);
    await assert.rejects(f.bind());
    assert.equal(fs.existsSync(f.binding), false);
  }
  atomicWrite(f.file, f.book);
  await assert.rejects(bindReadingEdition(f.spec, f.file, {...f.options, outputDir: f.dir}), /输出目录/);
  await f.bind();
  await assert.rejects(f.bind(), /已绑定/);
  await assert.rejects(acquire({...f.spec, variant: 'v2'}, {...f.options, mode: 'download'}), /另一版本规则/);
  assert.match(localBookState({...f.spec, variant: 'v2'}, f.options).message, /另一版本规则/);
  assert.throws(() => loadReadingEdition(f.dir, {...f.spec, variant: 'v2'}, extractionHash(f.spec), f.options.outputDir), /不匹配/);
  const value = readJson(f.binding).value;
  value.file = '../escape.json'; atomicWrite(f.binding, {hash: hash(value), value});
  assert.throws(() => loadReadingEdition(f.dir, f.spec, extractionHash(f.spec), f.options.outputDir), /文件名无效/);
});

test('new duplicates, near duplicates, garbling and numbering jumps never change the accepted edition', async t => {
  const f = await fixture(t); await f.bind();
  const originalFile = fs.readFileSync(f.file), originalBinding = fs.readFileSync(f.binding);
  for (const scenario of ['duplicate', 'similar', 'mojibake', 'order', 'unknown-extra']) {
    f.state.count = 6; f.state.bodies = {}; f.state.titles = {};
    if (scenario === 'duplicate') f.state.bodies[6] = f.raw(1).content;
    if (scenario === 'similar') f.state.bodies[6] = f.raw(1).content.slice(0,-1) + '改';
    if (scenario === 'mojibake') f.state.bodies[6] = '銆锛鈥鐨勬姹熸'.repeat(100);
    if (scenario === 'order') f.state.titles[6] = '第99章 跳号';
    if (scenario === 'unknown-extra') f.state.titles[6] = '无章号正文';
    // Each scenario starts at the same last accepted checkpoint.
    const file = path.join(f.dir, 'chapters', hash(f.base + f.chapterPath(6)) + '.json');
    if (fs.existsSync(file)) fs.unlinkSync(file);
    atomicWrite(path.join(f.dir, 'catalog.json'), readJson(path.join(f.dir, 'catalog.json')).slice(0,5));
    const result = await acquire(f.spec, {...f.options, mode: 'download'});
    assert.equal(result.exportFile, null, scenario); assert.equal(result.structuralPass, false, scenario);
    assert.deepEqual(fs.readFileSync(f.file), originalFile); assert.deepEqual(fs.readFileSync(f.binding), originalBinding);
  }
});

test('incomplete and paused updates do not advance the mapping; missing output restores from the accepted snapshot', async t => {
  const f = await fixture(t); await f.bind();
  const original = fs.readFileSync(f.binding);
  f.state.count = 7;
  const partial = await acquire(f.spec, {...f.options, mode: 'download', maxNew: 1});
  assert.equal(partial.exportFile, null); assert.deepEqual(fs.readFileSync(f.binding), original);
  const paused = await acquire(f.spec, {...f.options, mode: 'download', shouldStop: () => true});
  assert.equal(paused.paused, true); assert.equal(paused.exportFile, null); assert.deepEqual(fs.readFileSync(f.binding), original);
  const complete = await acquire(f.spec, {...f.options, mode: 'download'});
  assert.equal(complete.readingAdded, 2);
  const accepted = fs.readFileSync(f.file); fs.unlinkSync(f.file);
  assert.equal(localBookState(f.spec, f.options).state, 'partial');
  assert.equal((await acquire(f.spec, {...f.options, mode: 'download'})).exportFile, f.file);
  assert.deepEqual(fs.readFileSync(f.file), accepted);
});

test('changed raw checkpoints and manually edited exports are protected, including during a pending recovery', async t => {
  const f = await fixture(t); await f.bind();
  const original = fs.readFileSync(f.file), binding = fs.readFileSync(f.binding);
  const checkpoint = path.join(f.dir, 'chapters', hash(f.raw(4).link) + '.json');
  const saved = fs.readFileSync(checkpoint), chapter = f.raw(4);
  chapter.content += '改变'; atomicWrite(checkpoint, {hash: hash(chapter), chapter});
  const result = await acquire(f.spec, {...f.options, mode: 'download'});
  assert.equal(result.exportFile, null); assert.match(result.failures[0].error, /发生变化/);
  assert.deepEqual(fs.readFileSync(f.file), original);
  fs.writeFileSync(checkpoint, saved);
  const previous = readJson(f.binding).value;
  const nextBook = {...previous.book, description: '新简介'};
  const next = {...previous, revision: 2, book: nextBook, exportHash: hash(JSON.stringify(nextBook, null, 2) + '\n')};
  const pending = {previousStateHash: hash(previous), next};
  atomicWrite(path.join(f.dir, 'reading-edition-pending.json'), {hash: hash(pending), value: pending});
  fs.writeFileSync(f.file, '用户编辑');
  await assert.rejects(acquire(f.spec, {...f.options, mode: 'download'}), /被修改|被其他程序修改/);
  assert.equal(fs.readFileSync(f.file, 'utf8'), '用户编辑'); assert.deepEqual(fs.readFileSync(f.binding), binding);
  // Simulate interruption after the output rename but before the state rename.
  atomicWrite(f.file, nextBook);
  const restored = loadReadingEdition(f.dir, f.spec, extractionHash(f.spec), f.options.outputDir, {resume: true});
  assert.equal(restored.revision, 2); assert.equal(fs.existsSync(path.join(f.dir, 'reading-edition-pending.json')), false);
  assert.equal(readJson(f.file).description, '新简介');
  fs.writeFileSync(f.binding, '{}');
  await assert.rejects(acquire(f.spec, {...f.options, mode: 'download'}), /来源映射/);
});

test('the desktop Check updates flow automatically uses the binding and retains its report after reopening', async t => {
  const f = await fixture(t); await f.bind(); f.state.count = 6;
  const book = {title: f.spec.title, author: f.spec.author, url: f.spec.sourceUrl, site: '测试来源'};
  const sitesDirectory = path.join(f.options.stateDir, 'sites'); fs.mkdirSync(sitesDirectory);
  const settings = {...f.options, sitesDirectory, findBooks: async () => [book], prepareBook: async () => f.spec};
  let app = await createDesktop(settings);
  t.after(async () => { if (app) await app.close(); });
  const api = async (route, input) => {
    const response = await fetch(app.baseUrl + '/api/' + route, {method: input ? 'POST' : 'GET', headers: {'x-desktop-token': app.token, 'Content-Type': 'application/json'}, ...(input ? {body: JSON.stringify(input)} : {})});
    const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result;
  };
  await api('search', {website: 'https://books.example/', title: book.title});
  await api('start', {url: book.url});
  const deadline = Date.now() + 15000;
  while (!['complete','error'].includes(app.state().phase) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(app.state().phase, 'complete', app.state().message);
  assert.match(app.state().message, /已沿用来源映射/);
  assert.equal(app.state().report.readingAdded, 1); assert.equal(app.state().report.expected, 4);
  assert.equal(app.state().report.sourceExpected, 6);
  await app.close(); app = null;
  const previousTask = readJson(path.join(f.options.stateDir, 'desktop-last-task.json'));
  delete previousTask.report.readingEdition;
  delete previousTask.report.sourceExpected;
  atomicWrite(path.join(f.options.stateDir, 'desktop-last-task.json'), previousTask);
  app = await createDesktop(settings);
  const restored = await api('state');
  assert.equal(restored.task.report.readingEdition, true); assert.equal(restored.task.report.expected, 4);
  await api('search', {website: 'https://books.example/', title: book.title});
  await api('start', {url: book.url});
  while (!['complete','error'].includes(app.state().phase) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(app.state().phase, 'complete', app.state().message); assert.equal(app.state().report.readingAdded, 0); assert.equal(app.state().report.reusedExport, true);
});
