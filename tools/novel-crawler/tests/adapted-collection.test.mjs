import '../../test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import puppeteer from 'puppeteer';
import {adaptedBooklist, planAdaptedCollection, collectAdapted} from '../desktop/adapted-collection.mjs';
import {createDesktop} from '../desktop/server.mjs';
import {atomicWrite, hash, readJson} from '../storage.mjs';
import {jobId, validateSpec} from '../core.mjs';

const sites = [{id: 'fixture', name: '合成来源', home: 'https://fixture.example/', hosts: ['fixture.example', '127.0.0.1'], spec: {transport: 'http'}}];
function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adapted-collection-'));
  t.after(() => { assert.equal(path.dirname(dir), os.tmpdir()); fs.rmSync(dir, {recursive: true, force: true}); });
  return dir;
}
const specFor = (title, extra = {}) => ({version: 1, kind: 'html', title, author: '测试作者', sourceUrl: `https://fixture.example/book/${encodeURIComponent(title)}`, metadata: {title: 'h1', author: 'b'}, catalog: {links: 'nav a'}, chapter: {title: 'h1', content: 'article'}, delayMs: 200, ...extra});
function listFor(dir, specs) {
  const list = {version: 1, eligibleForAutomaticAcquisition: true, books: specs.map((spec, index) => {
    const file = path.join(dir, 'candidates', `${index}.json`); atomicWrite(file, spec);
    return {rank: index + 1, title: spec.title, author: spec.author, website: {id: 'fixture', name: '合成来源', url: spec.sourceUrl, adapted: true}, status: '优先候选（抽查通过）', candidateSpec: file, candidateSpecHash: hash(spec), collectionApproved: true, collectionIdentity: {title: spec.title, author: spec.author}};
  })};
  atomicWrite(adaptedBooklist(dir), list); return list;
}
const options = dir => ({stateDir: dir, outputDir: path.join(dir, 'out'), sites});
const state = async app => { const response = await fetch(app.baseUrl + '/api/state', {headers: {'x-desktop-token': app.token}}); assert.equal(response.status, 200); return response.json(); };
const post = (app, route, token = app.token) => fetch(app.baseUrl + '/api/' + route, {method: 'POST', headers: {'x-desktop-token': token, 'content-type': 'application/json'}, body: '{}'});
async function until(check, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const result = await check(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 40)); }
  assert.fail('等待任务状态超时');
}

test('approved list filters pending sites, verifies exact config and skips existing aliases across sources', t => {
  const dir = temp(t), specs = [specFor('新故事', {titleAliases: ['旧名新故事']}), specFor('旧故事', {titleAliases: ['往日故事']}), specFor('未适配'), specFor('待核验'), specFor('变更配置'), specFor('越界'), specFor('不同身份'), specFor('旧名新故事')];
  const list = listFor(dir, specs);
  list.books[2].website.adapted = false;
  list.books[3].status = '待复核';
  atomicWrite(list.books[4].candidateSpec, {...specs[4], variant: 'changed'});
  const outside = path.join(dir, 'outside.json'); atomicWrite(outside, specs[5]); list.books[5].candidateSpec = outside;
  list.books[6].collectionIdentity.author = '另一作者';
  atomicWrite(adaptedBooklist(dir), list);
  const plan = planAdaptedCollection({...options(dir), inventory: [{title: '往日故事', author: '測試作者', url: 'https://other.example/', state: 'blocked'}]});
  assert.deepEqual(plan.map(p => p.item.state), ['pending', 'existing', 'deferred', 'deferred', 'deferred', 'deferred', 'deferred', 'deferred']);
  assert.match(plan[4].item.message, /已变化/);
  assert.match(plan[5].item.message, /candidates/);
  assert.match(plan[6].item.message, /身份/);
  assert.match(plan[7].item.message, /重复/);
  list.eligibleForAutomaticAcquisition = false; atomicWrite(adaptedBooklist(dir), list);
  assert.throws(() => planAdaptedCollection({...options(dir), inventory: []}), /尚未启用/);
});

