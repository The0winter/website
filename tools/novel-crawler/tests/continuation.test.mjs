import '../../test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import puppeteer from 'puppeteer';
import {acquire, localBookState, validateSpec, extractionHash} from '../core.mjs';
import {continuationKey, continuationState, recoverContinuation, recordContinuationReview, recordContinuationAnchorReview, recordContinuationNoticeReview, recordContinuationPartPolicy, chapterPartIdentity, createContinuationReviewer, bindReviewedCompletedSource, recordContinuationNumberReset, recordContinuationNumberCorrection, recordContinuationSourceDefect} from '../continuation.mjs';
import {atomicWrite, readJson, hash, acquireLock} from '../storage.mjs';
import {createDesktop} from '../desktop/server.mjs';
import {loadSites, parseSearch} from '../desktop/sources.mjs';
import {migrateContinuationRules} from '../continuation-migration.mjs';
import {repairContinuationDuplicates} from '../continuation-repair.mjs';
import {recordContinuationSourceGap} from '../continuation.mjs';
import {reviewContinuationCatalogNotice} from '../continuation-catalog-review.mjs';
import {chapterIdentity} from '../continuation.mjs';

const body = n => Array.from({length: 180}, (_, i) => String.fromCodePoint(0x4e00 + n * 200 + i)).join('').repeat(4);
const title = n => `第${n}章 山间故事${n}`;
async function fixture(t) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-continuation-')), outputDir = path.join(stateDir, 'out');
  const state = {count: 6, requests: [], bodies: {}, titles: {}, headings: {}, order: null, notice: false, author: '甲作者'};
  const server = http.createServer((req, res) => {
    state.requests.push(req.url);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (req.url.endsWith('/book')) {
      const prefix = req.url.slice(0, -5), numbers = state.order || Array.from({length: state.count}, (_, i) => i + 1);
      return res.end(`<h1>换源测试书</h1><b>${state.author}</b>${state.status ? `<i>${state.status}</i>` : ''}<nav>${numbers.map(n => `<a href="${prefix}/c/${n}">${state.titles[n] || title(n)}</a>`).join('')}${state.notice ? `<a href="${prefix}/notice">2026一月月票抽奖活动！</a>` : ''}</nav>`);
    }
    if (req.url.endsWith('/notice')) return res.end('<h1>2026一月月票抽奖活动！</h1><article>感谢各位读者支持本书。月票抽奖活动开始了。</article>');
    const n = Number(req.url.split('/').at(-1));
    if (n === state.unavailable) { res.statusCode = 503; return res.end('temporarily unavailable'); }
    res.end(`<h1>${state.headings[n] || state.titles[n] || title(n)}</h1><article>${state.bodies[n] || body(n)}</article>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(stateDir), os.tmpdir()); assert.ok(path.basename(stateDir).startsWith('novel-continuation-'));
    fs.rmSync(stateDir, {recursive: true, force: true});
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const spec = validateSpec({version: 1, kind: 'html', variant: 'new-v1', title: '换源测试书', author: '甲作者', sourceUrl: base + '/new/book', metadata: {title: 'h1', author: 'b'}, catalog: {links: 'nav a'}, chapter: {title: 'h1', content: 'article'}, delayMs: 200, retries: 0});
  const book = {title: spec.title, author: spec.author, sourceUrl: 'https://old.example/book/7', authorSourceUrl: 'https://old.example/author/1', description: '原来的简介', chapters: Array.from({length: 4}, (_, i) => ({title: title(i + 1), content: body(i + 1), chapter_number: i + 1, link: `https://old.example/c/${i + 1}`}))};
  const file = path.join(outputDir, '换源测试书.json'); atomicWrite(file, book);
  const options = {stateDir, outputDir};
  const choose = () => localBookState(spec, options).continuation;
  const run = (extra = {}) => acquire(spec, {...options, continuation: choose(), mode: 'download', ...extra});
  const dir = path.join(stateDir, 'continuations', continuationKey(spec));
  return {state, spec, book, file, options, choose, run, dir, base};
}

test('digit-by-digit Chinese chapter numbers retain every digit and cannot conceal a gap', async t => {
  assert.equal(chapterIdentity('第一零二五章 你个瓜娃子').number, 1025);
  assert.equal(chapterIdentity('第一〇二六章 衔接').number, 1026);
  assert.equal(chapterIdentity('第一千零二十五章 衔接').number, 1025);
  const f = await fixture(t);
  f.state.titles[5] = '第〇〇五章 第五章';
  f.state.titles[6] = '第一〇〇六章 跳号正文';
  const report = await f.run();
  assert.equal(report.structuralPass, false);
  assert.equal(readJson(f.file).chapters.length, f.book.chapters.length);
});

test('reviewed notice renumbering preserves original chapters and still blocks changed prose and catalogs', async t => {
  const f = await fixture(t);
  f.state.count = 7; f.state.titles[7] = '请假一天'; f.state.bodies[7] = '今日身体不适，请假一天，明日恢复更新。';
  assert.equal((await f.run()).structuralPass, true);
  const original = fs.readFileSync(f.file), book = readJson(f.file);
  const review = {exportHash: hash(original), link: f.base + '/new/c/7', title: '第7章 请假一天', reason: '核对公告全文相同，仅来源增加章号'};
  f.state.titles[7] = review.title;
  assert.equal((await f.run()).structuralPass, false);
  await assert.rejects(reviewContinuationCatalogNotice(f.spec, f.options, {...review, exportHash: 'stale'}));
  await assert.rejects(reviewContinuationCatalogNotice(f.spec, f.options, {...review, title: '第7章 请假一天！'}), /只支持/);
  f.state.bodies[7] += '正文后来修改。';
  await assert.rejects(reviewContinuationCatalogNotice(f.spec, f.options, review), /正文/);
  f.state.bodies[7] = book.chapters.at(-1).content;
  f.state.titles[6] = '第6章 其他正文';
  await assert.rejects(reviewContinuationCatalogNotice(f.spec, f.options, review), /目录/);
  f.state.titles[6] = title(6);
  await reviewContinuationCatalogNotice(f.spec, f.options, review);
  assert.deepEqual(fs.readFileSync(f.file), original);
  assert.equal((await f.run()).structuralPass, true);
  // The newly numbered notice does not consume narrative chapter 7.
  f.state.count = 8; f.state.titles[8] = title(7); f.state.bodies[8] = body(8);
  const updated = await f.run(); assert.equal(updated.structuralPass, true); assert.equal(updated.continuationAdded, 1);
  assert.deepEqual(readJson(f.file).chapters.slice(0, book.chapters.length), book.chapters);
  f.state.count = 9; f.state.titles[9] = '公告'; f.state.bodies[9] = '明天恢复正常更新，谢谢大家支持。';
  assert.equal((await f.run()).structuralPass, true);
  const nextReview = {exportHash: hash(fs.readFileSync(f.file)), link: f.base + '/new/c/9', title: '第8章 公告', reason: '再次核对新的末尾公告'};
  f.state.titles[9] = nextReview.title;
  await reviewContinuationCatalogNotice(f.spec, f.options, nextReview);
  assert.equal((await f.run()).structuralPass, true);
  f.state.titles[7] = '第8章 请假一天';
  assert.equal((await f.run()).structuralPass, false);
  f.state.titles[7] = review.title;
  const binding = readJson(path.join(f.dir, 'binding.json')).value;
  const dir = path.join(f.dir, 'sources', hash([f.spec.sourceUrl, binding.source.extraction]).slice(0,24));
  const evidence = readJson(path.join(dir, 'catalog-notice-reviews.json'));
  evidence.value[0].incoming.content += '损坏证据';
  atomicWrite(path.join(dir, 'catalog-notice-reviews.json'), {...evidence, hash: hash(evidence.value)});
  assert.equal((await f.run()).structuralPass, false);
});

test('reviewed legacy duplicate repair preserves backups, stable ordinals and subsequent update protection', async t => {
  const f = await fixture(t); await f.run();
  const accepted = readJson(f.file), oldBinding = readJson(path.join(f.dir,'binding.json')).value;
  const book = {...accepted, chapters:[accepted.chapters[0], {...accepted.chapters[0],link:f.base+'/legacy-copy',content:accepted.chapters[0].content+'站点提示。'}, ...accepted.chapters.slice(1)].map((c,i)=>({...c,chapter_number:i+1}))};
  atomicWrite(f.file,book);
  const original = fs.readFileSync(f.file), binding = {...oldBinding,count:book.chapters.length,exportHash:hash(original)};
  atomicWrite(path.join(f.dir,'binding.json'),{hash:hash(binding),value:binding});
  const pair = {omit:2,keep:1,omitHash:hash(book.chapters[1]),keepHash:hash(book.chapters[0]),reason:'全文核对，仅重复副本多了站点提示'};
  const review = {exportHash:hash(original),reason:'显式修复历史重复正文，不改写保留项',pairs:[pair]};
  const repair = r => repairContinuationDuplicates(f.spec,f.options,r);
  for (const bad of [ {...review,exportHash:'stale'}, {...review,pairs:[{...pair,omitHash:'stale'}]},
      {...review,pairs:[{...pair,keep:3,keepHash:hash(book.chapters[2])}]}, {...review,pairs:[pair,pair]},
      {...review,pairs:[pair,{...pair,omit:1,keep:2,omitHash:pair.keepHash,keepHash:pair.omitHash}]},
      {...review,pairs:[{...pair,omit:7,omitHash:hash(book.chapters[6])}]} ]) {
    await assert.rejects(repair(bad)); assert.deepEqual(fs.readFileSync(f.file),original);
    assert.deepEqual(readJson(path.join(f.dir,'binding.json')).value,binding);
  }
  const record = await repair(review), repaired = readJson(f.file);
  assert.deepEqual(repaired.chapters,book.chapters.filter(c=>c.chapter_number!==2));
  assert.deepEqual(fs.readFileSync(path.join(record.backup,'book.json')),original);
  assert.deepEqual(readJson(path.join(record.backup,'binding.json')).value,binding);
  const next=readJson(path.join(f.dir,'binding.json')).value;
  const pending={previousBindingHash:hash(binding),previousExportHash:hash(original),next,book:repaired};
  for(const contents of [original,fs.readFileSync(f.file)]) {
    atomicWrite(f.file,contents); atomicWrite(path.join(f.dir,'binding.json'),{hash:hash(binding),value:binding});
    atomicWrite(path.join(f.dir,'pending.json'),{hash:hash(pending),value:pending});
    recoverContinuation(f.spec,f.options);
    assert.deepEqual(readJson(f.file),repaired); assert.equal(fs.existsSync(path.join(f.dir,'pending.json')),false);
  }
  assert.equal(localBookState(f.spec,f.options).state,'complete');
  f.state.count=7;
  const result=await f.run(); assert.equal(result.continuationAdded,1,JSON.stringify(result.failures));
  assert.deepEqual(readJson(f.file).chapters.slice(0,repaired.chapters.length),repaired.chapters);
  assert.equal(readJson(f.file).chapters.at(-1).chapter_number,8);
  assert.equal(readJson(path.join(f.dir,'binding.json')).value.resolutions.filter(x=>x.kind==='repaired-old-duplicate').length,1);
  await assert.rejects(repair(review),/原书已变化/);
  const fileBefore=fs.readFileSync(f.file); fs.appendFileSync(f.file,' ');
  await assert.rejects(repair({...review,exportHash:hash(fs.readFileSync(f.file))}),/原书已变化/);
  assert.deepEqual(fs.readFileSync(f.file),Buffer.concat([fileBefore,Buffer.from(' ')]));
});

async function completedFixture(t) {
  const f = await fixture(t);
  f.spec.metadata.status = 'i'; f.state.status = '已完结'; f.book.status = '完结';
  for (const n of [5, 6]) f.book.chapters.push({chapter_number: n, title: title(n), content: body(n), link: `https://old.example/c/${n}`});
  f.book.chapters.push({chapter_number: 7, title: '同人附录', content: body(30), link: 'https://old.example/extra'});
  for (const n of [4, 5, 6]) f.state.titles[n] = `第${n - 3}章 山间故事${n}`;
  atomicWrite(f.file, f.book);
  const catalog = Array.from({length: 6}, (_, i) => ({title: f.state.titles[i + 1] || title(i + 1), link: f.base + '/new/c/' + (i + 1), sourceOrder: i + 1, chapter_number: i + 1}));
  const review = {file: path.basename(f.file), exportHash: hash(fs.readFileSync(f.file)), catalogHash: hash(catalog), reason: '核对完结来源最后三章，旧书已有全文和额外同人；保留旧顺序及正文。',
    matches: [4, 5, 6].map(n => ({oldNumber: n, newLink: f.base + '/new/c/' + n, oldHash: hash(body(n)), newHash: hash(body(n)), reason: '分卷编号不同，同题完整正文一致。'}))};
  return {...f, review, reviewOptions: {...f.options, extraction: extractionHash(f.spec)}};
}

async function sourceDefectFixture(t) {
  const f = await fixture(t); f.state.count = 8;
  for (const n of [6, 7, 8]) f.state.titles[n] = `第${n + 2}章 山间故事${n}`;
  const report = await f.run({stopOnFailure: false}), sourceDir = path.dirname(report.reportFile);
  const evidenceFile = path.join(f.options.stateDir, 'source-comparison.json'), evidence = JSON.stringify({finding: '来源从5跳到8，完整相邻页面可读；接受源站编号缺陷，保留缺章可能性。'});
  fs.writeFileSync(evidenceFile, evidence);
  return {...f, sourceDir, reviewOptions: {...f.options, extraction: extractionHash(f.spec)}, review: {links: [5, 6, 7].map(n => f.base + '/new/c/' + n), hashes: [5, 6, 7].map(n => hash(body(n))), evidenceFile, evidenceHash: hash(evidence), reason: '比选后接受本来源的5到8编号跳跃，未确认缺失的6/7正文，不生成补文，报告保留缺陷。'}};
}

async function sourceGapFixture(t) {
  const f = await fixture(t); f.state.order = [1, 2, 3, 4, 6, 7];
  // An old trailing notice is not the numbered boundary and must stay intact.
  f.book.chapters.push({chapter_number: 5, title: '月票公告', content: '保留原有公告', link: 'https://old.example/notice'});
  atomicWrite(f.file, f.book);
  const report = await f.run({stopOnFailure: false}), sourceDir = path.dirname(report.reportFile);
  assert.equal(report.exportFile, null);
  const chapters = [4, 5, 6, 7].map(n => ({title: title(n), link: 'https://reference.example/c/' + n}));
  const html = `<title>${f.spec.title}</title><p>${f.spec.author}</p>${chapters.map(c => `<a href="${c.link}">${c.title}</a>`).join('')}`;
  const bodyFile = path.join(f.options.stateDir, 'gap-reference.html'); fs.writeFileSync(bodyFile, html);
  return {...f, sourceDir, html, reviewOptions: {...f.options, extraction: extractionHash(f.spec)}, review: {file: path.basename(f.file), exportHash: hash(fs.readFileSync(f.file)), links: [6, 7].map(n => f.base + '/new/c/' + n), hashes: [6, 7].map(n => hash(body(n))), reference: {url: 'https://reference.example/book', bodyFile, hash: hash(Buffer.from(html)), chapters}, reason: '独立目录核实缺第5章；后续两章正文可读，保留明确缺章记录。'}};
}

test('explicit missing chapter review preserves the old book, never fills a gap and reports it on later updates', async t => {
  const f = await sourceGapFixture(t), original = fs.readFileSync(f.file);
  recordContinuationSourceGap(f.spec, f.reviewOptions, f.review);
  assert.deepEqual(fs.readFileSync(f.file), original);
  const report = await f.run(); assert.equal(report.continuationAdded, 2, JSON.stringify(report.failures));
  assert.equal(report.completeSelectedScope, true); assert.equal(report.structuralPass, true); assert.equal(report.completeAgainstSource, false);
  assert.deepEqual(report.sourceGaps.map(c => c.title), [title(5)]); assert.equal(report.automaticResolutions, 0);
  const book = readJson(f.file); assert.deepEqual(book.chapters.slice(0, 5), f.book.chapters);
  assert.deepEqual(book.chapters.slice(5).map(c => c.content), [body(6), body(7)]);
  f.state.order.push(8);
  const next = await f.run(); assert.equal(next.continuationAdded, 1, JSON.stringify(next.failures));
  assert.equal(next.completeAgainstSource, false); assert.equal(next.sourceGaps.length, 1); assert.equal(next.warnings, 1);
  assert.match(fs.readFileSync(next.summaryFile, 'utf8'), /缺口未补齐：第5章/);
});

test('missing chapter review rejects stale books, body changes, wrong evidence, omitted reference entries and missing following proof', async t => {
  const f = await sourceGapFixture(t), original = fs.readFileSync(f.file);
  const attempt = change => recordContinuationSourceGap(f.spec, f.reviewOptions, {...f.review, ...change});
  assert.throws(() => attempt({exportHash: hash('changed')}), /原书/);
  assert.throws(() => attempt({hashes: [hash('changed'), f.review.hashes[1]]}), /检查点/);
  assert.throws(() => attempt({links: [...f.review.links].reverse()}), /相邻/);
  assert.throws(() => attempt({reference: {...f.review.reference, hash: hash('changed')}}), /证据/);
  assert.throws(() => attempt({reference: {...f.review.reference, chapters: f.review.reference.chapters.slice(1)}}), /证据/);
  const catalogFile = path.join(f.sourceDir, 'catalog.json'), catalog = readJson(catalogFile);
  atomicWrite(catalogFile, [...catalog, {title: title(5), link: f.base + '/new/c/5', chapter_number: 7}]);
  assert.throws(() => attempt({}), /不能跳过已有正文/); atomicWrite(catalogFile, catalog);
  for (const html of [f.html.replace('甲作者', '乙作者'), f.html.replace(title(5), title(15)), f.html.replace('</a>', `</a><a href="https://reference.example/extra">${title(5)}</a>`)]) {
    fs.writeFileSync(f.review.reference.bodyFile, html);
    assert.throws(() => attempt({reference: {...f.review.reference, hash: hash(Buffer.from(html))}}), /独立目录/);
  }
  fs.writeFileSync(f.review.reference.bodyFile, f.html);
  const decision = attempt({});
  for (const link of f.review.links) {
    const file = path.join(f.sourceDir, 'chapters', hash(link) + '.json'), saved = readJson(file), chapter = {...saved.chapter, content: saved.chapter.content + '变化'};
    atomicWrite(file, {...saved, chapter, hash: hash(chapter)});
    assert.equal((await f.run()).exportFile, null); assert.deepEqual(fs.readFileSync(f.file), original); atomicWrite(file, saved);
  }
  const reviewer = createContinuationReviewer(f.book, [], [], undefined, [], [], [], [decision]);
  const first = readJson(path.join(f.sourceDir, 'chapters', hash(f.review.links[0]) + '.json')).chapter;
  reviewer.accept(first, {...first, sourceChapterNumber: first.chapter_number});
  assert.throws(() => reviewer.finish(), /后续核对章缺失/);
  atomicWrite(f.file, {...f.book, description: 'another edit'});
  assert.equal((await f.run()).exportFile, null); atomicWrite(f.file, original);
  fs.writeFileSync(path.join(f.sourceDir, 'references', f.review.reference.hash + '.bin'), 'changed');
  await assert.rejects(f.run(), /证据缺失或已变化/); assert.deepEqual(fs.readFileSync(f.file), original);
});

test('accepted source numbering defects retain prose and remain reported on later updates', async t => {
  const f = await sourceDefectFixture(t), original = fs.readFileSync(f.file);
  const decision = recordContinuationSourceDefect(f.spec, f.reviewOptions, f.review);
  assert.deepEqual(fs.readFileSync(f.file), original);
  const report = await f.run();
  assert.equal(report.continuationAdded, 4, JSON.stringify(report.failures)); assert.equal(report.completeAgainstSource, true);
  assert.equal(report.acceptedSourceDefects.length, 1); assert.equal(report.warnings, 1); assert.equal(report.automaticResolutions, 0);
  assert.equal(report.acceptedSourceDefects[0].reviewKey, decision.key);
  const book = readJson(f.file); assert.deepEqual(book.chapters.slice(0, 4), f.book.chapters);
  assert.deepEqual(book.chapters.slice(4).map(c => c.content), [5, 6, 7, 8].map(body));
  assert.deepEqual(book.chapters.slice(4).map(c => c.title), [title(5), f.state.titles[6], f.state.titles[7], f.state.titles[8]]);
  const next = await f.run(); assert.equal(next.continuationAdded, 0); assert.equal(next.warnings, 1); assert.equal(next.acceptedSourceDefects.length, 1);
  assert.match(fs.readFileSync(next.summaryFile, 'utf8'), /已接受来源缺陷/);
});

test('source defect acceptance is limited to complete unchanged adjacent entries and saved evidence', async t => {
  const f = await sourceDefectFixture(t), original = fs.readFileSync(f.file), attempt = change => recordContinuationSourceDefect(f.spec, f.reviewOptions, {...f.review, ...change});
  assert.throws(() => attempt({hashes: [hash('changed'), ...f.review.hashes.slice(1)]}), /检查点/);
  assert.throws(() => attempt({links: [f.review.links[0], f.review.links[2], f.review.links[1]]}), /相邻/);
  assert.throws(() => attempt({evidenceHash: hash('changed')}), /证据/);
  const decision = attempt({});
  for (const n of [5, 6, 7]) {
    const file = path.join(f.sourceDir, 'chapters', hash(f.base + '/new/c/' + n) + '.json'), saved = readJson(file), chapter = {...saved.chapter, content: saved.chapter.content + '变化'};
    atomicWrite(file, {...saved, chapter, hash: hash(chapter)}); assert.equal((await f.run()).completeAgainstSource, false);
    assert.deepEqual(fs.readFileSync(f.file), original); atomicWrite(file, saved);
  }
  const reviewer = createContinuationReviewer(f.book, [], [], undefined, [], [], [decision]);
  for (const n of [5, 6]) { const c = readJson(path.join(f.sourceDir, 'chapters', hash(f.base + '/new/c/' + n) + '.json')).chapter; reviewer.accept(c, {...c, sourceChapterNumber: n}); }
  assert.throws(() => reviewer.finish(), /后续核对章缺失/);
  fs.writeFileSync(path.join(f.sourceDir, 'references', f.review.evidenceHash + '.bin'), 'changed');
  await assert.rejects(f.run(), /证据缺失或变化/); assert.deepEqual(fs.readFileSync(f.file), original);
});

test('a source numbering defect at the old-book boundary requires a pinned complete matching tail', async t => {
  const f = await fixture(t);
  f.state.titles[5] = '第7章 山间故事5'; f.state.titles[6] = '第8章 山间故事6';
  const initial = await f.run({stopOnFailure: false}), sourceDir = path.dirname(initial.reportFile);
  const original = fs.readFileSync(f.file), evidenceFile = path.join(f.options.stateDir, 'boundary-reference.json');
  atomicWrite(evidenceFile, {finding: 'Independent catalog places the same named chapters directly after chapter 4.'});
  const options = {...f.options, extraction: extractionHash(f.spec)};
  const review = {links: [4, 5, 6].map(n => f.base + '/new/c/' + n), hashes: [4, 5, 6].map(n => hash(body(n))), evidenceFile,
    evidenceHash: hash(fs.readFileSync(evidenceFile)), reason: 'Explicitly reviewed source numbering defect; preserve all original prose.'};
  recordContinuationSourceDefect(f.spec, options, review);
  assert.equal((await f.run()).completeAgainstSource, false, 'an ordinary source review cannot waive the old-book boundary');
  const boundary = {file: path.basename(f.file), exportHash: hash(original), chapterHash: hash(f.book.chapters.at(-1))};
  assert.throws(() => recordContinuationSourceDefect(f.spec, options, {...review, boundary: {...boundary, exportHash: hash('changed')}}), /原书或末章已变化/);
  assert.throws(() => recordContinuationSourceDefect(f.spec, options, {...review, boundary: {...boundary, chapterHash: hash('changed')}}), /原书或末章已变化/);
  const changed = {...f.book, chapters: f.book.chapters.map(c => ({...c}))}; changed.chapters.at(-1).content += '不同正文'; atomicWrite(f.file, changed);
  assert.throws(() => recordContinuationSourceDefect(f.spec, options, {...review, boundary: {...boundary, exportHash: hash(fs.readFileSync(f.file)), chapterHash: hash(changed.chapters.at(-1))}}), /完整正文一致/);
  fs.writeFileSync(f.file, original);
  const decision = recordContinuationSourceDefect(f.spec, options, {...review, boundary});
  assert.deepEqual(fs.readFileSync(f.file), original);
  const read = n => readJson(path.join(sourceDir, 'chapters', hash(f.base + '/new/c/' + n) + '.json')).chapter;
  const alteredBook = {...f.book, description: 'changed after review'};
  assert.throws(() => createContinuationReviewer(alteredBook, [], [], undefined, [], [], [decision]).accept(read(5), read(5)), /章号冲突/);
  const reviewer = createContinuationReviewer(f.book, [], [], undefined, [], [], [decision]); reviewer.accept(read(5), read(5));
  assert.throws(() => reviewer.finish(), /后续核对章缺失/);
  assert.throws(() => reviewer.accept(read(6), {...read(6), content: body(6) + 'changed'}), /后续完整核对章已变化/);
  const report = await f.run(); assert.equal(report.continuationAdded, 2, JSON.stringify(report.failures));
  assert.equal(report.acceptedSourceDefects[0].reviewKey, decision.key);
  assert.deepEqual(readJson(f.file).chapters.slice(0, 4), f.book.chapters);
  assert.deepEqual(readJson(f.file).chapters.slice(4).map(c => c.content), [body(5), body(6)]);
  assert.equal((await f.run()).continuationAdded, 0);
});

test('selected split families do not turn an ordinary numeric title suffix into a missing lower part', async t => {
  const f = await fixture(t); f.state.count = 8;
  Object.assign(f.state.titles, {5: '第5章 双篇(上)', 6: '第5章 双篇(下)', 7: '第6章 完整章(2)', 8: '第7章 继续'});
  const options = {...f.options, extraction: extractionHash(f.spec)};
  assert.throws(() => recordContinuationPartPolicy(f.spec, options, {reason: 'test', families: ['unknown']}), /拆章类型/);
  recordContinuationPartPolicy(f.spec, options, {reason: '本书只有上下与分数配对，数字2是普通章名后缀。', families: ['upper-lower', 'fraction']});
  const report = await f.run(); assert.equal(report.continuationAdded, 4, JSON.stringify(report.failures)); assert.equal(report.errors, 0);
  assert.equal(report.resolutions.filter(r => r.kind === 'chapter-part').length, 2);
  assert.equal(readJson(f.file).chapters[6].title, '第6章 完整章(2)');
});

async function numberResetFixture(t) {
  const f = await fixture(t); f.state.count = 8;
  for (const n of [6, 7, 8]) f.state.titles[n] = `第${n - 2}章 山间故事${n}`;
  const report = await f.run({stopOnFailure: false}), sourceDir = path.dirname(report.reportFile);
  const links = [5, 6, 7].map(n => f.base + '/new/c/' + n), bodyFile = path.join(f.options.stateDir, 'reference.html');
  const chapters = [5, 6, 7].map(n => ({title: `第${n - 2}章 山间故事${n}`, link: 'https://reference.example/c/' + n}));
  const html = `<title>${f.spec.title}</title><p>${f.spec.author}</p><nav>${chapters.map(c => `<a href="${c.link}">${c.title}</a>`).join('')}</nav>`;
  fs.writeFileSync(bodyFile, html);
  return {...f, sourceDir, html, reviewOptions: {...f.options, extraction: extractionHash(f.spec)}, review: {links, hashes: [5, 6, 7].map(n => hash(body(n))), reference: {url: 'https://reference.example/book', bodyFile, hash: hash(Buffer.from(html)), chapters}, reason: '独立目录中同题三章连续；来源前章编号偏2，当前回退恢复，保留全部源站正文及顺序。'}};
}

test('a reviewed number reset preserves all source titles and bodies and resumes ordinary updates', async t => {
  const f = await numberResetFixture(t), original = fs.readFileSync(f.file);
  recordContinuationNumberReset(f.spec, f.reviewOptions, f.review);
  assert.equal(hash(fs.readFileSync(path.join(f.sourceDir, 'references', f.review.reference.hash + '.bin'))), f.review.reference.hash);
  assert.deepEqual(fs.readFileSync(f.file), original);
  const report = await f.run();
  assert.equal(report.continuationAdded, 4, JSON.stringify(report.failures));
  assert.equal(report.resolutions.filter(r => r.kind === 'reviewed-number-reset').length, 1);
  const book = readJson(f.file); assert.deepEqual(book.chapters.slice(0, 4), f.book.chapters);
  assert.deepEqual(book.chapters.slice(4).map(c => c.content), [5, 6, 7, 8].map(body));
  assert.deepEqual(book.chapters.slice(4).map(c => c.title), [title(5), f.state.titles[6], f.state.titles[7], f.state.titles[8]]);
  assert.equal((await f.run()).continuationAdded, 0);
  f.state.count = 9; f.state.titles[9] = '第7章 山间故事9';
  assert.equal((await f.run()).continuationAdded, 1);
});

async function numberCorrectionFixture(t) {
  const f = await fixture(t); f.state.count = 9;
  for (const n of [6, 7, 8]) f.state.titles[n] = `第${n - 4}章 山间故事${n}`;
  const report = await f.run({stopOnFailure: false}), sourceDir = path.dirname(report.reportFile);
  assert.equal(report.completeAgainstSource, false);
  const numbers = [5, 6, 7, 8, 9], links = numbers.map(n => f.base + '/new/c/' + n), bodyFile = path.join(f.options.stateDir, 'correction-reference.html');
  const chapters = numbers.map(n => ({title: title(n), link: 'https://reference.example/c/' + n}));
  const html = `<title>${f.spec.title}</title><p>${f.spec.author}</p><nav>${chapters.map(c => `<a href="${c.link}">${c.title}</a>`).join('')}</nav>`;
  fs.writeFileSync(bodyFile, html);
  return {...f, sourceDir, html, reviewOptions: {...f.options, extraction: extractionHash(f.spec)}, review: {links, hashes: numbers.map(n => hash(body(n))), reference: {url: 'https://reference.example/book', bodyFile, hash: hash(Buffer.from(html)), chapters}, reason: '完整相邻五章已核对，中间三个标题误编号；独立目录和两端正文确认连续，不改变正文或顺序。'}};
}

test('reviewed numbering corrections preserve bodies, source titles, catalog order and later updates', async t => {
  const f = await numberCorrectionFixture(t), original = fs.readFileSync(f.file);
  const review = recordContinuationNumberCorrection(f.spec, f.reviewOptions, f.review);
  assert.deepEqual(fs.readFileSync(f.file), original);
  assert.equal(hash(fs.readFileSync(path.join(f.sourceDir, 'references', review.reference.hash + '.bin'))), review.reference.hash);
  const report = await f.run();
  assert.equal(report.continuationAdded, 5, JSON.stringify(report.failures));
  assert.equal(report.resolutions.filter(r => r.kind === 'reviewed-number-correction').length, 3);
  assert.equal(report.resolutions.filter(r => r.kind === 'catalog-number').length, 0);
  const book = readJson(f.file); assert.deepEqual(book.chapters.slice(0, 4), f.book.chapters);
  assert.deepEqual(book.chapters.slice(4).map(c => c.content), [5, 6, 7, 8, 9].map(body));
  assert.deepEqual(book.chapters.slice(4).map(c => c.title), [5, 6, 7, 8, 9].map(title));
  for (const n of [6, 7, 8]) {
    assert.equal(book.chapters[n - 1].sourceTitle, f.state.titles[n]);
    const checkpoint = readJson(path.join(f.sourceDir, 'chapters', hash(f.base + '/new/c/' + n) + '.json'));
    assert.equal(checkpoint.chapter.title, f.state.titles[n]); assert.equal(checkpoint.catalogTitle, f.state.titles[n]);
  }
  const same = fs.readFileSync(f.file), mtime = fs.statSync(f.file).mtimeMs;
  assert.equal((await f.run()).continuationAdded, 0); assert.deepEqual(fs.readFileSync(f.file), same); assert.equal(fs.statSync(f.file).mtimeMs, mtime);
  f.state.count = 10; assert.equal((await f.run()).continuationAdded, 1);
});

test('numbering correction requires complete adjacent evidence, exact names and unchanged endpoint numbers', async t => {
  const f = await numberCorrectionFixture(t), original = fs.readFileSync(f.file);
  const attempt = change => recordContinuationNumberCorrection(f.spec, f.reviewOptions, {...f.review, ...change});
  assert.throws(() => attempt({hashes: [hash('changed'), ...f.review.hashes.slice(1)]}), /检查点/);
  assert.throws(() => attempt({links: [f.review.links[0], f.review.links[2], f.review.links[1], ...f.review.links.slice(3)]}), /相邻/);
  assert.throws(() => attempt({reference: {...f.review.reference, url: f.base + '/reference'}}), /独立目录/);
  for (const html of [f.html.replace(f.spec.author, '别的作者'), f.html.replace('</a>', '</a><a href="https://reference.example/gap">第6章 缺章</a>'), f.html.replace('第5章', '第4章'), f.html.replace('山间故事7', '不相关故事')]) {
    fs.writeFileSync(f.review.reference.bodyFile, html);
    assert.throws(() => attempt({reference: {...f.review.reference, hash: hash(Buffer.from(html))}}));
  }
  assert.deepEqual(fs.readFileSync(f.file), original);
});

test('numbering correction expires on any changed source body and cannot end before its closing chapter', async t => {
  const f = await numberCorrectionFixture(t), original = fs.readFileSync(f.file);
  const review = recordContinuationNumberCorrection(f.spec, f.reviewOptions, f.review);
  for (const n of [5, 6, 7, 8, 9]) {
    const file = path.join(f.sourceDir, 'chapters', hash(f.base + '/new/c/' + n) + '.json'), saved = readJson(file), chapter = {...saved.chapter, content: saved.chapter.content + '变化'};
    atomicWrite(file, {...saved, chapter, hash: hash(chapter)});
    assert.equal((await f.run()).completeAgainstSource, false);
    assert.deepEqual(fs.readFileSync(f.file), original); atomicWrite(file, saved);
  }
  const reviewer = createContinuationReviewer(f.book, [], [], undefined, [], [review]);
  for (const n of [5, 6, 7, 8]) { const c = readJson(path.join(f.sourceDir, 'chapters', hash(f.base + '/new/c/' + n) + '.json')).chapter; reviewer.accept(c, {...c, sourceChapterNumber: n}); }
  assert.throws(() => reviewer.finish(), /后续核对章缺失/);
  fs.writeFileSync(path.join(f.sourceDir, 'references', review.reference.hash + '.bin'), 'changed');
  await assert.rejects(f.run(), /原始页面证据/); assert.deepEqual(fs.readFileSync(f.file), original);
});

test('number reset review rejects changed bodies, independent evidence gaps, wrong identity and nonadjacent source links', async t => {
  const f = await numberResetFixture(t), original = fs.readFileSync(f.file);
  const attempt = change => recordContinuationNumberReset(f.spec, f.reviewOptions, {...f.review, ...change});
  assert.throws(() => attempt({hashes: [hash('stale'), ...f.review.hashes.slice(1)]}), /检查点/);
  assert.throws(() => attempt({links: [f.review.links[0], f.base + '/new/c/8', f.review.links[2]]}), /相邻/);
  assert.throws(() => attempt({reference: {...f.review.reference, hash: hash('stale')}}), /哈希/);
  for (const html of [f.html.replace(f.spec.author, '另一作者'), f.html.replace('</a>', '</a><a href="https://reference.example/missing">第4章 缺失正文</a>')]) {
    fs.writeFileSync(f.review.reference.bodyFile, html);
    assert.throws(() => attempt({reference: {...f.review.reference, hash: hash(Buffer.from(html))}}));
  }
  assert.deepEqual(fs.readFileSync(f.file), original);
});

test('number reset decisions expire when any of the three source bodies changes and require the following chapter', async t => {
  const f = await numberResetFixture(t), original = fs.readFileSync(f.file);
  recordContinuationNumberReset(f.spec, f.reviewOptions, f.review);
  for (const n of [5, 6, 7]) {
    const file = path.join(f.sourceDir, 'chapters', hash(f.base + '/new/c/' + n) + '.json'), saved = readJson(file);
    atomicWrite(file, {...saved, chapter: {...saved.chapter, content: saved.chapter.content + '变化'}, hash: hash({...saved.chapter, content: saved.chapter.content + '变化'})});
    assert.equal((await f.run()).completeAgainstSource, false);
    assert.deepEqual(fs.readFileSync(f.file), original); atomicWrite(file, saved);
  }
  const state = readJson(path.join(f.sourceDir, 'reviews.json')).value;
  const reviewer = createContinuationReviewer(f.book, [], [], undefined, state.numberResets);
  for (const n of [5, 6]) { const c = readJson(path.join(f.sourceDir, 'chapters', hash(f.base + '/new/c/' + n) + '.json')).chapter; reviewer.accept(c, {...c, sourceChapterNumber: n}); }
  assert.throws(() => reviewer.finish(), /后续核对章缺失/);
});

test('reviewed completed sources bind volume-numbered endings without changing any local chapter or extra', async t => {
  const f = await completedFixture(t), original = fs.readFileSync(f.file), mtime = fs.statSync(f.file).mtimeMs;
  const result = await bindReviewedCompletedSource(f.spec, f.reviewOptions, f.review);
  assert.equal(result.added, 0); assert.equal(result.reviewedEnding, 3); assert.equal(result.unchangedExport, true);
  assert.deepEqual(fs.readFileSync(f.file), original); assert.equal(fs.statSync(f.file).mtimeMs, mtime);
  assert.equal(continuationState(f.spec, f.options).state, 'complete');
  const unchanged = await f.run(); assert.equal(unchanged.completeAgainstSource, true, JSON.stringify(unchanged.failures)); assert.equal(unchanged.continuationAdded, 0);
  assert.equal(readJson(path.join(f.dir, 'binding.json')).value.completedSourceReview.catalogHash, f.review.catalogHash);
  assert.deepEqual(fs.readFileSync(f.file), original);
  await assert.rejects(bindReviewedCompletedSource(f.spec, f.reviewOptions, f.review), /已有换源绑定/);
  f.state.count = 7; f.state.titles[7] = '公告：附录更新';
  const update = await f.run(); assert.equal(update.continuationAdded, 1, JSON.stringify(update.failures));
  assert.equal(readJson(path.join(f.dir, 'binding.json')).value.completedSourceReview.anchors.length, 3);
  assert.deepEqual(readJson(f.file).chapters.slice(0, 7), f.book.chapters);
});

test('completed-source review rejects stale files, catalogs, either body, wrong titles and reordered or repeated mappings', async t => {
  const f = await completedFixture(t), original = fs.readFileSync(f.file), stale = hash('stale');
  const withFirst = change => ({...f.review, matches: f.review.matches.map((m, i) => i ? m : {...m, ...change})});
  for (const review of [{...f.review, exportHash: stale}, {...f.review, catalogHash: stale}, withFirst({oldHash: stale}), withFirst({newHash: stale}), withFirst({oldNumber: 1}), {...f.review, matches: [...f.review.matches].reverse()}, withFirst({oldNumber: 5})]) {
    await assert.rejects(bindReviewedCompletedSource(f.spec, f.reviewOptions, review));
    assert.deepEqual(fs.readFileSync(f.file), original); assert.equal(fs.existsSync(path.join(f.dir, 'binding.json')), false);
  }
  f.state.status = '连载中';
  await assert.rejects(bindReviewedCompletedSource(f.spec, f.reviewOptions, f.review), /未确认完结/);
  assert.deepEqual(fs.readFileSync(f.file), original);
});

test('completed-source binding rechecks the local file after network work', async t => {
  const f = await completedFixture(t);
  const {makeClient} = await import('../http.mjs');
  const client = makeClient({cacheDir: path.join(f.options.stateDir, 'cache'), allowedHosts: ['127.0.0.1'], delayMs: 200, retries: 0});
  const get = client.get.bind(client);
  client.get = async (...args) => { const response = await get(...args); if (args[0].endsWith('/c/6')) fs.appendFileSync(f.file, '\n'); return response; };
  try { await assert.rejects(bindReviewedCompletedSource(f.spec, {...f.reviewOptions, client}, f.review), /核对期间原书/); }
  finally { await client.close(); }
  assert.equal(fs.existsSync(path.join(f.dir, 'binding.json')), false); assert.equal(fs.readFileSync(f.file, 'utf8').endsWith('\n\n'), true);
});

test('switching checks three ending bodies, appends in the original file and remembers the source across runs', async t => {
  const f = await fixture(t), original = fs.readFileSync(f.file);
  const local = localBookState(f.spec, f.options);
  assert.equal(local.state, 'switch'); assert.equal(local.saved, 4); assert.match(local.message, /换源续更/);
  const probe = await f.run({mode: 'probe'});
  assert.equal(probe.structuralPass, true, JSON.stringify(probe.failures)); assert.equal(probe.exportFile, null);
  assert.deepEqual(fs.readFileSync(f.file), original); assert.equal(fs.existsSync(path.join(f.dir, 'binding.json')), false);
  f.state.requests = [];
  const report = await f.run();
  assert.equal(report.continuationAdded, 2); assert.equal(report.exportFile, f.file); assert.equal(report.anchors.length, 3);
  assert.deepEqual(f.state.requests, ['/new/book']);
  const next = readJson(f.file);
  assert.equal(next.sourceUrl, f.book.sourceUrl); assert.equal(next.authorSourceUrl, f.book.authorSourceUrl);
  assert.deepEqual(next.chapters.slice(0, 4), f.book.chapters); assert.equal(next.chapters.at(-1).chapter_number, 6);
  assert.equal(next.chapters.at(-1).sourceBookUrl, f.spec.sourceUrl);
  assert.deepEqual(fs.readFileSync(path.join(f.dir, 'original.json')), original);
  assert.equal(localBookState(f.spec, f.options).state, 'complete');
  const mtime = fs.statSync(f.file).mtimeMs;
  f.state.requests = [];
  const unchanged = await acquire(f.spec, {...f.options, mode: 'download'});
  assert.equal(unchanged.reusedExport, true); assert.equal(unchanged.continuationAdded, 0);
  assert.equal(fs.statSync(f.file).mtimeMs, mtime); assert.deepEqual(f.state.requests, ['/new/book']);
  f.state.count = 7; f.state.requests = [];
  const update = await acquire(f.spec, {...f.options, mode: 'download'});
  assert.equal(update.continuationAdded, 1); assert.deepEqual(f.state.requests, ['/new/book', '/new/c/7']);
  assert.equal(readJson(f.file).chapters.length, 7);
});

test('an anchor decode failure retains the actual chapter URL and encoding advice without changing the old book', async t => {
  const f = await fixture(t), original = fs.readFileSync(f.file);
  f.state.bodies[2] = '\uFFFD';
  const report = await f.run({mode: 'probe'});
  assert.equal(report.structuralPass, false);
  const failure = report.failures[0];
  assert.equal(failure.chapter, 2); assert.equal(failure.title, title(2));
  assert.equal(failure.link, f.base + '/new/c/2'); assert.equal(failure.url, failure.link);
  assert.equal(failure.code, 'decode-error'); assert.match(failure.nextStep, /编码/);
  assert.deepEqual(f.state.requests, ['/new/book', '/new/c/2']);
  assert.deepEqual(fs.readFileSync(f.file), original);
});

test('explicit anchor reviews accept only the reviewed full bodies and preserve all old prose', async t => {
  const f = await fixture(t), original = fs.readFileSync(f.file);
  f.state.bodies[2] = body(2) + '单字勘误';
  const probe = await f.run({mode: 'probe'});
  assert.equal(probe.structuralPass, false); assert.equal(probe.failures[0].code, 'continuation-body-conflict');
  const options = {...f.options, extraction: extractionHash(f.spec)};
  const choice = {file: path.basename(f.file), oldNumber: 2, newLink: f.base + '/new/c/2', oldHash: hash(body(2)), newHash: hash(f.state.bodies[2]), reason: '已逐项核对完整正文，差异为末尾勘误标记；旧正文保留。'};
  assert.throws(() => recordContinuationAnchorReview(f.spec, options, {...choice, oldHash: hash('stale')}), /正文已变化/);
  assert.throws(() => recordContinuationAnchorReview(f.spec, options, {...choice, oldNumber: 1}), /末尾三个/);
  assert.throws(() => recordContinuationAnchorReview(f.spec, options, {...choice, oldNumber: 3}), /同章号/);
  const review = recordContinuationAnchorReview(f.spec, options, choice);
  assert.deepEqual(fs.readFileSync(f.file), original);
  const report = await f.run();
  assert.equal(report.completeAgainstSource, true, JSON.stringify(report.failures));
  assert.equal(report.anchors[0].reviewKey, review.key);
  assert.deepEqual(readJson(f.file).chapters.slice(0, 4), f.book.chapters);
});

test('anchor reviews expire when either complete body changes and never authorize another variant', async t => {
  const f = await fixture(t);
  f.state.bodies[2] = body(2) + '已核对差异';
  const probe = await f.run({mode: 'probe'}), options = {...f.options, extraction: extractionHash(f.spec)};
  recordContinuationAnchorReview(f.spec, options, {file: path.basename(f.file), oldNumber: 2, newLink: f.base + '/new/c/2', oldHash: hash(body(2)), newHash: hash(f.state.bodies[2]), reason: '核对差异并保留旧文'});
  const checkpoint = path.join(path.dirname(probe.reportFile), 'chapters', hash(f.base + '/new/c/2') + '.json'), saved = readJson(checkpoint);
  saved.chapter.content += '未经核对变化'; saved.hash = hash(saved.chapter); atomicWrite(checkpoint, saved);
  assert.equal((await f.run({mode: 'probe'})).failures[0].code, 'continuation-body-conflict');
  saved.chapter.content = f.state.bodies[2]; saved.hash = hash(saved.chapter); atomicWrite(checkpoint, saved);
  f.book.chapters[1].content += '旧文变化'; atomicWrite(f.file, f.book);
  assert.equal((await f.run({mode: 'probe'})).failures[0].code, 'continuation-body-conflict');
  atomicWrite(f.file, {...f.book, chapters: f.book.chapters.map((c, i) => i === 1 ? {...c, content: body(2)} : c)});
  const changed = {...f.spec, variant: 'another-rule'};
  const report = await acquire(changed, {...f.options, continuation: localBookState(changed, f.options).continuation, mode: 'probe'});
  assert.equal(report.failures[0].code, 'continuation-body-conflict');
});

test('an explicitly reviewed unnumbered notice retains its title and cannot bypass numbered or changed content', async t => {
  const f = await fixture(t);
  f.state.titles[5] = '第五册预告'; f.state.bodies[5] = '实体书第五册开始预售，感谢各位读者支持。';
  f.state.titles[6] = title(5); f.state.bodies[6] = body(5);
  const report = await f.run({stopOnFailure: true});
  assert.equal(report.completeAgainstSource, false); assert.match(report.failures[0].error, /公告或番外/);
  const options = {...f.options, extraction: extractionHash(f.spec)}, choice = {link: f.base + '/new/c/5', contentHash: hash(f.state.bodies[5]), reason: '完整正文是实体书预售通知，独立保留。'};
  assert.throws(() => recordContinuationNoticeReview(f.spec, options, {...choice, contentHash: hash('stale')}), /正文已变化/);
  assert.throws(() => recordContinuationNoticeReview(f.spec, options, {link: f.base + '/new/c/2', contentHash: hash(body(2)), reason: '不是公告'}), /带章号/);
  recordContinuationNoticeReview(f.spec, options, choice);
  const checkpoint = path.join(path.dirname(report.reportFile), 'chapters', hash(choice.link) + '.json'), saved = readJson(checkpoint);
  saved.chapter.content += '改变'; saved.hash = hash(saved.chapter); atomicWrite(checkpoint, saved);
  assert.equal((await f.run({stopOnFailure: true})).completeAgainstSource, false);
  saved.chapter.content = f.state.bodies[5]; saved.hash = hash(saved.chapter); atomicWrite(checkpoint, saved);
  const complete = await f.run();
  assert.equal(complete.completeAgainstSource, true, JSON.stringify(complete.failures));
  assert.equal(complete.resolutions[0].kind, 'reviewed-notice');
  assert.equal(readJson(f.file).chapters[4].title, '第五册预告');
  assert.equal(readJson(f.file).chapters.at(-1).title, title(5));
});

test('paired suffixes are explicit and every family requires a matching second part', () => {
  for (const [a, b] of [[' 上', ' 下'], ['(上)', '(下)'], ['【上】', '【下】'], ['[上]', '[下]'], ['(1)', '(2)'], ['（1/2）', '（2/2）']]) {
    const book = {chapters: [{title: title(4), content: body(4), link: 'old', chapter_number: 4}]};
    const reviewer = createContinuationReviewer(book, [], [], {kind: 'paired', reason: '已接受上下篇'});
    const upper = {title: title(5) + a, content: body(5), link: 'upper', chapter_number: 5};
    const lower = {title: title(5) + b, content: body(50), link: 'lower', chapter_number: 6};
    assert.equal(chapterPartIdentity(upper.title).part, 1); assert.equal(chapterPartIdentity(lower.title).part, 2);
    assert.throws(() => reviewer.accept(lower, lower), /章号冲突/);
    assert.equal(reviewer.accept(upper, upper), true);
    assert.throws(() => reviewer.finish(), /缺少下篇/);
    assert.throws(() => reviewer.accept({...lower, title: title(6)}, {...lower, title: title(6)}), /章号冲突/);
    assert.throws(() => reviewer.accept({...lower, title: '第5章 别的故事' + b}, {...lower, title: '第5章 别的故事' + b}), /章号冲突/);
    assert.equal(reviewer.accept(lower, lower), true); reviewer.finish();
    assert.equal(reviewer.accept({...upper, link: 'duplicate'}, {...upper, link: 'duplicate'}), false);
    assert.throws(() => reviewer.accept({...lower, content: body(51)}, {...lower, content: body(51)}), /正文不同/);
    assert.equal(reviewer.accept({title: title(6)}, {title: title(6), content: body(6)}), true);
  }
  for (const text of ['第1章 下克上', '第1章 一起上', '第1章 修为(10/10)', '第1章 路途(3)', '请假 上']) assert.equal(chapterPartIdentity(text), null);
});

test('part markers cannot disagree with the page or mix pair families', () => {
  const reviewer = createContinuationReviewer({chapters: [{title: title(4), content: body(4)}]}, [], [], {kind: 'paired'});
  const upper = {title: title(5) + '(1/2)', content: body(5)};
  assert.equal(reviewer.accept(upper, upper), true);
  const wrong = {title: title(5) + '(2)', content: body(6)};
  assert.throws(() => reviewer.accept(wrong, wrong), /章号冲突/);
  assert.throws(() => reviewer.accept({title: title(5) + '(2/2)'}, wrong), /无法对应/);
});

test('opted-in complete pairs align whole old anchors and export new parts separately across updates', async t => {
  const f = await fixture(t);
  f.book.chapters[1].content = body(2) + body(20); atomicWrite(f.file, f.book);
  f.state.order = [1, 2, 20, 3, 4, 5, 50, 6];
  f.state.titles[2] = title(2) + ' 上'; f.state.titles[20] = title(2) + ' 下';
  f.state.titles[5] = title(5) + '(1/2)'; f.state.titles[50] = title(5) + '(2/2)';
  const original = fs.readFileSync(f.file);
  assert.equal((await f.run()).completeAgainstSource, false);
  recordContinuationPartPolicy(f.spec, {...f.options, extraction: extractionHash(f.spec)}, {reason: '用户接受完整上下拆章'});
  const report = await f.run();
  assert.equal(report.completeAgainstSource, true, JSON.stringify(report.failures)); assert.equal(report.continuationAdded, 3);
  assert.equal(report.anchors[0].parts.length, 2); assert.equal(report.anchors[0].sourcePosition, 3);
  assert.deepEqual(readJson(f.file).chapters.slice(0, 4), f.book.chapters);
  assert.deepEqual(fs.readFileSync(path.join(f.dir, 'original.json')), original);
  assert.deepEqual(readJson(f.file).chapters.slice(4).map(c => c.title), [title(5) + '(1/2)', title(5) + '(2/2)', title(6)]);
  const mtime = fs.statSync(f.file).mtimeMs;
  assert.equal((await f.run()).reusedExport, true); assert.equal(fs.statSync(f.file).mtimeMs, mtime);
  f.state.order.push(7); assert.equal((await f.run()).continuationAdded, 1);
});

test('a paired anchor review checks both hashes and cannot authorize a half, a reversed pair or stale prose', async t => {
  const f = await fixture(t), options = {...f.options, extraction: extractionHash(f.spec)};
  f.book.chapters[1].content = body(2) + body(20); atomicWrite(f.file, f.book);
  f.state.order = [1, 2, 20, 3, 4, 5, 6]; f.state.titles[2] = title(2) + ' 上'; f.state.titles[20] = title(2) + ' 下';
  f.state.bodies[2] = body(2) + '来源勘误';
  recordContinuationPartPolicy(f.spec, options, {reason: '用户接受配对拆章'});
  const report = await f.run(), links = [2, 20].map(n => f.base + '/new/c/' + n);
  assert.equal(report.failures[0].code, 'continuation-body-conflict');
  const choice = {file: path.basename(f.file), oldNumber: 2, oldHash: hash(f.book.chapters[1].content), newLinks: links, newHashes: [hash(f.state.bodies[2]), hash(body(20))], reason: '上下合起来全文核对，唯一变化是上篇末尾的勘误；保留旧文'};
  assert.throws(() => recordContinuationAnchorReview(f.spec, options, {...choice, newHashes: [choice.newHashes[0], hash('stale')]}), /正文已变化/);
  assert.throws(() => recordContinuationAnchorReview(f.spec, options, {...choice, newLinks: [...links].reverse()}), /完整相邻/);
  assert.throws(() => recordContinuationAnchorReview(f.spec, options, {...choice, newLinks: undefined, newHashes: undefined, newLink: links[0], newHash: choice.newHashes[0]}), /未配对拆章/);
  const review = recordContinuationAnchorReview(f.spec, options, choice);
  const checkpoint = path.join(path.dirname(report.reportFile), 'chapters', hash(links[1]) + '.json'), saved = readJson(checkpoint);
  saved.chapter.content += '未经核对'; saved.hash = hash(saved.chapter); atomicWrite(checkpoint, saved);
  assert.equal((await f.run()).failures[0].code, 'continuation-body-conflict');
  saved.chapter.content = body(20); saved.hash = hash(saved.chapter); atomicWrite(checkpoint, saved);
  const complete = await f.run(); assert.equal(complete.completeAgainstSource, true, JSON.stringify(complete.failures));
  assert.equal(complete.anchors[0].reviewKey, review.key); assert.deepEqual(readJson(f.file).chapters.slice(0, 4), f.book.chapters);
});

test('an unfinished pair cannot bind the source; cached upper resumes when the lower appears', async t => {
  const f = await fixture(t), original = fs.readFileSync(f.file);
  recordContinuationPartPolicy(f.spec, {...f.options, extraction: extractionHash(f.spec)}, {reason: '接受配对拆章'});
  f.state.count = 5; f.state.titles[5] = title(5) + '【上】';
  const blocked = await f.run(); assert.equal(blocked.completeAgainstSource, false); assert.match(blocked.failures[0].error, /缺少下篇/);
  assert.deepEqual(fs.readFileSync(f.file), original); assert.equal(fs.existsSync(path.join(f.dir, 'binding.json')), false);
  f.state.count = 6; f.state.titles[6] = title(5) + '【下】';
  const complete = await f.run(); assert.equal(complete.completeAgainstSource, true, JSON.stringify(complete.failures)); assert.equal(complete.continuationAdded, 2);
});

test('a probe includes the lower when its normal sample ends with an upper', async t => {
  const f = await fixture(t);
  recordContinuationPartPolicy(f.spec, {...f.options, extraction: extractionHash(f.spec)}, {reason: '接受配对拆章'});
  f.state.count = 8; f.state.titles[7] = title(7) + '(上)'; f.state.titles[8] = title(7) + '(下)';
  const report = await f.run({mode: 'probe'});
  assert.equal(report.structuralPass, true, JSON.stringify(report.failures)); assert.equal(report.checkedNew, 4); assert.equal(report.completeAgainstSource, false);
});

test('old notices stay in place; equal new-source notices are not appended twice', async t => {
  const f = await fixture(t);
  f.book.chapters.push({chapter_number: 5, title: '2026一月月票抽奖活动！', content: '感谢各位读者支持本书。月票抽奖活动开始了。', link: 'https://old.example/notice'});
  atomicWrite(f.file, f.book); f.state.notice = true;
  const report = await f.run();
  assert.equal(report.errors, 0, JSON.stringify(report.failures)); assert.equal(report.continuationAdded, 2); assert.equal(report.skipped.length, 1);
  assert.deepEqual(readJson(f.file).chapters.slice(0, 5), f.book.chapters);
  assert.equal(readJson(f.file).chapters.at(-1).chapter_number, 7);
});

test('exact repeated chapter blocks are skipped automatically, recorded, and continue updating after restart', async t => {
  const f = await fixture(t), logical = [5, 6, 7, 5, 6, 7, 8];
  f.state.count = 11;
  for (const [index, n] of logical.entries()) { f.state.titles[index + 5] = title(n); f.state.bodies[index + 5] = body(n); }
  const report = await f.run();
  assert.equal(report.errors, 0, JSON.stringify(report.failures)); assert.equal(report.continuationAdded, 4);
  assert.equal(report.automaticResolutions, 3); assert.ok(report.resolutions.every(item => item.kind === 'duplicate-chapter' && item.comparisonHash && item.retainedLink));
  assert.deepEqual(readJson(f.file).chapters.map(c => c.title), Array.from({length: 8}, (_, i) => title(i + 1)));
  const accepted = readJson(path.join(f.dir, 'binding.json')).value;
  assert.equal(accepted.catalog.length, 11); assert.equal(accepted.resolutions.length, 3);
  assert.ok(fs.existsSync(report.reportFile));
  f.state.count = 12; f.state.titles[12] = title(9); f.state.bodies[12] = body(9); f.state.requests = [];
  const update = await acquire(f.spec, {...f.options, mode: 'download'});
  assert.equal(update.continuationAdded, 1); assert.equal(update.automaticResolutions, 0);
  assert.deepEqual(f.state.requests, ['/new/book', '/new/c/12']);
  assert.equal(readJson(path.join(f.dir, 'binding.json')).value.resolutions.length, 3);
});

test('a wrong catalog number uses a continuous page heading and preserves the conflicting source title', async t => {
  const f = await fixture(t);
  f.state.titles[5] = '第55章 山间故事5'; f.state.headings[5] = title(5);
  const report = await f.run();
  assert.equal(report.errors, 0, JSON.stringify(report.failures)); assert.equal(report.continuationAdded, 2);
  assert.equal(report.resolutions[0].kind, 'catalog-number'); assert.equal(report.resolutions[0].catalogNumber, 55); assert.equal(report.resolutions[0].pageNumber, 5);
  const chapter = readJson(f.file).chapters[4];
  assert.equal(chapter.title, title(5)); assert.equal(chapter.catalogTitle, '第55章 山间故事5'); assert.equal(chapter.content, body(5));
});

test('new notices with identical complete prose are deduplicated within the same update', async t => {
  const f = await fixture(t);
  f.state.count = 7;
  for (const n of [5, 6]) { f.state.titles[n] = '一月月票抽奖活动'; f.state.bodies[n] = '感谢大家对本书的支持，本月的抽奖活动正式开始。'; }
  f.state.titles[7] = title(5); f.state.bodies[7] = body(5);
  const report = await f.run();
  assert.equal(report.errors, 0, JSON.stringify(report.failures)); assert.equal(report.continuationAdded, 2);
  assert.equal(report.resolutions[0].kind, 'duplicate-notice'); assert.equal(readJson(f.file).chapters.at(-1).title, title(5));
});

test('repeated anchor numbers are matched by complete prose instead of blocking a valid handoff', async t => {
  const f = await fixture(t);
  f.state.order = [1, 2, 22, 3, 4, 5, 6]; f.state.titles[22] = title(2); f.state.bodies[22] = body(2);
  f.state.bodies[2] = body(40);
  const report = await f.run();
  assert.equal(report.errors, 0, JSON.stringify(report.failures)); assert.equal(report.continuationAdded, 2);
  assert.equal(report.anchors.length, 3); assert.deepEqual(readJson(f.file).chapters.slice(0, 4), f.book.chapters);
  assert.equal(report.anchors[0].sourcePosition, 3);
});

test('similar versions, deleted paragraphs and reworded prose are not silently discarded', async t => {
  for (const scenario of ['reworded', 'deleted-paragraph', 'different-notice']) await t.test(scenario, async t => {
    const f = await fixture(t), original = fs.readFileSync(f.file);
    f.state.titles[5] = title(4);
    f.state.bodies[5] = scenario === 'reworded' ? body(4).slice(0, -1) + '改' : body(4).slice(60);
    if (scenario === 'different-notice') {
      for (const n of [5, 6]) f.state.titles[n] = '一月月票抽奖活动';
      f.state.bodies[5] = '本月抽奖一份。'; f.state.bodies[6] = '本月抽奖两份。';
    }
    const report = await f.run(); assert.equal(report.exportFile, null); assert.equal(report.structuralPass, false);
    assert.deepEqual(fs.readFileSync(f.file), original);
    assert.equal(fs.existsSync(path.join(f.dir, 'binding.json')), false);
  });
});

test('library continuation stops at the first content conflict and preserves the original file', async t => {
  const f = await fixture(t), original = fs.readFileSync(f.file);
  f.state.count = 7;
  f.state.titles[6] = title(5); f.state.bodies[6] = body(5) + '需要人工核对的不同版本。';
  f.state.titles[7] = title(6); f.state.bodies[7] = body(6);
  const failed = await f.run({stopOnFailure: true});
  assert.equal(failed.exportFile, null); assert.deepEqual(fs.readFileSync(f.file), original);
  assert.equal(failed.failures[0].link, f.base + '/new/c/6');
  assert.match(failed.failures[0].nextStep, /本书已暂停/);
  assert.equal(f.state.requests.includes('/new/c/7'), false);
});

test('conflicts retain later chapters, and a reviewed incoming version resumes without downloading bodies again', async t => {
  const f = await fixture(t), original = fs.readFileSync(f.file);
  f.state.count = 7;
  f.state.titles[6] = title(5); f.state.bodies[6] = body(5) + '经过核对的正确版本。';
  f.state.titles[7] = title(6); f.state.bodies[7] = body(6);
  const failed = await f.run();
  assert.equal(failed.completeAgainstSource, false); assert.deepEqual(fs.readFileSync(f.file), original);
  assert.equal(failed.failures.length, 1); assert.equal(failed.failures[0].link, f.base + '/new/c/6');
  assert.ok(f.state.requests.includes('/new/c/7'), 'collect the remaining source even when an earlier version is unresolved');
  const decision = recordContinuationReview(f.spec, {...f.options, extraction: extractionHash(f.spec)}, {
    firstLink: f.base + '/new/c/5', secondLink: f.base + '/new/c/6', keepLink: f.base + '/new/c/6', reason: '逐项核对两个完整版本，保留第二个版本。',
  });
  f.state.requests = [];
  const result = await f.run();
  assert.equal(result.errors, 0, JSON.stringify(result.failures)); assert.equal(result.continuationAdded, 2);
  assert.deepEqual(f.state.requests, ['/new/book']);
  const book = readJson(f.file);
  assert.deepEqual(book.chapters.slice(0, 4), f.book.chapters);
  assert.equal(book.chapters[4].link, f.base + '/new/c/6'); assert.equal(book.chapters[4].chapter_number, 5);
  assert.equal(book.chapters[4].sourceChapterNumber, 6); assert.equal(book.chapters[4].content, f.state.bodies[6]);
  assert.equal(book.chapters[5].title, title(6)); assert.equal(result.resolutions[0].reviewKey, decision.key);
  assert.equal(readJson(path.join(f.dir, 'binding.json')).value.resolutions[0].kind, 'reviewed-variant');
  f.state.count = 8; f.state.titles[8] = title(7); f.state.bodies[8] = body(7); f.state.requests = [];
  assert.equal((await f.run()).continuationAdded, 1); assert.deepEqual(f.state.requests, ['/new/book', '/new/c/8']);
});

test('a reviewed notice retains the selected complete text; unrelated or changed bodies cannot reuse that decision', async t => {
  const f = await fixture(t), original = fs.readFileSync(f.file);
  f.state.count = 7;
  for (const n of [5, 6]) f.state.titles[n] = '一月月票抽奖活动';
  f.state.bodies[5] = '本月抽奖一份。'; f.state.bodies[6] = '本月抽奖两份。';
  f.state.titles[7] = title(5); f.state.bodies[7] = body(5);
  const failed = await f.run(), options = {...f.options, extraction: extractionHash(f.spec)};
  const review = {firstLink: f.base + '/new/c/5', secondLink: f.base + '/new/c/6', keepLink: f.base + '/new/c/5', reason: '本次核对保留第一份公告。'};
  assert.equal(failed.failures.length, 1);
  assert.throws(() => recordContinuationReview(f.spec, options, {...review, secondLink: f.base + '/new/c/7'}), /不能跨章/);
  recordContinuationReview(f.spec, options, review);
  const sourceDir = path.dirname(failed.reportFile), checkpoint = path.join(sourceDir, 'chapters', hash(review.secondLink) + '.json');
  const saved = readJson(checkpoint), changed = {...saved.chapter, content: '该页后来改成了三份奖品。'};
  atomicWrite(checkpoint, {...saved, chapter: changed, hash: hash(changed)});
  const stale = await f.run(); assert.equal(stale.completeAgainstSource, false); assert.deepEqual(fs.readFileSync(f.file), original);
  atomicWrite(checkpoint, saved);
  const result = await f.run(); assert.equal(result.errors, 0); assert.equal(result.continuationAdded, 2);
  assert.equal(readJson(f.file).chapters[4].content, f.state.bodies[5]);
  assert.equal(result.resolutions[0].retainedLink, review.keepLink);
  const reviewsFile = path.join(sourceDir, 'reviews.json'), reviews = readJson(reviewsFile);
  reviews.value.decisions[0].keepLink = review.secondLink; atomicWrite(reviewsFile, reviews);
  await assert.rejects(f.run(), /损坏/);
});

test('unknown duplicate notices require both exact notice reviews before choosing a version', async t => {
  const f = await fixture(t), original = fs.readFileSync(f.file);
  f.state.count=7;
  for(const n of [5,6])f.state.titles[n]='本月抽奖活动加码！以及奖品补充说明';
  f.state.bodies[5]='完整公告，感谢读者。';f.state.bodies[6]='完整公告，感谢读者。站点广告。';
  f.state.titles[7]=title(5);f.state.bodies[7]=body(5);
  const failed=await f.run(), options={...f.options,extraction:extractionHash(f.spec)};
  assert.equal(failed.completeAgainstSource,false);
  const review={firstLink:f.base+'/new/c/5',secondLink:f.base+'/new/c/6',keepLink:f.base+'/new/c/5',reason:'两份相同公告，保留没有广告的完整版本'};
  assert.throws(()=>recordContinuationReview(f.spec,options,review),/不能跨章/);
  recordContinuationNoticeReview(f.spec,options,{link:review.firstLink,contentHash:hash(f.state.bodies[5]),reason:'全文核实作者活动公告'});
  assert.throws(()=>recordContinuationReview(f.spec,options,review),/不能跨章/);
  recordContinuationNoticeReview(f.spec,options,{link:review.secondLink,contentHash:hash(f.state.bodies[6]),reason:'全文核实同一作者活动公告和站点广告'});
  assert.throws(()=>recordContinuationReview(f.spec,options,{...review,secondLink:f.base+'/new/c/7'}),/不能跨章/);
  recordContinuationReview(f.spec,options,review);
  const file=path.join(path.dirname(failed.reportFile),'chapters',hash(review.secondLink)+'.json'),saved=readJson(file),changed={...saved.chapter,content:'后来改成不同的内容。'};
  atomicWrite(file,{...saved,chapter:changed,hash:hash(changed)});
  assert.throws(()=>recordContinuationReview(f.spec,options,review),/不能跨章/);
  assert.equal((await f.run()).completeAgainstSource,false);assert.deepEqual(fs.readFileSync(f.file),original);
  atomicWrite(file,saved);
  const result=await f.run();assert.equal(result.completeAgainstSource,true,JSON.stringify(result.failures));
  assert.equal(result.continuationAdded,2);assert.equal(readJson(f.file).chapters[4].content,f.state.bodies[5]);
});

test('transport failures stop further requests and preserve completed checkpoints for a later retry', async t => {
  const f = await fixture(t), original = fs.readFileSync(f.file);
  f.state.unavailable = 5;
  const failed = await f.run();
  assert.equal(failed.completeAgainstSource, false); assert.ok(failed.failures.length);
  assert.equal(f.state.requests.includes('/new/c/6'), false);
  assert.deepEqual(fs.readFileSync(f.file), original);
  f.state.unavailable = null; f.state.requests = [];
  const result = await f.run();
  assert.equal(result.continuationAdded, 2);
  assert.deepEqual(f.state.requests, ['/new/book', '/new/c/5', '/new/c/6']);
});

test('legacy ordinal gaps and truncated source headings retain old ordinals and append after their maximum', async t => {
  const f = await fixture(t);
  f.book.chapters.forEach((chapter, i) => { chapter.chapter_number = [1, 4, 7, 9][i]; });
  f.book.chapters[3].title = '第4章 山间故事的最后一页（9k三合一）';
  f.state.titles[4] = '第4章 山间故事的最后一页';
  f.state.bodies[4] = f.book.chapters[3].title + '\n' + body(4);
  atomicWrite(f.file, f.book);
  const report = await f.run();
  assert.equal(report.errors, 0, JSON.stringify(report.failures)); assert.equal(report.continuationAdded, 2);
  assert.deepEqual(readJson(f.file).chapters.map(c => c.chapter_number), [1, 4, 7, 9, 10, 11]);
  assert.deepEqual(readJson(f.file).chapters.slice(0, 4), f.book.chapters);
});

async function reviewedGapFixture(t) {
  const f = await fixture(t), job = path.join(f.options.stateDir, 'jobs', '12345678901234567890');
  const sources = [1, 2, 3, 4].map(n => ({position: n, link: f.base + '/new/c/' + n, title: title(n), catalogTitle: title(n), contentHash: hash(body(n))}));
  f.book.sourceUrl = f.spec.sourceUrl;
  f.book.chapters = [1, 3, 4].map((n, i) => ({...f.book.chapters[n - 1], chapter_number: i + 1, sourceChapterNumber: n, link: sources[n - 1].link}));
  atomicWrite(f.file, f.book);
  const gap = {position: 2, link: sources[1].link, contentHash: sources[1].contentHash, kind: 'truncated', reason: 'Previously verified historical omission.', evidence: {url: 'https://reference.example/book', checkedAt: new Date().toISOString(), detail: 'Independent complete edition shows missing text.'}};
  const state = {version: 1, file: path.basename(f.file), outputPath: f.file, identity: {sourceUrl: f.spec.sourceUrl}, exportHash: hash(fs.readFileSync(f.file)), book: f.book, sources, sourceOrderReview: {gaps: [gap]}};
  const chapter = {chapter_number: 2, title: title(2), link: sources[1].link, content: body(2)};
  const checkpoint = path.join(job, 'chapters', hash(chapter.link) + '.json');
  atomicWrite(checkpoint, {hash: hash(chapter), chapter});
  const seal = () => atomicWrite(path.join(job, 'reading-edition.json'), {hash: hash(state), value: state}); seal();
  const run = () => acquire(f.spec, {...f.options, mode: 'download', continuation: {file: path.basename(f.file), hash: hash(fs.readFileSync(f.file))}});
  return {...f, stateReading: state, seal, checkpoint, run};
}

test('same-source continuation preserves pinned reviewed old gaps without treating them as repaired', async t => {
  const f = await reviewedGapFixture(t), old = readJson(f.file);
  const result = await f.run();
  assert.equal(result.continuationAdded, 2, JSON.stringify(result.failures));
  assert.equal(result.completeAgainstSource, false); assert.equal(result.completeSelectedScope, true); assert.equal(result.structuralPass, true);
  assert.equal(result.sourceGaps.length, 1); assert.equal(result.automaticResolutions, 0);
  assert.deepEqual(readJson(f.file).chapters.slice(0, 3), old.chapters);
  assert.deepEqual(readJson(f.file).chapters.slice(3).map(c => c.title), [title(5), title(6)]);
  const next = await f.run(); assert.equal(next.continuationAdded, 0); assert.equal(next.sourceGaps.length, 1); assert.equal(next.completeAgainstSource, false);
});

test('old anchor gaps require unchanged reviewed export, source positions, evidence and omitted checkpoints', async t => {
  for (const scenario of ['unreviewed', 'stale-export', 'changed-checkpoint', 'no-evidence', 'different-source', 'changed-catalog', 'new-gap']) {
    await t.test(scenario, async t => {
      const f = await reviewedGapFixture(t);
      if (scenario === 'unreviewed') f.stateReading.sourceOrderReview.gaps = [];
      if (scenario === 'stale-export') f.stateReading.exportHash = 'stale';
      if (scenario === 'changed-checkpoint') { const saved = readJson(f.checkpoint); saved.chapter.content += 'changed'; atomicWrite(f.checkpoint, {...saved, hash: hash(saved.chapter)}); }
      if (scenario === 'no-evidence') delete f.stateReading.sourceOrderReview.gaps[0].evidence;
      if (scenario === 'different-source') f.spec.sourceUrl = f.base + '/other/book';
      if (scenario === 'changed-catalog') f.state.titles[2] = '第2章 别的内容';
      if (scenario === 'new-gap') f.state.order = [1, 2, 3, 4, 6];
      f.seal(); const original = fs.readFileSync(f.file), result = await f.run();
      assert.equal(result.exportFile, null); assert.ok(result.failures.length); assert.deepEqual(fs.readFileSync(f.file), original);
    });
  }
});

test('shudugu search pairs each book and author and preserves the next page', () => {
  const site = loadSites().sites.find(site => site.id === 'shudugu');
  const html = `<div class="container">${[[123, '故事甲', '作者甲'], [456, '故事乙', '作者乙']].map(([id, title, author]) => `<div class="item"><a href="/${id}/"><img></a><div class="itemtxt"><h3><a href="/${id}/">${title}</a></h3><p><a href="/zuozhe/?tag=${author}">作者：${author}</a></p><ul><li><a href="/${id}/123.html">最新章节</a></li></ul></div></div>`).join('')}<div class="page"><a href="/i/sor.aspx?key=test&page=2">下一页</a></div></div>`;
  const result = parseSearch(html, site.home, site);
  assert.deepEqual(result.results.map(book => [book.title, book.author, book.url]), [['故事甲', '作者甲', 'https://www.shudugu.org/123/'], ['故事乙', '作者乙', 'https://www.shudugu.org/456/']]);
  assert.equal(result.next, 'https://www.shudugu.org/i/sor.aspx?key=test&page=2');
  assert.throws(() => parseSearch(html.replaceAll('/123/', 'https://different.example/123/'), site.home, site));
});

test('switching again uses the latest ending and preserves both earlier sources', async t => {
  const f = await fixture(t); await f.run();
  f.state.count = 8; f.state.requests = [];
  const third = {...f.spec, sourceUrl: f.base + '/third/book'};
  const selected = localBookState(third, f.options);
  assert.equal(selected.state, 'switch');
  const report = await acquire(third, {...f.options, mode: 'download', continuation: selected.continuation});
  assert.equal(report.continuationAdded, 2, JSON.stringify(report.failures));
  assert.deepEqual(f.state.requests, ['/third/book', '/third/c/4', '/third/c/5', '/third/c/6', '/third/c/7', '/third/c/8']);
  assert.equal(readJson(f.file).sourceUrl, f.book.sourceUrl);
  assert.equal(localBookState(third, f.options).state, 'complete'); assert.equal(localBookState(f.spec, f.options).state, 'switch');
});

test('title, body, author, missing chapter and split chapter conflicts leave original bytes untouched', async t => {
  for (const scenario of ['anchor-title', 'anchor-body', 'author', 'gap', 'split', 'duplicate', 'garbled', 'unknown-notice']) {
    await t.test(scenario, async t => {
      const f = await fixture(t), original = fs.readFileSync(f.file);
      if (scenario === 'anchor-title') f.state.titles[4] = '第4章 别的章节';
      if (scenario === 'anchor-body') f.state.bodies[4] = body(20);
      if (scenario === 'author') f.state.author = '乙作者';
      if (scenario === 'gap') f.state.order = [1, 2, 3, 4, 6];
      if (scenario === 'split') f.state.titles[5] = '第4章 山间故事4（下）';
      if (scenario === 'duplicate') f.state.bodies[5] = body(1);
      if (scenario === 'garbled') f.state.bodies[5] = '銆锛鈥鐨勬姹熸'.repeat(100);
      if (scenario === 'unknown-notice') f.state.titles[5] = '不明内容';
      const report = await f.run();
      assert.equal(report.structuralPass, false); assert.equal(report.exportFile, null);
      if (scenario === 'anchor-body') {
        assert.equal(report.failures[0].code, 'continuation-body-conflict');
        assert.equal(report.failures[0].url, f.base + '/new/c/4');
        assert.equal(report.failures[0].chapter, 4); assert.match(report.failures[0].nextStep, /版本差异/);
      }
      assert.deepEqual(fs.readFileSync(f.file), original); assert.equal(fs.existsSync(path.join(f.dir, 'binding.json')), false);
    });
  }
});

test('pausing keeps checkpoints, and resuming skips successfully collected new-source bodies', async t => {
  const f = await fixture(t), original = fs.readFileSync(f.file);
  const paused = await f.run({maxNew: 4});
  assert.equal(paused.paused, true); assert.equal(paused.exportFile, null);
  assert.deepEqual(fs.readFileSync(f.file), original);
  assert.equal(fs.existsSync(path.join(f.dir, 'binding.json')), false);
  f.state.requests = [];
  const report = await f.run();
  assert.equal(report.continuationAdded, 2); assert.deepEqual(f.state.requests, ['/new/book', '/new/c/6']);
});

test('stale selection, manual edits, rules changes and historical catalog mutations are protected', async t => {
  const f = await fixture(t), selected = f.choose();
  atomicWrite(f.file, {...f.book, description: '用户修改'});
  await assert.rejects(f.run({continuation: selected}), /目标已变化/);
  await f.run();
  const accepted = fs.readFileSync(f.file);
  f.state.order = [1, 2, 3, 5, 4, 6, 7];
  const changed = await f.run(); assert.equal(changed.exportFile, null); assert.match(changed.failures[0].error, /删除、插入或改名/);
  assert.deepEqual(fs.readFileSync(f.file), accepted);
  await assert.rejects(acquire({...f.spec, variant: 'v2'}, {...f.options, mode: 'download'}), /提取规则已变化/);
  atomicWrite(f.file, {...readJson(f.file), description: '更新后用户修改'});
  assert.equal(localBookState(f.spec, f.options).blocked, true);
  await assert.rejects(acquire(f.spec, {...f.options, mode: 'download'}), /其他程序修改/);
});

test('multiple exports require disambiguation and a different author is never selected', async t => {
  const f = await fixture(t);
  atomicWrite(path.join(f.options.outputDir, 'another.json'), {...f.book, author: '另一个作者'});
  assert.equal(localBookState(f.spec, f.options).state, 'switch');
  atomicWrite(path.join(f.options.outputDir, 'duplicate.json'), f.book);
  const local = localBookState(f.spec, f.options);
  assert.equal(local.blocked, true); assert.match(local.message, /多个同名同作者/);
});

test('catalog punctuation width changes preserve accepted labels and old bodies across continuation updates', async t => {
  const f = await fixture(t);
  f.state.titles[5] = '第5章 山间故事5（月票加更）';
  assert.ok((await f.run()).exportFile);
  const original = readJson(f.file), bindingFile = path.join(f.dir, 'binding.json');
  const originalCatalog = readJson(bindingFile).value.catalog;
  f.state.titles[5] = '第5章 山间故事5(月票加更)'; f.state.count = 7; f.state.requests = [];
  const updated = await f.run();
  assert.equal(updated.continuationAdded, 1, JSON.stringify(updated.failures));
  assert.deepEqual(readJson(f.file).chapters.slice(0, original.chapters.length), original.chapters);
  assert.deepEqual(readJson(bindingFile).value.catalog.slice(0, originalCatalog.length), originalCatalog);
  assert.deepEqual(f.state.requests, ['/new/book', '/new/c/7']);
  const bytes = fs.readFileSync(f.file);
  assert.equal((await f.run()).reusedExport, true);
  f.state.titles[5] = '第5章 山间故事5月票加更';
  assert.equal((await f.run()).exportFile, null, 'removing punctuation still needs review');
  assert.deepEqual(fs.readFileSync(f.file), bytes);
});

test('explicit additive rule migration checks fresh tail bodies and keeps old files and checkpoints', async t => {
  const f = await fixture(t); await f.run();
  const original = fs.readFileSync(f.file), previousBinding = readJson(path.join(f.dir, 'binding.json'));
  const spec = {...f.spec, variant: 'new-v2', chapter: {...f.spec.chapter, removeText: ['(?:^|\\n)【站点广告】(?=\\n|$)']}};
  const options = {...f.options, reason: '只增加已核实的独立广告清理；旧正文保持不变。'};
  f.state.bodies[6] = body(6) + '源站修改了末尾正文';
  await assert.rejects(migrateContinuationRules(f.spec, spec, options), /末尾全文不一致/);
  assert.deepEqual(readJson(path.join(f.dir, 'binding.json')), previousBinding);
  delete f.state.bodies[6]; f.state.requests = [];
  const result = await migrateContinuationRules(f.spec, spec, options);
  assert.equal(result.anchors.length, 3); assert.deepEqual(fs.readFileSync(f.file), original);
  assert.deepEqual(f.state.requests, ['/new/book', '/new/c/4', '/new/c/5', '/new/c/6']);
  const binding = readJson(path.join(f.dir, 'binding.json')).value;
  assert.equal(binding.source.extraction, extractionHash(spec)); assert.equal(binding.ruleMigrations.length, 1);
  assert.deepEqual(binding.catalog, previousBinding.value.catalog);
  f.state.count = 7;
  const updated = await acquire(spec, {...f.options, mode: 'download'});
  assert.equal(updated.continuationAdded, 1, JSON.stringify(updated.failures));
  assert.equal(readJson(path.join(f.dir, 'binding.json')).value.ruleMigrations.length, 1);
  assert.deepEqual(readJson(f.file).chapters.slice(0, JSON.parse(original).chapters.length), JSON.parse(original).chapters);
  await assert.rejects(migrateContinuationRules(spec, {...spec, variant: 'v3', chapter: {...spec.chapter, content: '.other'}}, options), /其他提取变化/);
  await assert.rejects(migrateContinuationRules(spec, {...spec, variant: 'v3', chapter: {...spec.chapter, removeText: []}}, options), /其他提取变化/);
});

test('a reviewed edition takes priority over raw copies while its existing source keeps the original update flow', async t => {
  const f = await fixture(t), readingDir = path.join(f.options.stateDir, 'jobs', '12345678901234567890');
  const state = {identity: f.book, outputPath: f.file};
  atomicWrite(path.join(readingDir, 'reading-edition.json'), {hash: hash(state), value: state});
  atomicWrite(path.join(readingDir, 'spec.json'), {...f.spec, sourceUrl: f.book.sourceUrl});
  atomicWrite(path.join(f.options.outputDir, 'raw-copy.json'), {...f.book, sourceUrl: f.spec.sourceUrl});
  assert.equal(continuationState(f.spec, f.options).continuation.file, path.basename(f.file));
  assert.equal(continuationState({...f.spec, sourceUrl: f.book.sourceUrl}, f.options), null);
});

test('same-book writers serialize across sources and reject an output outside the download directory', async t => {
  const f = await fixture(t);
  await assert.rejects(f.run({continuation: {file: '../escape.json', hash: f.choose().hash}}), /文件名无效/);
  const release = acquireLock(path.join(f.options.stateDir, 'book-locks', continuationKey(f.spec) + '.lock'));
  try { await assert.rejects(f.run(), /另一个采集进程/); } finally { release(); }
});

test('interrupted commits recover after output rename and reject unrelated edits or corrupted journals', async t => {
  const f = await fixture(t); await f.run();
  const bindingFile = path.join(f.dir, 'binding.json'), previous = readJson(bindingFile).value;
  const nextBook = {...readJson(f.file), description: '已验证的新简介'}, next = {...previous, revision: previous.revision + 1, exportHash: hash(JSON.stringify(nextBook, null, 2) + '\n')};
  const journal = path.join(f.dir, 'pending.json'), value = {previousBindingHash: hash(previous), previousExportHash: previous.exportHash, next, book: nextBook};
  atomicWrite(journal, {hash: hash(value), value});
  atomicWrite(f.file, {...nextBook, description: '不同内容'});
  assert.throws(() => recoverContinuation(f.spec, f.options), /被修改/);
  atomicWrite(f.file, nextBook);
  assert.equal(recoverContinuation(f.spec, f.options).revision, next.revision);
  assert.equal(fs.existsSync(journal), false); assert.equal(readJson(f.file).description, '已验证的新简介');
  atomicWrite(journal, {}); assert.throws(() => recoverContinuation(f.spec, f.options), /损坏/);
});

test('desktop offers switch updates, runs through worker, and retains remembered updates after reopening', async t => {
  const f = await fixture(t), sitesDirectory = path.join(f.options.stateDir, 'sites'); fs.mkdirSync(sitesDirectory);
  f.state.count = 7;
  f.state.titles[6] = title(5); f.state.bodies[6] = body(5);
  f.state.titles[7] = title(6); f.state.bodies[7] = body(6);
  const site = {version: 1, id: 'fixture', name: '测试来源', home: 'https://books.example/', hosts: ['books.example'], book: {urlPattern: '^/new/book$', metadata: f.spec.metadata}, spec: f.spec};
  atomicWrite(path.join(sitesDirectory, 'fixture.json'), site);
  const settings = {...f.options, sitesDirectory, findBooks: async () => [{title: f.spec.title, author: f.spec.author, url: 'https://books.example/new/book', site: '测试来源'}], prepareBook: async () => f.spec};
  let app = await createDesktop(settings);
  const browser = await puppeteer.launch({headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  t.after(async () => { await browser.close(); await app?.close(); });
  const page = await browser.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewport({width: 1180, height: 920}); await page.goto(app.url);
  await page.waitForSelector('.site-choice');
  await page.$eval('#website', el => { el.value = 'https://books.example/'; });
  await page.type('#title', f.spec.title); await page.click('#search');
  await page.waitForFunction(() => document.getElementById('start').textContent.includes('换源续更'));
  assert.match(await page.$eval('.local-state', el => el.textContent), /4 项/);
  for (const width of [1180, 560, 390, 320]) {
    await page.setViewport({width, height: 920});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  await page.click('#start');
  await page.waitForFunction(() => document.getElementById('phase').textContent === '已完成', {timeout: 20000});
  assert.match(await page.$eval('#task-message', el => el.textContent), /本次追加 2 项/);
  assert.match(await page.$eval('#task-message', el => el.textContent), /自动处理 1 项重复或编号差异/);
  assert.match(await page.$eval('#start', el => el.textContent), /检查更新/);
  assert.equal(app.state().report.continuation, true); assert.deepEqual(errors, []);
  await app.close(); app = await createDesktop(settings);
  assert.equal(app.state().report.continuationAdded, 2);
  assert.equal(app.state().report.automaticResolutions, 1);
  assert.equal(localBookState(f.spec, f.options).state, 'complete');
});
