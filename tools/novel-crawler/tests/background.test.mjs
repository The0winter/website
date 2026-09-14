import '../../test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import puppeteer from 'puppeteer';
import {makeClient} from '../http.mjs';
import {createDesktop} from '../desktop/server.mjs';

const until = async check => {
  const deadline = Date.now() + 20000;
  while (!check()) {
    assert.ok(Date.now() < deadline, 'timed out waiting for fixture');
    await new Promise(resolve => setTimeout(resolve, 40));
  }
};
async function fixture(t, handler) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-background-test-'));
  const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); handler(req, res); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('novel-background-test-'));
    fs.rmSync(dir, {recursive: true, force: true});
  });
  return {dir, base: `http://127.0.0.1:${server.address().port}`};
}

test('visible site configuration starts without a window; only Show hands off the same login profile', async t => {
  let completed = false, sessionSeen = false, storageSeen = false;
  const f = await fixture(t, (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (req.url === '/storage') { storageSeen = true; return res.end('ok'); }
    if (req.url === '/check') return res.end(completed ? 'ready' : 'wait');
    sessionSeen ||= /fixture=valid/.test(req.headers.cookie || '');
    res.setHeader('Set-Cookie', 'fixture=valid; Path=/; HttpOnly');
    res.end(completed ? '<article>完整合成正文</article><script>if(localStorage.getItem("fixture")==="valid")fetch("/storage")</script>' : '<article><div class="login-required">合成预览</div></article><script>localStorage.setItem("fixture","valid");setInterval(async()=>{if(await(await fetch("/check")).text()==="ready")location.reload()},100)</script>');
  });
  const launches = [], statuses = [];
  const client = makeClient({cacheDir: path.join(f.dir, 'cache'), allowedHosts: ['127.0.0.1'], delayMs: 200,
    browser: {headless: false, minimized: true, responseMode: 'source', manualLogin: {selector: '.login-required', timeoutMs: 15000}},
    onStatus: s => statuses.push(s),
    // Observe the production launch choice, but never display a test window.
    launchBrowser: options => { launches.push(options); return puppeteer.launch({...options, headless: true}); }});
  try {
    const pending = client.get(f.base + '/book', {render: true});
    await until(() => statuses.some(s => s.kind === 'login'));
    assert.deepEqual(launches.map(o => o.headless), [true]);
    assert.equal(fs.existsSync(path.join(f.dir, 'cache')), false, 'preview is not cached');
    assert.match(statuses[0].message, /方便时点击/);
    await Promise.all([client.showBrowser(), client.showBrowser()]);
    assert.deepEqual(launches.map(o => o.headless), [true, false]);
    assert.equal(launches[0].userDataDir, launches[1].userDataDir);
    completed = true;
    assert.match((await pending).body.toString(), /完整合成正文/);
    await until(() => storageSeen);
    assert.equal(sessionSeen, true, 'session cookie survives the handoff');
    await assert.rejects(client.showBrowser(), /没有等待操作/);
  } finally { await client.close(); }
  assert.equal(fs.existsSync(launches[0].userDataDir), false, 'temporary profile is removed on final close');
});

test('cancelling while Show is queued settles both requests and keeps the preview out of the cache', async t => {
  const f = await fixture(t, (_req, res) => res.end('<article><div class="login-required">preview</div></article>'));
  const controller = new AbortController();
  let show, client;
  client = makeClient({cacheDir: path.join(f.dir, 'cache'), allowedHosts: ['127.0.0.1'], delayMs: 200, signal: controller.signal,
    browser: {headless: false, manualLogin: {selector: '.login-required', timeoutMs: 5000}},
    onStatus: status => { if (status.kind === 'login') { show = assert.rejects(client.showBrowser(), /停止|关闭/); controller.abort(); } }});
  try {
    await assert.rejects(client.get(f.base, {render: true}), /停止/);
    await show;
    assert.equal(fs.existsSync(path.join(f.dir, 'cache')), false);
  } finally { await client.close(); }
});

test('Cloudflare waiting also stays hidden and rechecks a fresh response after explicit Show', async t => {
  let verified = false, waiting = false;
  const f = await fixture(t, (_req, res) => {
    if (!verified) { res.statusCode = 403; res.setHeader('cf-mitigated', 'challenge'); }
    res.end(verified ? '<article>合成已验证页面</article>' : '<p>合成人机验证页</p>');
  });
  const launches = [];
  const client = makeClient({cacheDir: path.join(f.dir, 'cache'), allowedHosts: ['127.0.0.1'], delayMs: 200,
    browser: {headless: false, manualVerificationMs: 10000},
    onStatus: status => { waiting ||= status.kind === 'verification'; },
    launchBrowser: options => { launches.push(options.headless); return puppeteer.launch({...options, headless: true}); }});
  try {
    const pending = client.get(f.base, {render: true});
    await until(() => waiting);
    assert.deepEqual(launches, [true]);
    const shown = client.showBrowser();
    verified = true; // Synthetic external completion, never a real challenge.
    await shown;
    assert.match((await pending).body.toString(), /合成已验证页面/);
    assert.deepEqual(launches, [true, false]);
  } finally { await client.close(); }
});

test('search and detail operations expose the same explicit Show control as download workers', async t => {
  const f = await fixture(t, (_req, res) => res.end('fixture'));
  let finish, shows = 0;
  const found = {title: '合成故事', author: '测试作者', url: f.base + '/book'};
  const app = await createDesktop({stateDir: f.dir, findBooks: async ({onClient, onStatus}) => {
    onClient({showBrowser: async () => { shows++; }});
    onStatus({kind: 'verification', message: '等待手动验证'});
    await new Promise(resolve => { finish = resolve; });
    onClient(null); return [found];
  }});
  const api = (route, body) => fetch(app.baseUrl + '/api/' + route, {method: body === undefined ? 'GET' : 'POST', headers: {'x-desktop-token': app.token, 'Content-Type': 'application/json'}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
  try {
    const search = api('search', {website: 'https://fixture.example', title: found.title});
    await until(() => finish);
    assert.equal((await (await api('state')).json()).task.canShowBrowser, true);
    assert.equal((await api('show-browser', {})).status, 200);
    assert.equal(shows, 1);
    finish(); await search;
    assert.equal((await (await api('state')).json()).task.canShowBrowser, false);
  } finally { finish?.(); await app.close(); }
});
