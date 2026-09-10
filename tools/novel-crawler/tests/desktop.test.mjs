import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import puppeteer from 'puppeteer';
import {createDesktop} from '../desktop/server.mjs';
import {rememberWebsite, readSettings, normalizeWebsite, loadSites, parseSearch, fillTemplate} from '../desktop/sources.mjs';
import {acquire} from '../core.mjs';

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-desktop-test-'));
  t.after(() => {
    const resolved = path.resolve(dir), base = path.resolve(os.tmpdir()) + path.sep;
    assert.ok(resolved.startsWith(base) && path.basename(resolved).startsWith('novel-desktop-test-'));
    fs.rmSync(resolved, {recursive: true, force: true});
  });
  return dir;
}
async function fixture(t) {
  const chapters = ['松林里的清风拂过河岸，小路旁的石桥映照着晨光。', '漫长的旅途走到山间，客人停下来欣赏遥远的群峰。', '傍晚的灯火照亮街道，邻居们相聚在院中说起往事。', '小城在雨后苏醒，花园里的枝叶滴落清澈的水珠。'];
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (req.url === '/book') res.end(`<h1>测试故事</h1><b>测试作者</b><nav>${chapters.map((_, i) => `<a href="/chapter/${i + 1}">第${i + 1}章 测试${i + 1}</a>`).join('')}</nav>`);
    else {
      const n = Number(req.url.split('/').pop());
      res.end(`<h1>第${n}章 测试${n}</h1><article>${chapters[n - 1].repeat(16)}</article>`);
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return {version: 1, kind: 'html', title: '测试故事', author: '测试作者', sourceUrl: `http://127.0.0.1:${server.address().port}/book`, metadata: {title: 'h1', author: 'b'}, catalog: {links: 'nav a'}, chapter: {title: 'h1', content: 'article'}, delayMs: 200};
}
const request = (app, route, body, headers = {}) => fetch(`${app.baseUrl}/api/${route}`, {method: body === undefined ? 'GET' : 'POST', headers: {'x-desktop-token': app.token, 'Content-Type': 'application/json', ...headers}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});

test('site history retains every site, moves reused sites to front, and keeps the last site on disk', t => {
  const dir = temp(t);
  for (const site of ['a.example', 'b.example', 'c.example', 'd.example', 'b.example/read/123/?a=1']) rememberWebsite(dir, site);
  assert.deepEqual(readSettings(dir), {version: 1, lastWebsite: 'https://b.example/', recentWebsites: ['https://b.example/', 'https://d.example/', 'https://c.example/', 'https://a.example/']});
  for (let i = 0; i < 100; i++) rememberWebsite(dir, `history-${i}.example`);
  rememberWebsite(dir, 'a.example/book/1/');
  assert.equal(readSettings(dir).recentWebsites.length, 104);
  assert.equal(readSettings(dir).recentWebsites[0], 'https://a.example/');
  assert.equal(readSettings(dir).recentWebsites.at(-1), 'https://c.example/');
  assert.equal(normalizeWebsite(' HTTPS://IXDZS8.COM/read/38804/#chapter '), 'https://ixdzs8.com/read/38804/');
  for (const url of ['javascript:alert(1)', 'file:///C:/test', 'https://user:pass@example.com', 'localhost', '127.0.0.1:4444', 'https://example.com:5000']) assert.throws(() => normalizeWebsite(url));
});

test('adapter keeps titles and authors paired and distinguishes chapter template variables', () => {
  const {sites, errors} = loadSites();
  assert.deepEqual(errors, []);
  const site = sites.find(s => s.id === 'ixdzs8');
  const html = `<li class="burl"><h3 class="bname"><a href="/read/123/">测试书</a></h3><span class="bauthor"><a>甲作者</a></span></li><li class="burl"><h3 class="bname"><a href="/read/456/">测试书</a></h3><span class="bauthor"><a>乙作者</a></span></li><a title="下一页" href="/bsearch?page=2">下一页</a>`;
  const result = parseSearch(html, site.home, site);
  assert.deepEqual(result.results.map(b => [b.author, b.url]), [['甲作者', 'https://ixdzs8.com/read/123/'], ['乙作者', 'https://ixdzs8.com/read/456/']]);
  assert.equal(result.next, 'https://ixdzs8.com/bsearch?page=2');
  assert.throws(() => parseSearch(html.replace('/read/123/', 'https://elsewhere.example/read/123/'), site.home, site), /详情页/);
  const spec = fillTemplate(site.spec, {title: '测试书', author: '甲作者', sourceUrl: 'https://ixdzs8.com/read/123/', bookId: '123'});
  assert.equal(spec.catalog.json.linkTemplate, '/read/123/p{ordernum}.html');
  assert.equal(spec.catalog.request.form.bid, '123');
  assert.throws(() => fillTemplate('${missing}', {}), /未知变量/);
});

test('desktop API rejects unauthenticated and foreign-origin requests, preserves settings after restart', async t => {
  const stateDir = temp(t);
  let app = await createDesktop({stateDir, outputDir: path.join(stateDir, 'downloads')});
  try {
    assert.equal((await fetch(`${app.baseUrl}/api/state`)).status, 403);
    assert.equal((await request(app, 'remember', {website: 'a.example'}, {Origin: 'https://foreign.example'})).status, 403);
    for (const website of ['a.example', 'b.example', 'c.example', 'd.example']) assert.equal((await request(app, 'remember', {website})).status, 200);
    assert.equal((await request(app, 'open', {kind: 'file', path: 'C:/Windows'})).status, 400);
    const response = await request(app, 'search', {website: 'unadapted.example', title: '测试书'});
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /还没有适配/);
  } finally { await app.close(); }
  app = await createDesktop({stateDir});
  try {
    const {settings} = await (await request(app, 'state')).json();
    assert.equal(settings.lastWebsite, 'https://unadapted.example/');
    assert.deepEqual(settings.recentWebsites, ['https://unadapted.example/', 'https://d.example/', 'https://c.example/', 'https://b.example/', 'https://a.example/']);
  } finally { await app.close(); }
});

