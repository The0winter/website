import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import puppeteer from 'puppeteer';
import {acquire, bindReadingEdition, jobId} from '../core.mjs';
import {atomicWrite, hash, readJson} from '../storage.mjs';
import {planLibrary, updateLibrary} from '../desktop/library.mjs';
import {specForBook} from '../desktop/sources.mjs';
import {createDesktop} from '../desktop/server.mjs';
import {createLibraryControl} from '../desktop/library-control.mjs';

const title = n => `第${n}章 山间故事${n}`;
const body = n => Array.from({length: 180}, (_, i) => String.fromCodePoint(0x4e00 + n * 200 + i)).join('').repeat(4);
async function fixture(t) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-library-')), outputDir = path.join(stateDir, 'downloads');
  const state = {counts: {alpha: 3, beta: 3}, requests: [], fail: null, hold: null, failures: {}, retryAfter: null};
  const server = http.createServer((req, res) => {
    state.requests.push(req.url);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (state.hold === req.url) return;
    if (state.failures[req.url] > 0) {
      state.failures[req.url]--; res.statusCode = 503;
      if (state.retryAfter) res.setHeader('Retry-After', state.retryAfter);
      return res.end('temporary read failure');
    }
    const [, kind, id, number] = req.url.split('/');
    if (id === state.fail) { res.statusCode = 503; return res.end('source unavailable'); }
    if (kind === 'book') return res.end(`<h1>${id}故事</h1><b>测试作者</b><nav>${Array.from({length: state.counts[id] || 3}, (_, i) => `<a href="/chapter/${id}/${i+1}">${title(i+1)}</a>`).join('')}</nav>`);
    if (kind === 'text') return res.end(Array.from({length: 3}, (_, i) => `${title(i+1)}\n${body(i+1)}`).join('\n'));
    res.end(`<h1>${title(Number(number))}</h1><article>${body(Number(number))}</article>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(stateDir), os.tmpdir()); assert.ok(path.basename(stateDir).startsWith('novel-library-'));
    fs.rmSync(stateDir, {recursive: true, force: true});
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const site = {id: 'fixture', name: '测试来源', home: base + '/', hosts: ['127.0.0.1'],
    book: {urlPattern: '^/book/(?<bookId>[a-z]+)$', metadata: {title: 'h1', author: 'b'}},
    spec: {version: 1, kind: 'html', variant: 'library-v1', title: '${title}', author: '${author}', sourceUrl: '${sourceUrl}',
      delayMs: 200, retries: 0, timeoutMs: 1000, metadata: {title: 'h1', author: 'b'}, catalog: {links: 'nav a'}, chapter: {title: 'h1', content: 'article'}}};
  const options = {stateDir, outputDir, sites: [site], onFailure: async () => 'skip'};
  const spec = id => specForBook({url: base + '/book/' + id, title: `${id}故事`, author: '测试作者'}, [site]);
  const seed = async id => {
    const report = await acquire(spec(id), {...options, mode: 'download'});
    assert.ok(report.exportFile, JSON.stringify(report.failures)); return report.exportFile;
  };
  const legacy = (id, overrides = {}) => {
    const book = {title: `${id}故事`, author: '测试作者', sourceUrl: base + '/book/' + id,
      chapters: Array.from({length: 3}, (_, i) => ({chapter_number: i+1, title: title(i+1), content: body(i+1), link: `${base}/chapter/${id}/${i+1}`})), ...overrides};
    const file = path.join(outputDir, `${id}.json`); atomicWrite(file, book); return file;
  };
  return {options, state, site, spec, seed, legacy, base};
}
const request = (app, action, body = {}) => fetch(`${app.baseUrl}/api/${action}`, {method: 'POST', headers: {'x-desktop-token': app.token, 'Content-Type': 'application/json'}, body: JSON.stringify(body)});
async function until(check) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 40)); }
  assert.fail('timed out');
}

test('batch appends only new raw chapters, continues after manual skip, and reuses unchanged exports', async t => {
  const f = await fixture(t), alpha = await f.seed('alpha'), beta = await f.seed('beta');
  const original = readJson(alpha), betaBytes = fs.readFileSync(beta), betaTime = fs.statSync(beta).mtimeMs;
  f.legacy('aaa'); f.state.fail = 'aaa';
  f.legacy('unknown', {sourceUrl: 'https://unadapted.example/book/1'});
  atomicWrite(path.join(f.options.outputDir, 'report.json'), {errors: 0, sourceUrl: f.base});
  f.state.counts.alpha = 5; f.state.requests = [];
  const result = await updateLibrary(f.options);
  assert.equal(result.total, 4); assert.equal(result.updated, 1); assert.equal(result.unchanged, 1);
  assert.equal(result.failed, 0); assert.equal(result.skipped, 2); assert.equal(result.added, 2);
  assert.equal(f.state.requests.filter(url => url === '/book/aaa').length, 3);
  assert.deepEqual(readJson(alpha).chapters.slice(0, 3), original.chapters);
  assert.deepEqual(fs.readFileSync(beta), betaBytes); assert.equal(fs.statSync(beta).mtimeMs, betaTime);
  assert.deepEqual(f.state.requests.filter(url => url.startsWith('/chapter/')), ['/chapter/alpha/4', '/chapter/alpha/5']);
  const mtime = fs.statSync(alpha).mtimeMs; f.state.requests = [];
  const next = await updateLibrary(f.options);
  assert.equal(next.unchanged, 2); assert.equal(next.added, 0); assert.equal(fs.statSync(alpha).mtimeMs, mtime);
  assert.deepEqual(f.state.requests.filter(url => url.startsWith('/chapter/')), []);
});

test('legacy updates verify the tail and preserve existing chapter objects in the original file', async t => {
  const f = await fixture(t), file = f.legacy('alpha'), original = readJson(file);
  f.state.counts.alpha = 4;
  const result = await updateLibrary(f.options);
  assert.equal(result.updated, 1, JSON.stringify(result.items)); assert.equal(result.added, 1);
  assert.equal(readJson(file).chapters.length, 4); assert.deepEqual(readJson(file).chapters.slice(0, 3), original.chapters);
  f.state.counts.alpha = 5; f.state.requests = [];
  const next = await updateLibrary(f.options);
  assert.equal(next.added, 1); assert.deepEqual(f.state.requests.filter(url => url.startsWith('/chapter/')), ['/chapter/alpha/5']);
  assert.equal(planLibrary(f.options)[0].continuation.file, path.basename(file));
});

test('a remembered switched source wins over the original export URL', async t => {
  const f = await fixture(t), file = f.legacy('alpha', {sourceUrl: 'https://old.example/book/7'});
  const spec = f.spec('alpha');
  const report = await acquire(spec, {...f.options, continuation: {file: path.basename(file), hash: hash(fs.readFileSync(file))}, mode: 'download'});
  assert.ok(report.exportFile, JSON.stringify(report.failures));
  const [plan] = planLibrary(f.options);
  assert.equal(plan.state, 'pending'); assert.equal(plan.url, spec.sourceUrl);
  assert.equal(readJson(file).sourceUrl, 'https://old.example/book/7');
  f.site.spec.variant = 'library-v2';
  assert.match(planLibrary(f.options)[0].message, /规则已变化/);
});

test('reading bindings select the reviewed file once and keep old raw exports untouched', async t => {
  const f = await fixture(t), rawFile = await f.seed('alpha'), originalRaw = fs.readFileSync(rawFile);
  const readingFile = path.join(f.options.outputDir, 'reading.json'), reading = readJson(rawFile);
  reading.chapters = reading.chapters.map(chapter => ({...chapter, sourceChapterNumber: chapter.chapter_number, sourceChapterUrl: chapter.link}));
  atomicWrite(readingFile, reading);
  await bindReadingEdition(f.spec('alpha'), readingFile, f.options);
  const plans = planLibrary(f.options);
  assert.equal(plans.length, 1); assert.equal(plans[0].file, 'reading.json'); assert.equal(plans[0].state, 'pending');
  f.state.counts.alpha = 4;
  const result = await updateLibrary(f.options);
  assert.equal(result.added, 1, JSON.stringify(result.items)); assert.equal(readJson(readingFile).chapters.length, 4);
  assert.deepEqual(fs.readFileSync(rawFile), originalRaw);
  f.site.spec.variant = 'library-v2';
  assert.equal(planLibrary(f.options)[0].state, 'blocked');
});

test('TXT exports and reading editions keep their verified spec and append through the same catalog', async t => {
  for (const readingEdition of [false, true]) {
    const f = await fixture(t);
    const spec = {...f.spec('alpha'), kind: 'txt', variant: 'verified-txt-v1',
      resource: {url: f.base + '/text/alpha', removeText: ['【合成广告】']}};
    const seeded = await acquire(spec, {...f.options, mode: 'download'});
    assert.equal(seeded.structuralPass, true);
    let file = seeded.exportFile;
    if (readingEdition) {
      const reading = readJson(file);
      reading.chapters = reading.chapters.map(c => ({...c, sourceChapterNumber: c.chapter_number, sourceChapterUrl: c.link}));
      file = path.join(f.options.outputDir, 'reading.json'); atomicWrite(file, reading);
      await bindReadingEdition(spec, file, f.options);
    }
    const original = readJson(file);
    const [plan] = planLibrary(f.options);
    assert.equal(plan.state, 'pending'); assert.equal(plan.spec.kind, 'txt');
    assert.equal(plan.spec.variant, spec.variant); assert.equal(plan.continuation, undefined);
    assert.deepEqual(plan.spec.resource, spec.resource);
    f.state.counts.alpha = 4; f.state.requests = [];
    const result = await updateLibrary(f.options);
    assert.equal(result.added, 1, JSON.stringify(result.items));
    assert.deepEqual(readJson(file).chapters.slice(0, 3), original.chapters);
    assert.deepEqual(f.state.requests.filter(url => url.startsWith('/chapter/')), ['/chapter/alpha/4']);
    const bytes = fs.readFileSync(file);
    assert.equal((await updateLibrary(f.options)).unchanged, 1);
    assert.deepEqual(fs.readFileSync(file), bytes);
    fs.appendFileSync(file, '\n');
    assert.equal(planLibrary(f.options)[0].state, 'blocked');
  }
});

test('modified exports, duplicate versions and damaged bindings are protected before source requests', async t => {
  const f = await fixture(t), raw = await f.seed('alpha');
  fs.appendFileSync(raw, '\n'); const modified = fs.readFileSync(raw);
  f.legacy('beta'); fs.copyFileSync(path.join(f.options.outputDir, 'beta.json'), path.join(f.options.outputDir, 'beta-copy.json'));
  f.state.requests = [];
  const result = await updateLibrary(f.options);
  assert.equal(result.skipped, 2); assert.deepEqual(f.state.requests, []); assert.deepEqual(fs.readFileSync(raw), modified);
  assert.ok(result.items.some(item => /已被修改/.test(item.message)));
  assert.ok(result.items.some(item => /多个同名/.test(item.message)));
  const dir = path.join(f.options.stateDir, 'jobs', jobId(f.spec('alpha')));
  atomicWrite(path.join(dir, 'reading-edition.json'), {hash: 'invalid', value: {}});
  assert.match(planLibrary(f.options).find(item => item.title === 'alpha故事').message, /损坏/);
});

test('queue detects edits after scanning and abort stops remaining books without fetching them', async t => {
  const f = await fixture(t), alpha = await f.seed('alpha'); await f.seed('beta');
  let changed = false; f.state.requests = [];
  const first = await updateLibrary({...f.options, onLibrary: batch => {
    if (!changed && batch.items.some(item => item.state === 'running')) { changed = true; fs.appendFileSync(alpha, '\n'); }
  }});
  assert.equal(first.skipped, 1); assert.equal(first.unchanged, 1); assert.match(first.items[0].message, /排队期间/);
  const controller = new AbortController(); f.state.requests = [];
  const stopped = await updateLibrary({...f.options, signal: controller.signal, onLibrary: () => controller.abort()});
  assert.equal(stopped.stopped, true); assert.deepEqual(f.state.requests, []);
  assert.equal(stopped.items.find(item => item.title === 'beta故事').state, 'stopped');
});

test('desktop button runs the real worker, blocks duplicate work, survives refresh and supports stop/restart', async t => {
  const f = await fixture(t), file = await f.seed('alpha'); await f.seed('beta');
  const config = {...f.options, loadSources: () => ({sites: [f.site], errors: []})};
  let app = await createDesktop(config);
  const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', puppeteer.executablePath()].find(file => fs.existsSync(file));
  const browser = await puppeteer.launch({headless: true, executablePath});
  try {
    const page = await browser.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(app.url); await page.waitForSelector('#update-library');
    f.state.counts.alpha = 5; f.state.hold = '/chapter/alpha/5'; f.state.requests = [];
    await page.click('#update-library');
    await until(() => f.state.requests.includes('/chapter/alpha/5'));
    assert.equal((await request(app, 'update-library')).status, 409);
    assert.equal((await request(app, 'search', {website: 'ixdzs8.com', title: 'anything'})).status, 409);
    assert.equal((await fetch(app.baseUrl + '/api/update-library', {method: 'POST'})).status, 403);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#update-library').disabled);
    assert.equal(await page.$eval('#update-library-label', el => el.textContent), '正在更新');
    await page.click('#stop');
    await until(() => app.state().phase === 'stopped');
    await page.waitForFunction(() => !document.querySelector('#update-library').disabled);
    assert.equal(readJson(file).chapters.length, 3);
    assert.equal(f.state.requests.includes('/book/beta'), false);
    const stopped = readJson(path.join(f.options.stateDir, 'desktop-last-task.json'));
    assert.equal(stopped.batch.items.find(item => item.title === 'beta故事').state, 'stopped');
    f.state.hold = null; await app.close(); app = await createDesktop(config);
    await page.goto(app.url); await page.waitForFunction(() => document.querySelector('#phase').textContent === '已停止');
    await page.click('#update-library'); await until(() => app.state().phase === 'complete');
    await page.waitForFunction(() => !document.querySelector('#update-library').disabled);
    assert.equal(app.state().batch.added, 2); assert.equal(app.state().batch.unchanged, 1);
    assert.equal(f.state.requests.filter(url => url === '/chapter/alpha/4').length, 1, 'saved probe chapter must be reused');
    assert.equal(readJson(file).chapters.length, 5);
    assert.equal(await page.$eval('#resume', el => el.hidden), true);
    assert.match(await page.$eval('#library-summary', el => el.textContent), /新增 2 章/);
    await page.waitForFunction(() => document.querySelector('#progress-bar').getBoundingClientRect().width / document.querySelector('.progress-track').getBoundingClientRect().width > .995);
    const images = path.resolve('.novel-crawler/library-update-qa'); fs.mkdirSync(images, {recursive: true});
    for (const width of [1180, 800, 390, 320]) {
      await page.setViewport({width, height: 920});
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow at ${width}`);
      const bounds = await page.$eval('#update-library', el => { const r = el.getBoundingClientRect(); return {right: r.right, top: r.top}; });
      assert.ok(bounds.right <= width); assert.ok(bounds.top >= 0);
      await page.screenshot({path: path.join(images, `complete-${width}.png`), fullPage: true});
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await app.close(); }
});

