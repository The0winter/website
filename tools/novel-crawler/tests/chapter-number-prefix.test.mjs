import '../../test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {chapterIdentity} from '../continuation.mjs';
import {acquire, validateSpec} from '../core.mjs';
import {atomicWrite, hash, readJson} from '../storage.mjs';

test('chapter identities recognize a final run that omits the optional 第 prefix', () => {
  const titles = ['第三百五十七章 天地风流', '三百五十八章、天地不仁', '三百五十九章、一砂一世界', '三百六十章、包饺子（结局）'];
  assert.deepEqual(titles.map(title => chapterIdentity(title).number), [357, 358, 359, 360]);
  for (const title of titles.slice(1)) assert.deepEqual(chapterIdentity(title), chapterIdentity('第' + title));
  assert.equal(chapterIdentity('360章 结局').number, 360);
  for (const title of ['说书活动通知及新书有关公告', '第三部 第2节', '三百天后', '完结感言']) assert.equal(chapterIdentity(title), null);
});

test('continuation retains a zero prologue, aligns prefixless tails, and still rejects missing chapters', async t => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-prefix-')), outputDir = path.join(stateDir, 'out');
  const title = n => n === 0 ? '第零章 伯爵的儿子' : `${n === 357 ? '第' : ''}${n}章 山间故事${n}`;
  const body = n => Array.from({length: 240}, (_, i) => String.fromCodePoint(0x4e00 + (n % 100) * 300 + i)).join('').repeat(4);
  const numbers = [0, 357, 358, 359, 360];
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (req.url === '/book') return res.end(`<h1>章号测试书</h1><b>甲作者</b><nav>${numbers.map(n => `<a href="/c/${n}">${title(n)}</a>`).join('')}</nav>`);
    const n = Number(req.url.split('/').at(-1));
    res.end(`<h1>${title(n)}</h1><article>${body(n)}</article>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(stateDir, {recursive: true, force: true}); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const spec = validateSpec({version: 1, kind: 'html', title: '章号测试书', author: '甲作者', sourceUrl: base + '/book', metadata: {title: 'h1', author: 'b'}, catalog: {links: 'nav a'}, chapter: {title: 'h1', content: 'article'}, delayMs: 200, retries: 0});
  const book = {title: spec.title, author: spec.author, sourceUrl: 'https://old.example/book', chapters: numbers.slice(0, -1).map((n, i) => ({chapter_number: i + 1, title: title(n), content: body(n), link: `https://old.example/c/${n}`}))};
  const file = path.join(outputDir, 'book.json'); atomicWrite(file, book);
  const result = await acquire(spec, {stateDir, outputDir, mode: 'download', continuation: {file: 'book.json', hash: hash(fs.readFileSync(file))}});
  assert.equal(result.completeAgainstSource, true, JSON.stringify(result.failures));
  assert.equal(result.continuationAdded, 1);
  assert.deepEqual(readJson(file).chapters.slice(0, book.chapters.length), book.chapters);
  const gapState = path.join(stateDir, 'gap'), gapOutput = path.join(gapState, 'out'), gapFile = path.join(gapOutput, 'book.json');
  const gapBook = {...book, chapters: book.chapters.filter(c => c.title !== title(358))}; atomicWrite(gapFile, gapBook);
  const rejected = await acquire(spec, {stateDir: gapState, outputDir: gapOutput, mode: 'download', continuation: {file: 'book.json', hash: hash(fs.readFileSync(gapFile))}});
  assert.equal(rejected.completeAgainstSource, false);
  assert.match(rejected.failures[0].error, /原书末尾正文章号不连续/);
  assert.deepEqual(readJson(gapFile), gapBook);
});
