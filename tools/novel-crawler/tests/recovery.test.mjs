import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import puppeteer from 'puppeteer';
import {makeClient} from '../http.mjs';
import {acquire, validateSpec} from '../core.mjs';
import {hash, atomicWrite} from '../storage.mjs';
import {createDesktop} from '../desktop/server.mjs';
import {loadSites} from '../desktop/sources.mjs';

async function fixture(t, handler) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-recovery-'));
  const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); handler(req, res); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('novel-recovery-'));
    fs.rmSync(dir, {recursive: true, force: true});
  });
  return {dir, base: `http://127.0.0.1:${server.address().port}`};
}
const specFor = base => ({version: 1, kind: 'html', title: '合成故事', author: '测试作者', sourceUrl: base + '/book', delayMs: 200, retries: 0,
  metadata: {title: 'h1', author: 'b'}, catalog: {links: 'nav a'}, chapter: {title: 'h1', content: 'article', rejectSelectors: ['.limit_box']}});
const bookPage = '<h1>合成故事</h1><b>测试作者</b><nav><a href="/a">第一章</a><a href="/b">第二章</a></nav>';
const restriction = '<h1>第一章</h1><article><div class="limit_box"><button onclick="toggleCode()">输入验证码</button></div>合成预览</article>';
const captcha = {selector: '.limit_box [onclick="toggleCode()"]', openSelector: '.limit_box [onclick="toggleCode()"]', timeoutMs: 5000};
const api = (app, route, body) => fetch(app.baseUrl + '/api/' + route, {method: body === undefined ? 'GET' : 'POST', headers: {'x-desktop-token': app.token, 'Content-Type': 'application/json'}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
async function until(check) {
  const deadline = Date.now() + 15000;
  while (!check()) { if (Date.now() > deadline) assert.fail('state wait timed out'); await new Promise(resolve => setTimeout(resolve, 30)); }
}

test('site CAPTCHA opens its form, refreshes a cached challenge and continues after external completion', async t => {
  let completed = false, formOpened = false, inputSubmitted = false, restrictedReads = 0;
  const f = await fixture(t, (req, res) => {
    if (req.url === '/opened') { formOpened = true; return res.end('ok'); }
    if (req.url === '/submitted') { inputSubmitted = true; return res.end('ok'); }
    if (req.url === '/session') return res.end(completed ? 'ready' : 'waiting');
    if (req.url !== '/a') { res.statusCode = 404; return res.end(); }
    if (!completed) { restrictedReads++; return res.end(restriction + '<form hidden><input name="code"><button>验证</button></form><script>function toggleCode(){ document.querySelector("form").hidden=false; fetch("/opened"); } document.querySelector("form").onsubmit=()=>fetch("/submitted"); setInterval(async()=>{if(await(await fetch("/session")).text()==="ready")location.reload()},100)</script>'); }
    res.end('<h1>第一章</h1><article>完整的合成正文。</article>');
  });
  const browser = {headless: false, minimized: true, responseMode: 'source', manualCaptcha: captcha};
  const url = f.base + '/a', cacheDir = path.join(f.dir, 'cache'), key = hash({url, request: undefined, render: true, browser});
  atomicWrite(path.join(cacheDir, key + '.bin'), Buffer.from(restriction));
  atomicWrite(path.join(cacheDir, key + '.json'), {url, original: url, fetchedAt: new Date().toISOString(), hash: hash(Buffer.from(restriction))});
  const statuses = [];
  const client = makeClient({cacheDir, allowedHosts: ['127.0.0.1'], delayMs: 200, browser, onStatus: status => statuses.push(status)});
  try {
    const pending = client.get(url, {render: true, readySelector: 'article', rejectSelectors: ['.limit_box']});
    await until(() => statuses.some(s => s.kind === 'verification'));
    await client.showBrowser();
    await until(() => formOpened);
    assert.equal(inputSubmitted, false, 'collector must not submit CAPTCHA');
    assert.equal(statuses[0].url, url); assert.ok(statuses[0].deadline > Date.now());
    completed = true;
    const response = await pending;
    assert.match(response.body.toString(), /完整的合成正文/);
    assert.equal(client.stats.cacheHits, 0); assert.equal(restrictedReads, 1);
    assert.deepEqual(statuses.map(s => s.kind), ['verification', 'active']);
    assert.doesNotMatch(fs.readFileSync(path.join(cacheDir, key + '.bin'), 'utf8'), /limit_box/);
    await assert.rejects(client.showBrowser(), /没有等待操作/);
  } finally { await client.close(); }
});

test('CAPTCHA timeout and cancellation never accept a DOM-hidden challenge or visit the next chapter', async t => {
  let later = 0, cancel = false;
  const f = await fixture(t, (req, res) => {
    if (req.url === '/book') return res.end(bookPage);
    if (req.url === '/b') later++;
    res.end(restriction + '<script>document.querySelector(".limit_box").remove()</script>');
  });
  const controller = new AbortController();
  const browser = {responseMode: 'source', manualCaptcha: {...captcha, timeoutMs: 1000}};
  const client = makeClient({cacheDir: path.join(f.dir, 'cache'), allowedHosts: ['127.0.0.1'], delayMs: 200, browser, signal: controller.signal, onStatus: status => { if (cancel && status.kind === 'verification') controller.abort(); }});
  try {
    const report = await acquire({...specFor(f.base), transport: 'browser', browser}, {stateDir: path.join(f.dir, 'state'), mode: 'download', client});
    assert.equal(report.downloaded, 0); assert.equal(report.failures.length, 1); assert.equal(later, 0);
    assert.equal(report.failures[0].chapter, 1); assert.match(report.failures[0].error, /手动验证码超时/);
    assert.match(report.failures[0].nextStep, /手动完成验证/);
    assert.equal(report.exportFile, null);
    assert.match(fs.readFileSync(report.summaryFile, 'utf8'), /下一步/);
    cancel = true;
    await assert.rejects(client.get(f.base + '/a', {render: true}), /已停止/);
  } finally { await client.close(); }
});

test('login followed by site CAPTCHA uses one session and only returns the unrestricted response', async t => {
  let stage = 'login';
  const f = await fixture(t, (req, res) => {
    if (req.url === '/session') return res.end(stage);
    const pageStage = stage;
    res.end(`<h1>第一章</h1><article>${stage === 'login' ? '<div class="login-required">登录</div>' : stage === 'captcha' ? '<div class="captcha-required">验证码</div>' : '完整合成正文'}</article><script>setInterval(async()=>{if(await(await fetch('/session')).text()!==${JSON.stringify(pageStage)})location.reload()},100)</script>`);
  });
  const statuses = [];
  const client = makeClient({cacheDir: path.join(f.dir, 'cache'), allowedHosts: ['127.0.0.1'], delayMs: 200, browser: {responseMode: 'source', manualLogin: {selector: '.login-required', timeoutMs: 4000}, manualCaptcha: {selector: '.captcha-required', timeoutMs: 4000}}, onStatus: s => { statuses.push(s.kind); if (s.kind === 'login') stage = 'captcha'; if (s.kind === 'verification') stage = 'ready'; }});
  try {
    assert.match((await client.get(f.base + '/a', {render: true})).body.toString(), /完整合成正文/);
    assert.deepEqual(statuses, ['login', 'verification', 'active']);
  } finally { await client.close(); }
});

test('unknown restrictions refresh old cache, stop once and expose the exact selector and recovery guidance', async t => {
  let reads = 0;
  const f = await fixture(t, (req, res) => { if (req.url === '/book') return res.end(bookPage); reads++; res.end('<h1>第一章</h1><article><div class="limit_box">合成权限限制</div></article>'); });
  const spec = specFor(f.base), cacheDir = path.join(f.dir, 'cache'), url = f.base + '/a';
  const key = hash({url, request: undefined, render: false, browser: undefined});
  atomicWrite(path.join(cacheDir, key + '.bin'), Buffer.from(restriction));
  atomicWrite(path.join(cacheDir, key + '.json'), {url, original: url, fetchedAt: new Date().toISOString(), hash: hash(Buffer.from(restriction))});
  const report = await acquire(spec, {stateDir: f.dir, mode: 'download'});
  assert.equal(reads, 1); assert.equal(report.failures.length, 1); assert.equal(report.downloaded, 0);
  assert.equal(report.failures[0].code, 'page-restricted'); assert.equal(report.failures[0].selector, '.limit_box');
  assert.equal(report.failures[0].url, url); assert.match(report.failures[0].nextStep, /核对账号权限/);
});

test('site CAPTCHA config is recognized and rejects invalid selector or timeout configuration', () => {
  const browser = loadSites().sites.find(site => site.id === 'banshanren').spec.browser;
  assert.match(browser.manualCaptcha.selector, /toggleCode/);
  for (const manualCaptcha of [{selector: '', timeoutMs: 1000}, {selector: '.captcha', timeoutMs: 0}, {selector: '.captcha', timeoutMs: 600001}]) assert.throws(() => validateSpec({...specFor('https://example.org'), browser: {manualCaptcha}}), /manualCaptcha/);
});

test('worker exposes CAPTCHA focus and timeout details; UI pops up once and retains safe, responsive diagnostics', async t => {
  const f = await fixture(t, (req, res) => res.end(req.url === '/book' ? bookPage : restriction));
  const spec = {...specFor(f.base), transport: 'browser', browser: {responseMode: 'source', manualCaptcha: {...captcha, timeoutMs: 4000}}};
  const book = {title: spec.title, author: spec.author, url: spec.sourceUrl};
  const stateDir = path.join(f.dir, 'state');
  const app = await createDesktop({stateDir, outputDir: path.join(f.dir, 'out'), findBooks: async () => [book], prepareBook: async () => spec});
  const browser = await puppeteer.launch({headless: true});
  try {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(app.url);
    await api(app, 'search', {website: 'fixture.example', title: spec.title});
    await api(app, 'start', {url: book.url});
    await until(() => app.state().action === 'verification');
    assert.equal((await api(app, 'show-browser', {})).status, 200);
    await page.waitForSelector('#manual-attention', {visible: true});
    assert.match(await page.$eval('#manual-attention', el => el.textContent), /需要你操作/);
    await page.click('#show-browser');
    await page.waitForSelector('#interruption-dialog[open]', {timeout: 15000});
    assert.equal(app.state().phase, 'error');
    assert.equal(app.state().report.failures[0].chapter, 1);
    assert.match(await page.$eval('#interruption-detail', el => el.textContent), /手动验证码超时/);
    await page.click('#dismiss-interruption');
    await new Promise(resolve => setTimeout(resolve, 1200));
    assert.equal(await page.$eval('#interruption-dialog', el => el.open), false, 'polling must not reopen a dismissed interruption');
    assert.match(await page.$eval('#task-diagnostics', el => el.textContent), /下一步/);
    assert.equal((await api(app, 'show-browser', {})).status, 400);
    for (const width of [1180, 560, 320]) {
      await page.setViewport({width, height: 920});
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `overflow at ${width}`);
    }
    // Exercise persisted legacy failure hydration, unsafe links and text escaping.
    const jobId = app.state().report.jobId;
    await app.close();
    const last = JSON.parse(fs.readFileSync(path.join(stateDir, 'desktop-last-task.json')));
    delete last.report.failures;
    atomicWrite(path.join(stateDir, 'desktop-last-task.json'), last);
    const reportFile = path.join(stateDir, 'jobs', jobId, 'probe-report.json');
    const report = JSON.parse(fs.readFileSync(reportFile));
    report.failures[0].title = '<img src=x onerror=alert(1)>';
    report.failures[0].url = 'javascript:alert(1)'; report.failures[0].link = 'javascript:alert(1)';
    atomicWrite(reportFile, report);
    const restored = await createDesktop({stateDir});
    try {
      await page.goto(restored.url);
      await page.waitForSelector('#interruption-dialog[open]');
      assert.equal(restored.state().report.failures.length, 1);
      assert.equal(await page.$$eval('#task-diagnostics img, #task-diagnostics a', els => els.length), 0);
      assert.deepEqual(errors, []);
    } finally { await restored.close(); }
  } finally { await browser.close(); if (app.server.listening) await app.close(); }
});
