import '../../test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {requestPacing} from '../request-pacing.mjs';
import {makeClient} from '../http.mjs';
import {acquire} from '../core.mjs';
import {hash, readJson} from '../storage.mjs';

function simulate(adaptive, responseMs = 20, delayMs = 2000) {
  let time = 0;
  const clock = {}, pacer = requestPacing({clock, delayMs, adaptive, now: () => time});
  const intervals = [];
  for (let i = 0; i < 400; i++) {
    const last = clock.lastRequest;
    time += pacer.spacing(true);
    pacer.start(); intervals.push(time - last);
    time += responseMs; pacer.succeeded(responseMs);
  }
  return {time, intervals};
}

test('healthy serial requests accelerate within the floor; slow or default clients do not', () => {
  const fixed = simulate(false), adaptive = simulate(true);
  assert.equal(adaptive.intervals[0], 2000);
  assert.ok(adaptive.intervals.every(ms => ms >= 500 && ms <= 2000));
  assert.equal(adaptive.intervals.at(-1), 500);
  assert.ok(adaptive.time < fixed.time / 3);
  assert.ok(fixed.intervals.every(ms => ms === 2000));
  assert.ok(simulate(true, 1200).intervals.every(ms => ms === 2000));
  assert.ok(simulate(true, 20, 200).intervals.every(ms => ms === 200));
  assert.equal(simulate(true, 20, 4000).intervals.at(-1), 1000);
});

test('source cooldown and conservative recovery survive changing books and options', () => {
  let time = 0;
  const clock = {}, options = {clock, delayMs: 2000, adaptive: true, now: () => time};
  const first = requestPacing(options);
  for (let i = 0; i < 80; i++) first.succeeded(20);
  assert.equal(first.spacing(true), 500);
  assert.equal(first.spacing(), 2000); // Browser navigation remains conservative.
  const fixed = requestPacing({...options, adaptive: false});
  assert.equal(fixed.spacing(true), 2000);
  first.failed(); first.defer(90000);
  const nextBook = requestPacing(options);
  assert.equal(nextBook.spacing(true), 90000);
  time = 90000; nextBook.start();
  for (let i = 0; i < 400; i++) nextBook.succeeded(20);
  assert.equal(nextBook.spacing(true), 2000);
  const slower = requestPacing({...options, delayMs: 4000});
  assert.equal(slower.spacing(true), 4000);
});

async function fixture(t, handler) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-pacing-'));
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({url: req.url, at: Date.now()});
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    handler(req, res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.match(path.basename(dir), /^novel-pacing-/);
    fs.rmSync(dir, {recursive: true, force: true});
  });
  return {dir, requests, base: `http://127.0.0.1:${server.address().port}`};
}

test('HTTP rate limits and rejected pages disable acceleration across clients without caching failures', async t => {
  const f = await fixture(t, (req, res) => {
    if (req.url === '/limited') { res.statusCode = 429; res.setHeader('Retry-After', '1'); return res.end('limited'); }
    if (req.url === '/challenge') return res.end('<div class="challenge">verification</div>');
    res.end('<article>正常页面</article>');
  });
  const pacing = {}, config = {cacheDir: path.join(f.dir, 'cache'), allowedHosts: ['127.0.0.1'], delayMs: 20, retries: 0, adaptivePacing: true, pacing};
  const first = makeClient(config);
  await assert.rejects(first.get(f.base + '/limited'), error => error.stopSource === true);
  await first.close();
  const second = makeClient(config);
  try {
    await second.get(f.base + '/ok');
    assert.ok(f.requests[1].at - f.requests[0].at >= 950);
    assert.equal(pacing.httpPacing.backedOff, true);
    await assert.rejects(second.get(f.base + '/challenge', {rejectSelectors: ['.challenge']}));
    assert.equal(second.stats.cacheHits, 0);
    await second.get(f.base + '/ok');
    assert.equal(second.stats.cacheHits, 1);
    assert.ok(second.stats.httpPacingWaitMs >= 900);
    assert.ok(second.stats.httpRequestMs >= 0);
  } finally { await second.close(); }
});

test('adaptive downloads retain all ordered pages, checkpoint hashes, resume and quality rejection', async t => {
  let broken = false;
  const f = await fixture(t, (req, res) => {
    if (req.url === '/book') return res.end('<h1>合成分页故事</h1><b>测试作者</b><nav>' + [1, 2, 3].map(n => `<a href="/c${n}-1">第${n}章 故事${n}</a>`).join('') + '</nav>');
    const [, chapter, page] = /^\/c(\d)-(\d)$/.exec(req.url) || [];
    if (!chapter) { res.statusCode = 404; return res.end('missing'); }
    const content = broken && page === '4' ? '' : `${chapter}章${page}页：${['春风拂过高山，旅人沿石径向前。', '海船穿过浪潮，水手扬帆归乡。', '篝火照亮帐篷，牧人唱起歌谣。'][Number(chapter) - 1]}`;
    res.end(`<h2>第${chapter}章 故事${chapter}</h2><article>${content}</article>` + (Number(page) < 4 ? `<a class="next" href="/c${chapter}-${Number(page) + 1}">下一页</a>` : ''));
  });
  const spec = {version: 1, kind: 'html', title: '合成分页故事', author: '测试作者', sourceUrl: f.base + '/book', delayMs: 200, retries: 0,
    metadata: {title: 'h1', author: 'b'}, catalog: {links: 'nav a'}, chapter: {title: 'h2', content: 'article', next: 'a.next'}};
  const options = {stateDir: path.join(f.dir, 'state'), outputDir: path.join(f.dir, 'out'), mode: 'download', adaptivePacing: true};
  const partial = await acquire(spec, {...options, maxNew: 1});
  const checkpointDir = path.join(options.stateDir, 'jobs', partial.jobId, 'chapters');
  const saved = fs.readdirSync(checkpointDir).map(name => [name, hash(fs.readFileSync(path.join(checkpointDir, name)))]);
  const complete = await acquire(spec, options);
  assert.equal(complete.structuralPass, true);
  assert.equal(complete.completeAgainstSource, true);
  const chapters = readJson(complete.exportFile).chapters;
  for (const chapter of chapters) {
    const position = chapter.chapter_number;
    assert.deepEqual(chapter.content.match(/\d章\d页/g), [1, 2, 3, 4].map(page => `${position}章${page}页`));
  }
  for (const [name, digest] of saved) assert.equal(hash(fs.readFileSync(path.join(checkpointDir, name))), digest);
  for (const page of [1, 2, 3, 4]) assert.equal(f.requests.filter(r => r.url === `/c1-${page}`).length, 1);
  const fixed = await acquire(spec, {...options, adaptivePacing: false, stateDir: path.join(f.dir, 'fixed'), outputDir: path.join(f.dir, 'fixed-out')});
  assert.deepEqual(readJson(fixed.exportFile).chapters.map(({content, title, chapter_number}) => ({content, title, chapter_number})), chapters.map(({content, title, chapter_number}) => ({content, title, chapter_number})));
  broken = true;
  const failed = await acquire(spec, {...options, refresh: true, stateDir: path.join(f.dir, 'broken'), outputDir: path.join(f.dir, 'broken-out')});
  assert.equal(failed.structuralPass, false);
  assert.equal(failed.exportFile, null);
  assert.ok(failed.failures.length > 0);
});
