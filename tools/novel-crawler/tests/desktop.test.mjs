import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import puppeteer from 'puppeteer';
import {createDesktop} from '../desktop/server.mjs';
import {rememberWebsite, readSettings, normalizeWebsite, loadSites, parseSearch, fillTemplate, searchBooks} from '../desktop/sources.mjs';
import {acquire} from '../core.mjs';
import {checkIdentity} from '../quality.mjs';

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

async function until(check, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  assert.fail('timed out waiting for task state');
}

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

test('twkan matches simplified book names without accepting different authors or rewriting source titles', () => {
  const site = loadSites().sites.find(s => s.id === 'twkan');
  const html = '<ul id="article_list_content"><li><h3><a class="imgbox" href="/book/123.html"></a><a href="/book/123.html">紅樓夢</a></h3><div class="labelbox"><label>曹雪芹</label><label>古典文學</label></div></li></ul><div id="pagelink"><a class="next" href="/search/test/2.html">&gt;</a></div>';
  const {results, next} = parseSearch(html, site.home, site);
  assert.equal(results[0].title, '紅樓夢');
  assert.equal(results[0].author, '曹雪芹');
  assert.equal(next, 'https://twkan.com/search/test/2.html');
  const spec = fillTemplate(site.spec, {title: '红楼梦', author: '曹雪芹', sourceUrl: results[0].url, bookId: '123'});
  assert.doesNotThrow(() => checkIdentity(spec, results[0]));
  assert.throws(() => checkIdentity({...spec, author: '其他作者'}, results[0]), /身份不匹配/);
  assert.throws(() => checkIdentity({...spec, identityNormalization: undefined}, results[0]), /身份不匹配/);
  assert.equal(spec.catalog.url, 'https://twkan.com/ajax_novels/chapterlist/123.html');
  assert.equal(spec.catalog.links, "li[data-num] a[href*='/txt/123/']");
});