test('pause finishes a checkpoint, skips source scoring, and continuation exports every chapter', async t => {
  const stateDir = temp(t), spec = await fixture(t);
  let stop = false;
  const first = await acquire(spec, {mode: 'download', stateDir, outputDir: path.join(stateDir, 'out'), shouldStop: () => stop, onProgress: p => { if (p.downloaded === 1) stop = true; }});
  assert.equal(first.paused, true);
  assert.equal(first.downloaded, 1);
  assert.equal(first.exportFile, null);
  assert.equal(fs.existsSync(path.join(stateDir, 'sources.json')), false);
  const next = await acquire(spec, {mode: 'download', stateDir, outputDir: path.join(stateDir, 'out')});
  assert.equal(next.completeAgainstSource, true);
  assert.equal(next.downloaded, 4);
  assert.ok(fs.existsSync(next.exportFile));
});

test('window searches, selects, downloads through worker, and shows result without console errors', async t => {
  const stateDir = temp(t), spec = await fixture(t), opened = [];
  for (let i = 0; i < 30; i++) rememberWebsite(stateDir, `history-${i}.example`);
  rememberWebsite(stateDir, 'ixdzs8.com');
  const book = {title: spec.title, author: spec.author, url: spec.sourceUrl, site: '本地测试来源'};
  const app = await createDesktop({stateDir, outputDir: path.join(stateDir, 'out'), findBooks: async ({title}) => title === book.title ? [book] : [], prepareBook: async () => spec, open: target => opened.push(target)});
  const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', puppeteer.executablePath()].find(file => fs.existsSync(file));
  const browser = await puppeteer.launch({headless: true, executablePath});
  try {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.setViewport({width: 1180, height: 920});
    await page.goto(app.url);
    await page.waitForFunction(() => document.getElementById('website').value === 'https://ixdzs8.com/');
    assert.equal(await page.$eval('#adapter-status', el => el.textContent), '✓ 已适配');
    assert.equal(await page.$$eval('.site-choice', els => els.length), 31);
    assert.equal(await page.$eval('.site-choice', el => el.dataset.host), 'ixdzs8.com');
    assert.equal(await page.$eval('#sites', el => el.scrollHeight > el.clientHeight), true);
    await page.click('.site-choice[data-host="history-29.example"]');
    await page.waitForFunction(() => document.querySelector('.site-choice').dataset.host === 'history-29.example');
    assert.equal(await page.$eval('.site-choice .site-state', el => el.textContent), '待适配');
    assert.equal(await page.$eval('#website', el => el.value), 'https://history-29.example/');
    await page.reload();
    await page.waitForFunction(() => document.getElementById('website').value === 'https://history-29.example/');
    assert.equal(await page.$eval('.site-choice', el => el.dataset.host), 'history-29.example');
    await page.click('.site-choice[data-host="ixdzs8.com"]');
    await page.waitForFunction(() => document.querySelector('.site-choice').dataset.host === 'ixdzs8.com');
    await page.type('#title', spec.title);
    await page.click('#search');
    await page.waitForSelector('.book-result');
    assert.match(await page.$eval('.book-result', el => el.textContent), /测试作者/);
    await page.click('#start');
    await page.waitForFunction(() => document.getElementById('phase').textContent === '已完成', {timeout: 20000});
    assert.match(await page.$eval('#report-stats', el => el.textContent), /4 \/ 4/);
    assert.ok(fs.existsSync(app.state().report.exportFile));
    await page.click('#open-folder');
    await page.waitForFunction(() => !document.getElementById('feedback').textContent);
    assert.equal(opened[0], path.join(stateDir, 'out'));
    for (const width of [1180, 800, 560]) {
      await page.setViewport({width, height: 920});
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `horizontal overflow at ${width}`);
      assert.equal(await page.$eval('#sites', el => el.getBoundingClientRect().height > 0), true, `site history inaccessible at ${width}`);
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await app.close(); }
});
