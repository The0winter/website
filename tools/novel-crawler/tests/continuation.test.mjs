import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import puppeteer from 'puppeteer';
import {acquire, localBookState, validateSpec} from '../core.mjs';
import {continuationKey, continuationState, recoverContinuation} from '../continuation.mjs';
import {atomicWrite, readJson, hash, acquireLock} from '../storage.mjs';
import {createDesktop} from '../desktop/server.mjs';
import {loadSites, parseSearch} from '../desktop/sources.mjs';

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
      return res.end(`<h1>换源测试书</h1><b>${state.author}</b><nav>${numbers.map(n => `<a href="${prefix}/c/${n}">${state.titles[n] || title(n)}</a>`).join('')}${state.notice ? `<a href="${prefix}/notice">2026一月月票抽奖活动！</a>` : ''}</nav>`);
    }
    if (req.url.endsWith('/notice')) return res.end('<h1>2026一月月票抽奖活动！</h1><article>感谢各位读者支持本书。月票抽奖活动开始了。</article>');
    const n = Number(req.url.split('/').at(-1));
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