test('serial batch reuses TXT rules, continues failures, saves results and respects revoked specs', async t => {
  const dir = temp(t), txt = specFor('分段故事', {kind: 'txt', variant: 'approved-v3', resource: {url: 'https://fixture.example/book.txt', removeText: ['明确的来源标记']}});
  const list = listFor(dir, [specFor('故障故事'), txt, specFor('稍后变更')]);
  const calls = [], clients = [], events = [];
  const result = await collectAdapted({...options(dir), inventory: [], onLibrary: b => events.push(b), clientFactory: config => { assert.equal(config.browser.headless, true); const client = {closed: false, close: async () => { client.closed = true; }}; assert.ok(clients.every(c => c.closed)); clients.push(client); return client; }, acquireBook: async (spec, opts) => {
    calls.push([spec.title, opts.mode]);
    if (spec.title === '故障故事') throw Error('来源暂不可用');
    assert.deepEqual(spec.resource, txt.resource); assert.equal(spec.variant, txt.variant);
    if (opts.mode === 'probe') return {structuralPass: true};
    const exportFile = path.join(dir, 'out', 'book.json'); atomicWrite(exportFile, {title: spec.title});
    atomicWrite(list.books[2].candidateSpec, {...specFor('稍后变更'), variant: 'unreviewed'});
    return {exportFile, structuralPass: true, completeAgainstSource: true};
  }});
  assert.deepEqual(calls, [['故障故事', 'probe'], ['分段故事', 'download']]);
  assert.deepEqual(result.items.map(item => item.state), ['failed', 'collected', 'failed']);
  assert.equal(result.collected, 1); assert.equal(result.failed, 2); assert.equal(result.checked, 3);
  assert.ok(clients.every(c => c.closed));
  assert.equal(readJson(path.join(dir, 'adapted-collection.json')).finishedAt, result.finishedAt);
  assert.ok(events.some(b => b.items[1].state === 'running' && b.items[0].state === 'failed'));
});

test('supervision pins exact books across retries without filling from unrelated pending rows', async t => {
  const dir = temp(t), specs = ['已有', '待核验', '本轮新书', '不在本轮'].map(title => specFor(title));
  const list = listFor(dir, specs); list.books[1].collectionApproved = false; atomicWrite(adaptedBooklist(dir), list);
  atomicWrite(path.join(dir, 'booklists', 'second.json'), {...list, books: [list.books[2]]});
  const books = specs.slice(0, 3).map(({title, author}) => ({title, author})), calls = [];
  const common = {...options(dir), books, clientFactory: () => ({close: async () => {}}), acquireBook: async spec => { calls.push(spec.title); return {structuralPass: false, failures: [{error: '合成故障'}]}; }};
  const first = await collectAdapted({...common, inventory: [books[0]]});
  assert.equal(first.total, 3);assert.deepEqual(first.items.map(i => i.state), ['existing', 'deferred', 'failed']);assert.deepEqual(calls, ['本轮新书']);
  const retried = await collectAdapted({...common, inventory: [books[0], books[2]]});
  assert.equal(retried.total, 3);assert.deepEqual(retried.items.map(i => i.state), ['existing', 'deferred', 'existing']);assert.deepEqual(calls, ['本轮新书']);
  for (const invalid of [[], [{title: '已有'}], [books[0], books[0]]]) await assert.rejects(collectAdapted({...common, books: invalid}), /监督书目/);
  await assert.rejects(collectAdapted({...common, books: [{title: '不存在', author: '测试作者'}], inventory: []}), /不在已启用/);
  // A disabled first-list row must not hide the same approved book in another list.
  list.books[2].collectionApproved = false; atomicWrite(adaptedBooklist(dir), list);
  const available = await collectAdapted({...common, inventory: [books[0]]});
  assert.equal(available.total, 3);
  assert.deepEqual(available.items.map(i => i.state), ['existing', 'deferred', 'failed']);
  assert.deepEqual(calls, ['本轮新书', '本轮新书']);
});

test('quality failures expose exact positions, related chapters and the saved report', async t => {
  const dir = temp(t); listFor(dir, [specFor('重复书'), specFor('空章书')]);
  const batch = await collectAdapted({...options(dir), inventory: [], clientFactory: () => ({close: async () => {}}), acquireBook: async spec => ({
    structuralPass: false, downloaded: 10, expected: 12, reportFile: path.join(dir, `${spec.title}-report.json`),
    issues: spec.title === '重复书' ? [{level: 'error', code: 'duplicate-body', chapter: 8, otherChapter: 7, detail: '正文完全重复'}] : [],
    failures: spec.title === '空章书' ? [{chapter: 4, title: '第4章 重逢', link: 'https://fixture.example/4', error: '章节正文为空'}] : [],
  })});
  assert.equal(batch.failed, 2); assert.equal(batch.collected, 0);
  assert.match(batch.items[0].message, /第 8 项.*正文完全重复.*第 7 项/);
  assert.match(batch.items[1].message, /第 4 项「第4章 重逢」.*章节正文为空/);
  assert.equal(batch.items[0].problemCount, 1);
  assert.equal(batch.items[1].problems[0].link, 'https://fixture.example/4');
  assert.equal(readJson(path.join(dir, 'adapted-collection.json')).items[0].reportFile, path.join(dir, '重复书-report.json'));
});