test('empty libraries complete and interrupted saved batches restart as stopped', async t => {
  const f = await fixture(t);
  assert.equal((await updateLibrary(f.options)).total, 0);
  atomicWrite(path.join(f.options.stateDir, 'desktop-last-task.json'), {kind: 'library', phase: 'download', batch: {total: 1, items: [{title: '合成书', state: 'running'}]}});
  const app = await createDesktop({...f.options, loadSources: () => ({sites: [f.site], errors: []})});
  try { assert.equal(app.state().phase, 'paused'); assert.equal(app.state().batch.items[0].state, 'stopped'); assert.match(app.state().message, /更新书库/); }
  finally { await app.close(); }
});

test('two automatic retries recover a temporary chapter failure without asking for help', async t => {
  const f = await fixture(t), file = await f.seed('alpha'), before = readJson(file);
  f.state.counts.alpha = 4; f.state.failures['/chapter/alpha/4'] = 2; f.state.requests = [];
  const statuses = [];
  const result = await updateLibrary({...f.options, onStatus: status => statuses.push(status), onFailure: () => assert.fail('should recover automatically')});
  assert.equal(result.added, 1); assert.equal(result.updated, 1);
  assert.deepEqual(readJson(file).chapters.slice(0, 3), before.chapters);
  assert.equal(f.state.requests.filter(url => url === '/chapter/alpha/4').length, 3);
  assert.equal(statuses.filter(status => status.kind === 'retrying').length, 2);
  assert.match(statuses.find(status => status.kind === 'retrying').message, /1\/2/);
});

