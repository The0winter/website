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
  assert.deepEqual(calls, [['故障故事', 'probe'], ['分段故事', 'probe'], ['分段故事', 'download']]);
  assert.deepEqual(result.items.map(item => item.state), ['failed', 'collected', 'failed']);
  assert.equal(result.collected, 1); assert.equal(result.failed, 2); assert.equal(result.checked, 3);
  assert.ok(clients.every(c => c.closed));
  assert.equal(readJson(path.join(dir, 'adapted-collection.json')).finishedAt, result.finishedAt);
  assert.ok(events.some(b => b.items[1].state === 'running' && b.items[0].state === 'failed'));
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