test('resume uses one full download pass and still blocks failed full-book checks', async t => {
  const dir = temp(t), spec = validateSpec(specFor('续采书')); listFor(dir, [spec]);
  const job = path.join(dir, 'jobs', jobId(spec)), entry = {chapter_number: 1, title: '第1章', link: 'https://fixture.example/1'};
  atomicWrite(path.join(job, 'spec.json'), spec);
  atomicWrite(path.join(job, 'catalog.json'), [entry]);
  atomicWrite(path.join(job, 'chapters', hash(entry.link) + '.json'), {chapter: entry});
  atomicWrite(path.join(job, 'download-report.json'), {paused: true});
  const modes = [];
  const batch = await collectAdapted({...options(dir), inventory: [], clientFactory: () => ({close: async () => {}}), acquireBook: async (_, opts) => {
    modes.push(opts.mode); assert.equal(opts.stopOnFailure, true);
    return {structuralPass: false, completeAgainstSource: true, issues: [{level: 'error', code: 'duplicate-body', chapter: 2, otherChapter: 1, detail: '正文重复'}]};
  }});
  assert.deepEqual(modes, ['download']); assert.equal(batch.failed, 1); assert.equal(batch.collected, 0);
});

test('different sites overlap, shared domains stay serial and retain pacing across books', async t => {
  const dir = temp(t);
  const specs = [specFor('甲一'), specFor('甲二', {sourceUrl: 'https://alias.example/book/2', allowedHosts: ['alias.example', 'fixture.example']}), specFor('乙一', {sourceUrl: 'https://other.example/book/1'})];
  const configured = [{...sites[0], hosts: ['fixture.example', 'alias.example', 'other.example']}];
  // Separate sites; the candidate host allowlist ties only the first two lanes.
  configured[0].hosts = ['fixture.example', 'alias.example'];
  configured.push({...sites[0], id: 'other', hosts: ['other.example']});
  const list = listFor(dir, specs); list.books[2].website.id = 'other'; atomicWrite(adaptedBooklist(dir), list);
  let active = 0, maximum = 0, releaseFirst, releaseSecond;
  const first = new Promise(resolve => { releaseFirst = resolve; }), second = new Promise(resolve => { releaseSecond = resolve; });
  const clocks = [], order = [], phases = [], progress = [];
  const batch = await collectAdapted({...options(dir), sites: configured, inventory: [], concurrency: 2,
    onPhase: (_, item) => phases.push(item.title), onProgress: p => progress.push(p.title),
    adaptivePacing: true,
    clientFactory: config => { assert.equal(config.adaptivePacing, true); clocks.push(config.pacing); active++; maximum = Math.max(maximum, active); return {close: async () => { active--; }}; },
    acquireBook: async (spec, opts) => {
      order.push(spec.title); opts.onProgress({title: spec.title});
      if (spec.title === '甲一') { releaseFirst(); await second; }
      if (spec.title === '乙一') { await first; releaseSecond(); }
      return {structuralPass: false, failures: [{error: '合成来源失败'}]};
    }});
  assert.equal(maximum, 2); assert.equal(active, 0); assert.equal(batch.active, 0); assert.equal(batch.failed, 3);
  assert.deepEqual(order, ['甲一', '乙一', '甲二']);
  assert.equal(clocks[0], clocks[2]); assert.notEqual(clocks[0], clocks[1]);
  assert.equal(phases[0], '甲一'); assert.equal(progress[0], '甲一');
});

test('stopping parallel collection waits for both clients and leaves later books pending for resume', async t => {
  const dir = temp(t), specs = [specFor('甲一'), specFor('甲二'), specFor('乙一', {sourceUrl: 'https://other.example/book/1'})];
  const configured = [sites[0], {...sites[0], id: 'other', hosts: ['other.example']}];
  const list = listFor(dir, specs); list.books[2].website.id = 'other'; atomicWrite(adaptedBooklist(dir), list);
  const controller = new AbortController(), calls = []; let closed = 0;
  const batch = await collectAdapted({...options(dir), sites: configured, inventory: [], signal: controller.signal,
    clientFactory: () => ({close: async () => { await new Promise(resolve => setTimeout(resolve, 5)); closed++; }}),
    acquireBook: async spec => { calls.push(spec.title); if (calls.length === 2) controller.abort(); else await new Promise(resolve => controller.signal.addEventListener('abort', resolve, {once: true})); return {paused: true}; }});
  assert.deepEqual(calls, ['甲一', '乙一']); assert.equal(closed, 2); assert.equal(batch.stopped, true);
  assert.ok(batch.items.every(item => item.state === 'stopped')); assert.equal(batch.active, 0);
});