test('a search redirect to book details is matched by title and author instead of reported empty', async t => {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/search/')) { res.writeHead(302, {Location: '/book/84267.html'}); res.end(); }
    else { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<h1>神的模仿犯</h1><b>青衫取醉</b>'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const site = {id: 'fixture', name: '测试来源', hosts: ['books.example', '127.0.0.1'], search: {url: base + '/search/${query}', items: '.results'}, book: {urlPattern: '^/book/[0-9]+\\.html$', metadata: {title: 'h1', author: 'b'}}, spec: {delayMs: 1}};
  const options = {website: 'https://books.example/', stateDir: temp(t), sites: [site], title: '神的模仿犯'};
  assert.deepEqual(await searchBooks(options), [{title: '神的模仿犯', author: '青衫取醉', url: base + '/book/84267.html', site: '测试来源'}]);
  assert.deepEqual(await searchBooks({...options, author: '另一个作者'}), []);
  assert.deepEqual(await searchBooks({...options, title: '其他作品'}), []);
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

test('stop cancels lookup and resolving without allowing late results to start a worker', async t => {
  const stateDir = temp(t), spec = await fixture(t);
  const book = {title: spec.title, author: spec.author, url: spec.sourceUrl, site: '测试来源'};
  let blockSearch = true, searchSignal, resolveSignal;
  const app = await createDesktop({stateDir, outputDir: path.join(stateDir, 'out'),
    findBooks: async ({signal}) => {
      searchSignal = signal;
      if (blockSearch) await new Promise(resolve => signal.addEventListener('abort', resolve, {once: true}));
      return [book]; // Even a late successful result must be discarded after stop.
    },
    prepareBook: async ({signal}) => {
      resolveSignal = signal;
      await new Promise(resolve => signal.addEventListener('abort', resolve, {once: true}));
      return spec;
    },
  });
  try {
    const pending = request(app, 'search', {website: 'ixdzs8.com', title: book.title});
    await until(() => searchSignal);
    assert.equal((await request(app, 'stop', {})).status, 200);
    assert.equal(searchSignal.aborted, true);
    const stopped = await (await pending).json();
    assert.equal(stopped.task.phase, 'stopped');
    assert.deepEqual(stopped.candidates, []);
    blockSearch = false;
    await request(app, 'search', {website: 'ixdzs8.com', title: book.title});
    const starting = request(app, 'start', {url: book.url});
    await until(() => resolveSignal);
    assert.equal(app.state().phase, 'resolving');
    await request(app, 'stop', {});
    assert.equal((await (await starting).json()).stopped, true);
    assert.equal(app.state().phase, 'stopped');
    assert.equal(fs.existsSync(path.join(stateDir, 'jobs')), false);
    assert.equal((await request(app, 'stop', {})).status, 200);
  } finally { await app.close(); }
});

test('stop interrupts an active worker request; resume and update reuse saved chapters and the unchanged export', async t => {
  const stateDir = temp(t), counts = new Map();
  let block = true, chapterCount = 3;
  const server = http.createServer((req, res) => {
    counts.set(req.url, (counts.get(req.url) || 0) + 1);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (req.url === '/book') res.end(`<h1>续传测试</h1><b>测试作者</b><nav>${Array.from({length: chapterCount}, (_, i) => `<a href="/c${i + 1}">第${i + 1}章 测试</a>`).join('')}</nav>`);
    else if (req.url === '/c2' && block) { /* Remain pending until the user stops. */ }
    else {
      const n = Number(req.url.slice(2));
      const prose = ['山间的清晨在鸟鸣中展开，小路通往静静的村庄。', '码头上的客船刚刚启程，河面的风吹动沿岸柳枝。', '小城傍晚亮起许多灯火，邻居围坐院落谈论往事。', '雨后的庭院散发泥土气息，孩子走过花园与石阶。'];
      res.end(`<h1>第${n}章 测试</h1><article>${prose[n - 1]?.repeat(20)}</article>`);
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const spec = {version: 1, kind: 'html', title: '续传测试', author: '测试作者', sourceUrl: `http://127.0.0.1:${server.address().port}/book`, metadata: {title: 'h1', author: 'b'}, catalog: {links: 'nav a'}, chapter: {title: 'h1', content: 'article'}, delayMs: 200};
  const book = {title: spec.title, author: spec.author, url: spec.sourceUrl, site: '本地测试来源'};
  const app = await createDesktop({stateDir, outputDir: path.join(stateDir, 'out'), findBooks: async () => [book], prepareBook: async () => spec});
  const start = async () => {
    await until(async () => {
      const response = await request(app, 'start', {url: book.url});
      assert.ok([200, 409].includes(response.status));
      return response.status === 200;
    });
  };
  const local = async () => (await (await request(app, 'state')).json()).candidates[0].local;
  try {
    await request(app, 'search', {website: 'ixdzs8.com', title: book.title});
    await start();
    await until(() => counts.has('/c2'));
    const stoppedAt = Date.now();
    await request(app, 'stop', {});
    await until(() => app.state().phase === 'stopped');
    assert.ok(Date.now() - stoppedAt < 3000, 'stop must abort the pending HTTP request');
    assert.equal(app.state().report.downloaded, 1);
    assert.equal((await local()).state, 'partial');
    assert.equal((await local()).saved, 1);
    assert.equal(counts.has('/c3'), false);
    block = false;
    await start();
    await until(() => ['complete', 'error'].includes(app.state().phase));
    assert.equal(app.state().phase, 'complete', app.state().message);
    assert.equal(app.state().report.downloaded, 3);
    assert.equal(counts.get('/c1'), 1);
    assert.equal(counts.get('/c2'), 2);
    assert.equal(counts.get('/c3'), 1);
    assert.equal((await local()).state, 'complete');
    const file = app.state().report.exportFile, before = fs.statSync(file).mtimeMs;
    await start();
    await until(() => ['complete', 'error'].includes(app.state().phase));
    assert.equal(app.state().report.reusedExport, true);
    assert.match(app.state().message, /没有重复下载正文/);
    assert.equal(fs.statSync(file).mtimeMs, before);
    assert.deepEqual(['/c1', '/c2', '/c3'].map(url => counts.get(url)), [1, 2, 1]);
    chapterCount = 4;
    await start();
    await until(() => ['complete', 'error'].includes(app.state().phase));
    assert.equal(app.state().phase, 'complete', app.state().message);
    assert.equal(app.state().report.downloaded, 4);
    assert.equal(app.state().report.reusedExport, false);
    assert.deepEqual(['/c1', '/c2', '/c3', '/c4'].map(url => counts.get(url)), [1, 2, 1, 1]);
  } finally { await app.close(); }
});

test('window searches, selects, downloads through worker, and shows result without console errors', async t => {
  const stateDir = temp(t), spec = await fixture(t), opened = [];
  for (let i = 0; i < 30; i++) rememberWebsite(stateDir, `history-${i}.example`);
  rememberWebsite(stateDir, 'ixdzs8.com');
  const book = {title: spec.title, author: spec.author, url: spec.sourceUrl, site: '本地测试来源'};
  const app = await createDesktop({stateDir, outputDir: path.join(stateDir, 'out'), findBooks: async ({title, signal}) => {
    if (title === '停止测试') await new Promise(resolve => signal.addEventListener('abort', resolve, {once: true}));
    return title === book.title ? [book] : [];
  }, prepareBook: async () => spec, open: target => opened.push(target)});
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
    assert.equal(await page.$$eval('.site-choice', els => els.length), 30 + loadSites().sites.length);
    assert.equal(await page.$eval('.site-choice', el => el.dataset.host), 'ixdzs8.com');
    assert.equal(await page.$eval('#sites', el => el.scrollHeight > el.clientHeight), true);
    await page.click('.site-choice[data-host="twkan.com"]');
    await page.waitForFunction(() => document.querySelector('.site-choice').dataset.host === 'twkan.com');
    assert.equal(await page.$eval('#website', el => el.value), 'https://twkan.com/');
    assert.equal(await page.$eval('#adapter-status', el => el.textContent), '✓ 已适配');
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
    assert.match(await page.$eval('.local-state', el => el.textContent), /已下载完成/);
    assert.match(await page.$eval('#start', el => el.textContent), /检查更新/);
    assert.ok(fs.existsSync(app.state().report.exportFile));
    await page.click('#open-folder');
    await page.waitForFunction(() => !document.getElementById('feedback').textContent);
    assert.equal(opened[0], path.join(stateDir, 'out'));
    for (const width of [1180, 800, 560]) {
      await page.setViewport({width, height: 920});
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `horizontal overflow at ${width}`);
      assert.equal(await page.$eval('#sites', el => el.getBoundingClientRect().height > 0), true, `site history inaccessible at ${width}`);
    }
    await page.$eval('#title', el => { el.value = '停止测试'; });
    await page.click('#search');
    await page.waitForSelector('#stop', {visible: true});
    await page.click('#stop');
    await page.waitForFunction(() => document.getElementById('phase').textContent === '已停止');
    assert.equal(await page.$eval('#stop', el => el.hidden), true);
    assert.equal(await page.$eval('#feedback', el => el.textContent), '');
    assert.equal(await page.$eval('#search', el => el.disabled), false);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await app.close(); }
});