test('long Retry-After and protected files ask for help without automatic retry loops', async t => {
  const f = await fixture(t), file = await f.seed('alpha'), original = fs.readFileSync(file);
  f.state.failures['/book/alpha'] = 10; f.state.retryAfter = '120'; f.state.requests = [];
  let asked = 0;
  const limited = await updateLibrary({...f.options, onFailure: book => { asked++; assert.match(book.message, /Retry-After=120/); return 'skip'; }});
  assert.equal(asked, 1); assert.equal(limited.skipped, 1); assert.equal(f.state.requests.length, 1);
  f.state.failures = {}; f.state.retryAfter = null; f.state.requests = [];
  fs.appendFileSync(file, '\n');
  const restored = await updateLibrary({...f.options, onFailure: book => {
    assert.match(book.message, /已被修改/); assert.deepEqual(f.state.requests, []); fs.writeFileSync(file, original); return 'retry';
  }});
  assert.equal(restored.unchanged, 1);
});

test('stop and gentle pause release an indefinite help wait without reading the next book', async t => {
  for (const mode of ['stop', 'pause']) {
    const f = await fixture(t), file = await f.seed('alpha'); await f.seed('beta');
    fs.appendFileSync(file, '\n'); f.state.requests = [];
    const controller = new AbortController(); let paused = false;
    const control = createLibraryControl({signal: controller.signal, shouldStop: () => paused});
    const result = await updateLibrary({...f.options, onFailure: undefined, signal: controller.signal, shouldStop: () => paused, control,
      onLibrary: batch => { if (batch.items.some(item => item.state === 'waiting')) { if (mode === 'stop') controller.abort(); else { paused = true; control.interrupt(); } } }});
    assert.equal(result.stopped, true); assert.deepEqual(f.state.requests, []);
    assert.ok(result.items.every(item => item.state === 'stopped'));
  }
});