test('enabled booklists combine in stable order, deduplicate aliases and ignore unapproved lists', t => {
  const dir = temp(t), first = listFor(dir, [specFor('首批故事', {titleAliases: ['早期书名']})]);
  const second = listFor(dir, [specFor('第二批故事'), specFor('早期书名')]);
  // Preserve each list's actual approved candidate file, as in independent runs.
  fs.renameSync(path.join(dir, 'candidates', '0.json'), path.join(dir, 'candidates', 'second.json'));
  second.books[0].candidateSpec = path.join(dir, 'candidates', 'second.json');
  atomicWrite(first.books[0].candidateSpec, specFor('首批故事', {titleAliases: ['早期书名']}));
  atomicWrite(adaptedBooklist(dir), first);
  atomicWrite(path.join(dir, 'booklists', '豆瓣榜单.json'), {...second, title: '豆瓣中国小说'});
  atomicWrite(path.join(dir, 'booklists', '仅供参考.json'), {...second, eligibleForAutomaticAcquisition: false});
  const plans = planAdaptedCollection({...options(dir), inventory: []});
  assert.deepEqual(plans.map(p => [p.item.title, p.item.state]), [['首批故事', 'pending'], ['第二批故事', 'pending'], ['早期书名', 'deferred']]);
  assert.equal(plans[1].item.booklist, '豆瓣中国小说');
  assert.equal(plans[1].listFile, '豆瓣榜单.json');
});

test('pause stops the batch and failed quality never counts as an export', async t => {
  const dir = temp(t); listFor(dir, [specFor('第一故事'), specFor('第二故事')]);
  let paused = false, calls = 0;
  const common = {...options(dir), inventory: [], clientFactory: () => ({close: async () => {}})};
  const stopped = await collectAdapted({...common, shouldStop: () => paused, acquireBook: async () => { calls++; paused = true; return {structuralPass: true}; }});
  assert.equal(calls, 1); assert.equal(stopped.stopped, true); assert.equal(stopped.collected, 0);
  assert.deepEqual(stopped.items.map(i => i.state), ['stopped', 'stopped']);
  const failed = await collectAdapted({...common, acquireBook: async () => ({structuralPass: false, failures: [{error: '正文缺失'}]})});
  assert.equal(failed.failed, 2); assert.equal(failed.collected, 0); assert.match(failed.items[0].message, /正文缺失/);
});

test('a local edition arriving after planning is preserved without switching its source', async t => {
  const dir = temp(t); listFor(dir, [specFor('随后入库')]);
  const file = path.join(dir, 'out', 'arriving.json'), book = {title: '随后入库', author: '测试作者', sourceUrl: 'https://old.example/book/', chapters: [{title: '原章', content: '原文'}]};
  let planned = false;
  const batch = await collectAdapted({...options(dir), inventory: [], onLibrary: () => { if (!planned) { planned = true; atomicWrite(file, book); } }, acquireBook: async () => assert.fail('已有书不应采集或换源')});
  assert.equal(batch.existing, 1); assert.equal(batch.collected, 0); assert.deepEqual(readJson(file), book);
});

