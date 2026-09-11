import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import puppeteer from 'puppeteer';
import {makeClient} from '../http.mjs';
import {browserProfile, clearBrowserSession, lockBrowserProfile, sessionCookies} from '../browser-session.mjs';
import {createDesktop} from '../desktop/server.mjs';
import {loadSites, searchBooks} from '../desktop/sources.mjs';

async function fixture(t, handler = (_req, res) => res.end('fixture')) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-session-'));
  const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); handler(req, res); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('novel-session-'));
    fs.rmSync(dir, {recursive: true, force: true});
  });
  return {dir, base: `http://127.0.0.1:${server.address().port}`};
}
const request = (app, route, body, headers = {}) => fetch(app.baseUrl + '/api/' + route, {method: body === undefined ? 'GET' : 'POST', headers: {'x-desktop-token': app.token, 'Content-Type': 'application/json', ...headers}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
async function until(check, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (!check()) { if (Date.now() > deadline) assert.fail('timed out waiting for state'); await new Promise(resolve => setTimeout(resolve, 40)); }
}

test('browser profile identity follows the website, isolates other sources, and clearing cannot delete chapters or neighbors', async t => {
  const f = await fixture(t);
  const profile = browserProfile(f.dir, 'https://www.books.example/novel/first');
  assert.equal(profile, browserProfile(f.dir, 'https://books.example/novel/second'));
  assert.notEqual(profile, browserProfile(f.dir, 'https://other.example/novel/first'));
  assert.throws(() => browserProfile(f.dir, 'file:///C:/Windows'));
  assert.throws(() => browserProfile(f.dir, 'https://user:password@books.example/'));
  const neighbor = browserProfile(f.dir, 'https://other.example/'), chapters = path.join(f.dir, 'jobs', 'chapters.json');
  for (const target of [path.join(profile, 'keep'), path.join(neighbor, 'keep'), chapters]) { fs.mkdirSync(path.dirname(target), {recursive: true}); fs.writeFileSync(target, 'synthetic checkpoint'); }
  const release = lockBrowserProfile(profile);
  try { assert.throws(() => clearBrowserSession(f.dir, 'https://books.example'), /仍在使用登录状态/); }
  finally { release(); }
  clearBrowserSession(f.dir, 'https://www.books.example/');
  assert.equal(fs.existsSync(profile), false); assert.equal(fs.existsSync(path.join(neighbor, 'keep')), true);
  assert.equal(fs.readFileSync(chapters, 'utf8'), 'synthetic checkpoint');
});

test('normal Chrome keeps session cookies, persistent cookies and local storage between independent clients; logout and expiration remain effective', async t => {
  let authenticated = false, persistent = false;
  const f = await fixture(t, (req, res) => {
    authenticated = /session_fixture=valid/.test(req.headers.cookie || '');
    persistent = /persistent_fixture=valid/.test(req.headers.cookie || '');
    if (req.url === '/login') {
      res.setHeader('Set-Cookie', ['session_fixture=valid; HttpOnly; Path=/; SameSite=Lax', 'persistent_fixture=valid; Path=/; Max-Age=3600; SameSite=Lax']);
      return res.end('<script>localStorage.setItem("fixture","valid")</script><article id="ready">login fixture</article>');
    }
    if (req.url === '/logout') {
      res.setHeader('Set-Cookie', ['session_fixture=; HttpOnly; Path=/; Max-Age=0', 'persistent_fixture=; Path=/; Max-Age=0']);
      return res.end('<script>localStorage.removeItem("fixture")</script><article id="ready">logout fixture</article>');
    }
    if (req.url === '/expire') { res.setHeader('Set-Cookie', 'persistent_fixture=valid; Path=/; Max-Age=1'); return res.end('<article id="ready">expiry fixture</article>'); }
    res.end('<article id="ready"></article><script>document.querySelector("article").textContent=localStorage.getItem("fixture")==="valid"?"storage-present":"storage-empty"</script>');
  });
  const options = {cacheDir: path.join(f.dir, 'cache'), profileDir: browserProfile(f.dir, f.base), allowedHosts: ['127.0.0.1'], delayMs: 200, browser: {headless: false, minimized: true}};
  const read = async (url, change = {}) => {
    const client = makeClient({...options, ...change});
    try { return (await client.get(f.base + url, {fresh: true, render: true, readySelector: '#ready'})).body.toString(); }
    finally { await client.close(); }
  };
  await read('/login');
  const snapshot = fs.readFileSync(path.join(options.profileDir, 'session-cookies.json'), 'utf8');
  if (process.platform === 'win32') { assert.equal(JSON.parse(snapshot).protection, 'windows-dpapi'); assert.doesNotMatch(snapshot, /session_fixture/); }
  assert.match(await read('/check'), /storage-present/); assert.equal(authenticated, true); assert.equal(persistent, true);
  assert.match(await read('/check', {profileDir: browserProfile(f.dir, 'https://another.example')}), /storage-empty/);
  assert.equal(authenticated, false); assert.equal(persistent, false);
  // A search client is a separate browser lifetime from the earlier collection.
  const site = {id: 'fixture', name: 'fixture', home: f.base, hosts: ['books.example', '127.0.0.1'], search: {url: f.base + '/search?query=${query}', items: 'li', title: 'a', author: 'b', link: 'a'}, book: {urlPattern: '^/book/(?<bookId>[0-9]+)$', metadata: {title: 'h1', author: 'b'}}, spec: {transport: 'browser', delayMs: 200, browser: options.browser}};
  // Empty search is enough to prove the browser sent the preserved HttpOnly cookie.
  assert.deepEqual(await searchBooks({website: 'https://books.example', title: 'fixture', stateDir: f.dir, sites: [site]}), []);
  assert.equal(authenticated, true);
  await read('/logout');
  assert.match(await read('/check'), /storage-empty/); assert.equal(authenticated, false); assert.equal(persistent, false);
  await read('/expire'); await new Promise(resolve => setTimeout(resolve, 1200)); await read('/check');
  assert.equal(persistent, false, 'expired cookies must not be revived by saved login');
});

test('unreadable login state gives a recovery action without exposing its payload or overwriting it', async t => {
  const f = await fixture(t), profile = browserProfile(f.dir, f.base);
  fs.mkdirSync(profile, {recursive: true});
  const file = path.join(profile, 'session-cookies.json'), contents = '{"payload":"synthetic-private-marker"}';
  fs.writeFileSync(file, contents);
  await assert.rejects(sessionCookies(profile, ['127.0.0.1']).restore({setCookie: () => assert.fail('invalid state must not reach browser')}), error => error.code === 'login-state-unreadable' && /清除本站登录/.test(error.nextStep) && !error.message.includes('synthetic-private-marker'));
  assert.equal(fs.readFileSync(file, 'utf8'), contents);
});

test('stopping a hung task flushes login and releases the profile; concurrent use is rejected', async t => {
  let hangStarted = false, authenticated = false;
  const f = await fixture(t, (req, res) => {
    if (req.url === '/hang') { hangStarted = true; req.on('close', () => res.destroy()); return; }
    authenticated = /session_fixture=valid/.test(req.headers.cookie || '');
    if (req.url === '/login') res.setHeader('Set-Cookie', 'session_fixture=valid; HttpOnly; Path=/; SameSite=Lax');
    res.end('<article>fixture</article>');
  });
  const controller = new AbortController();
  const options = {cacheDir: path.join(f.dir, 'cache'), profileDir: browserProfile(f.dir, f.base), allowedHosts: ['127.0.0.1'], delayMs: 200};
  const first = makeClient({...options, signal: controller.signal}), second = makeClient(options);
  try {
    await first.get(f.base + '/login', {render: true});
    await assert.rejects(second.get(f.base + '/check', {render: true, fresh: true}), /仍在使用登录状态/);
    await second.close();
    const pending = first.get(f.base + '/hang', {render: true});
    const stopped = assert.rejects(pending, /已停止/);
    await until(() => hangStarted); controller.abort(); await stopped; await first.close();
    assert.equal(fs.existsSync(options.profileDir + '.lock'), false);
    const resumed = makeClient(options);
    try { await resumed.get(f.base + '/check', {render: true, fresh: true}); assert.equal(authenticated, true); }
    finally { await resumed.close(); }
    clearBrowserSession(f.dir, f.base);
    const cleared = makeClient(options);
    try { await cleared.get(f.base + '/check', {render: true, fresh: true}); assert.equal(authenticated, false); }
    finally { await cleared.close(); }
  } finally { await first.close(); await second.close(); }
});

test('a new desktop worker and a restarted app collect another book without asking for login again', async t => {
  let grantLogin = false, loginPrompts = 0;
  const f = await fixture(t, (req, res) => {
    if (req.url === '/session') return res.end(grantLogin ? 'ready' : 'waiting');
    if (req.url.startsWith('/book/')) { const id = req.url.split('/').pop(); return res.end(`<h1>测试书${id}</h1><b>测试作者</b><nav><a href="/chapter/${id}">第一章</a></nav>`); }
    if (!req.url.startsWith('/chapter/')) { res.statusCode = 404; return res.end(); }
    let loggedIn = /session_fixture=valid/.test(req.headers.cookie || '');
    if (grantLogin) { grantLogin = false; loggedIn = true; res.setHeader('Set-Cookie', 'session_fixture=valid; HttpOnly; Path=/; SameSite=Lax'); }
    if (!loggedIn) {
      loginPrompts++;
      return res.end('<article><div class="login-required">合成登录提示</div></article><script>setInterval(async()=>{if(await(await fetch("/session")).text()==="ready")location.reload()},100)</script>');
    }
    res.end('<h1>第一章</h1><article>独立任务中的完整合成正文。</article>');
  });
  const prepareBook = async book => ({version: 1, kind: 'html', title: book.title, author: book.author, sourceUrl: book.url, delayMs: 200, transport: 'browser', browser: {responseMode: 'source', manualLogin: {selector: '.login-required', timeoutMs: 5000}}, metadata: {title: 'h1', author: 'b'}, catalog: {links: 'nav a'}, chapter: {title: 'h1', content: 'article'}});
  const options = {stateDir: f.dir, outputDir: path.join(f.dir, 'out'), findBooks: async ({title}) => [{title, author: '测试作者', url: f.base + '/book/' + title.slice(-1)}], prepareBook};
  let app = await createDesktop(options);
  try {
    await request(app, 'search', {website: 'fixture.example', title: '测试书1'}); await request(app, 'start', {url: f.base + '/book/1'});
    await until(() => app.state().action === 'login'); grantLogin = true;
    await until(() => ['complete', 'error'].includes(app.state().phase)); assert.equal(app.state().phase, 'complete', app.state().message);
    await app.close(); app = await createDesktop(options);
    await request(app, 'search', {website: 'fixture.example', title: '测试书2'}); await request(app, 'start', {url: f.base + '/book/2'});
    await until(() => ['complete', 'error'].includes(app.state().phase));
    assert.equal(app.state().phase, 'complete', app.state().message); assert.equal(loginPrompts, 1);
    assert.equal(fs.readdirSync(options.outputDir).filter(file => file.endsWith('.json')).length, 2);
  } finally { await app.close(); }
});

test('clear-login UI targets only the selected site and the API rejects active, foreign-origin and arbitrary-path requests', async t => {
  const f = await fixture(t), site = loadSites().sites.find(s => s.id === 'banshanren');
  const profile = browserProfile(f.dir, site.home), other = browserProfile(f.dir, 'https://twkan.com');
  for (const target of [profile, other]) { fs.mkdirSync(target, {recursive: true}); fs.writeFileSync(path.join(target, 'fixture'), 'synthetic login marker'); }
  const app = await createDesktop({stateDir: f.dir, findBooks: async ({signal}) => { await new Promise(resolve => signal.addEventListener('abort', resolve, {once: true})); return []; }});
  const browser = await puppeteer.launch({headless: true});
  try {
    assert.equal((await request(app, 'clear-login', {website: site.home}, {Origin: 'https://foreign.example'})).status, 403);
    for (const website of ['file:///C:/Windows', '../', 'https://unadapted.example']) assert.equal((await request(app, 'clear-login', {website})).status, 400);
    const page = await browser.newPage(); await page.goto(app.url);
    await page.waitForSelector('.site-choice[data-site-id="banshanren"]'); await page.click('.site-choice[data-site-id="banshanren"]');
    await page.waitForSelector('#login-memory', {visible: true}); await page.click('#clear-login');
    await page.waitForFunction(() => document.querySelector('#feedback').textContent.includes('已清除搬山人'));
    assert.equal(fs.existsSync(profile), false); assert.equal(fs.existsSync(path.join(other, 'fixture')), true);
    await page.setViewport({width: 320, height: 844}); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.click('.site-choice[data-site-id="shudugu"]'); assert.equal(await page.$eval('#login-memory', el => el.hidden), true);
    const searching = request(app, 'search', {website: site.home, title: '合成等待'});
    await until(() => app.state().phase === 'search'); assert.equal((await request(app, 'clear-login', {website: site.home})).status, 409);
    await request(app, 'stop', {}); await searching;
  } finally { await browser.close(); await app.close(); }
});