test('desktop waits after three failed reads, survives refresh, retries and skips only the selected book', async t => {
  const f = await fixture(t), file = await f.seed('alpha'); await f.seed('beta');
  f.state.counts.alpha = 6; f.state.failures['/chapter/alpha/4'] = 20; f.state.requests = [];
  const app = await createDesktop({...f.options, loadSources: () => ({sites: [f.site], errors: []})});
  const browser = await puppeteer.launch({headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  try {
    const page = await browser.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({width: 1180, height: 920}); await page.goto(app.url);
    await page.waitForSelector('.site-choice'); await page.click('#update-library');
    await page.waitForSelector('#library-help', {visible: true});
    assert.equal(app.state().phase, 'library-wait');
    const alphaId = app.state().batch.items.find(item => item.state === 'waiting').controlId;
    assert.equal(f.state.requests.filter(url => url === '/chapter/alpha/4').length, 3);
    assert.equal(f.state.requests.includes('/chapter/alpha/5'), false, 'a failed page must wait for help before later chapters');
    assert.equal(f.state.requests.includes('/book/beta'), false);
    assert.equal(readJson(file).chapters.length, 3);
    assert.match(await page.$eval('#library-help', el => el.textContent), /第 4 项/);
    assert.match(await page.title(), /需要你处理/);
    const saved = readJson(path.join(f.options.stateDir, 'desktop-last-task.json'));
    assert.equal(saved.phase, 'library-wait');
    const count = f.state.requests.length;
    await page.reload(); await page.waitForSelector('#library-retry', {visible: true});
    assert.equal(f.state.requests.length, count, 'refresh must not retry or advance');
    const images = path.resolve('.novel-crawler/library-help-qa'); fs.mkdirSync(images, {recursive: true});
    for (const width of [1180, 390, 320]) {
      await page.setViewport({width, height: 920});
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({path: path.join(images, `waiting-${width}.png`), fullPage: true});
    }
    f.state.failures = {}; f.state.fail = 'beta';
    await page.click('#library-retry');
    await until(() => app.state().phase === 'library-wait' && app.state().title === 'beta故事');
    await page.waitForFunction(() => document.querySelector('#library-help').textContent.includes('beta故事'));
    assert.equal(readJson(file).chapters.length, 6);
    assert.equal((await request(app, 'library-action', {controlId: alphaId, action: 'skip'})).status, 409);
    await page.click('#library-skip');
    await until(() => app.state().phase === 'complete');
    assert.equal(app.state().batch.updated, 1); assert.equal(app.state().batch.skipped, 1);
    assert.match(app.state().batch.items.find(item => item.title === 'beta故事').message, /手动跳过/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await app.close(); }
});

test('manual skip aborts a pending source request and lets the next book finish', async t => {
  const f = await fixture(t); await f.seed('alpha'); await f.seed('beta');
  f.state.hold = '/book/alpha'; f.state.requests = [];
  const app = await createDesktop({...f.options, loadSources: () => ({sites: [f.site], errors: []})});
  try {
    await request(app, 'update-library'); await until(() => f.state.requests.includes('/book/alpha'));
    const current = app.state().batch.items.find(item => item.state === 'running');
    assert.equal((await request(app, 'library-action', {controlId: current.controlId, action: 'skip'})).status, 200);
    await until(() => app.state().phase === 'complete');
    assert.equal(app.state().batch.skipped, 1); assert.equal(app.state().batch.unchanged, 1);
    assert.equal(f.state.requests.filter(url => url === '/book/alpha').length, 1);
  } finally { await app.close(); }
});

test('skipping during verification retains the source and reason in the completed batch', async t => {
  const f = await fixture(t); await f.seed('alpha');
  const control = createLibraryControl();
  let currentId;
  const result = await updateLibrary({...f.options, control,
    onLibrary: batch => { currentId = batch.items.find(item => item.state === 'running')?.controlId; },
    createClient: options => ({status: options.onStatus, close: async () => {}}),
    collect: async (_spec, {client}) => {
      client.status({kind: 'verification', url: f.base + '/chapter/alpha/3', message: '网站要求人机验证，等待处理'});
      assert.equal(control.act(currentId, 'skip'), true);
      return {paused: true};
    }});
  assert.equal(result.skipped, 1);
  assert.match(result.items[0].message, /已手动跳过.*人机验证/);
  assert.equal(result.items[0].failure.code, 'verification-required');
  assert.equal(result.items[0].failure.url, f.base + '/chapter/alpha/3');
});