test('button collects synthetic chapters through the worker, preserves existing files, and restores idle after restart', async t => {
  const dir = temp(t), requestCounts = new Map();
  const paragraphs = ['春天的小城里，人们沿着河岸散步，欣赏枝头绽放的花朵。', '夕阳映照着远处的山峰，旅人停下脚步，听见林间清脆的鸟鸣。', '雨后的石桥映出灯火，院子里传来邻居相聚聊天的声音。'];
  const source = http.createServer((req, res) => {
    requestCounts.set(req.url, (requestCounts.get(req.url) || 0) + 1);
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (req.url === '/book') res.end(`<h1>合成验收故事</h1><b>测试作者</b><nav>${paragraphs.map((_, i) => `<a href="/chapter/${i + 1}">第${i + 1}章 旅途${i + 1}</a>`).join('')}</nav>`);
    else { const n = Number(req.url.split('/').at(-1)); res.end(`<h1>第${n}章 旅途${n}</h1><article>${paragraphs[n - 1]?.repeat(20) || ''}</article>`); }
  });
  await new Promise(resolve => source.listen(0, '127.0.0.1', resolve));
  const spec = specFor('合成验收故事', {sourceUrl: `http://127.0.0.1:${source.address().port}/book`});
  const list = listFor(dir, [spec, specFor('本地原版'), specFor('未批准')]); list.books[2].collectionApproved = false; atomicWrite(adaptedBooklist(dir), list);
  const existing = path.join(dir, 'out', 'existing.json'); atomicWrite(existing, {title: '本地原版', author: '测试作者', sourceUrl: 'https://old.example/', chapters: [{title: '旧章节', content: '保留原文'}]});
  const original = fs.readFileSync(existing);
  const config = {...options(dir), loadSources: () => ({sites, errors: []})};
  let app = await createDesktop(config), browser;
  try {
    assert.equal((await post(app, 'collect-adapted', 'wrong-token')).status, 403);
    const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', puppeteer.executablePath()].find(file => fs.existsSync(file));
    browser = await puppeteer.launch({headless: true, executablePath});
    const page = await browser.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({width: 1180, height: 920}); await page.goto(app.url);
    await page.waitForFunction(() => !document.querySelector('#collect-adapted').disabled);
    const artifactDir = process.env.CRAWLER_UI_ARTIFACT_DIR;
    if (artifactDir) { fs.mkdirSync(artifactDir, {recursive: true}); await page.screenshot({path: path.join(artifactDir, 'final-light.png')}); }
    for (const width of [1180, 1024, 980, 820, 730, 390, 320]) {
      await page.setViewport({width, height: 920});
      const layout = await page.evaluate(() => {
        const rects = [...document.querySelectorAll('header h1, header button')].map(el => { const r = el.getBoundingClientRect(); return {left: r.left, right: r.right, top: r.top, bottom: r.bottom}; });
        return {overflow: document.documentElement.scrollWidth > innerWidth, overlap: rects.some((a, i) => rects.slice(i + 1).some(b => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top))};
      });
      assert.deepEqual(layout, {overflow: false, overlap: false}, `header layout ${width}`);
    }
    await page.setViewport({width: 1180, height: 920}); await page.click('#theme-toggle');
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    if (artifactDir) await page.screenshot({path: path.join(artifactDir, 'final-dark.png')});
    await page.click('#collect-adapted');
    await until(async () => (await state(app)).task.busy);
    assert.equal((await post(app, 'collect-adapted')).status, 409);
    await until(() => requestCounts.has('/chapter/1'));
    assert.equal((await post(app, 'pause')).status, 200);
    const paused = await until(async () => { const s = await state(app); return s.task.phase === 'paused' && !s.task.busy && s; });
    assert.equal(paused.task.batch.collected, 0);
    assert.equal(paused.task.batch.stopped, true);
    assert.ok(!fs.readdirSync(path.join(dir, 'out')).some(file => file !== 'existing.json'));
    assert.equal((await post(app, 'collect-adapted')).status, 202);
    const done = await until(async () => { const s = await state(app); return s.task.phase === 'complete' && !s.task.busy && s; }, 30000);
    assert.equal(done.task.batch.collected, 1); assert.equal(done.task.batch.existing, 1); assert.equal(done.task.batch.deferred, 1);
    const exported = readJson(done.task.batch.items[0].exportFile); assert.equal(exported.chapters.length, 3);
    assert.ok(fs.readFileSync(existing).equals(original));
    await page.waitForFunction(() => document.querySelector('#library-summary').textContent.includes('已入库 1 本'));
    assert.equal(await page.$eval('#library-skip', el => el.hidden), true);
    if (artifactDir) {
      await page.waitForFunction(() => { const bar = document.querySelector('#progress-bar'); return bar.getBoundingClientRect().width >= bar.parentElement.getBoundingClientRect().width - 1; });
      await page.screenshot({path: path.join(artifactDir, 'verified-results.png')});
    }
    const countsBefore = [...requestCounts];
    assert.equal((await post(app, 'collect-adapted')).status, 202);
    const repeated = await until(async () => { const s = await state(app); return s.task.phase === 'complete' && !s.task.busy && s; });
    assert.equal(repeated.task.batch.collected, 0); assert.equal(repeated.task.batch.existing, 2);
    assert.deepEqual([...requestCounts], countsBefore); assert.deepEqual(errors, []);
    await app.close();
    atomicWrite(path.join(dir, 'desktop-last-task.json'), {...repeated.task, phase: 'download', kind: 'adapted'});
    app = await createDesktop(config);
    const restarted = await state(app); assert.equal(restarted.task.phase, 'paused'); assert.equal(restarted.task.busy, false); assert.match(restarted.task.message, /适配采集/);
    assert.deepEqual([...requestCounts], countsBefore);
  } finally { await browser?.close(); await app.close(); await new Promise(resolve => source.close(resolve)); }
});
