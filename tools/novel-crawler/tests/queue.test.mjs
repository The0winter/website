import '../../test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createBookQueue} from '../desktop/queue.mjs';
import {createDesktop} from '../desktop/server.mjs';

const input = title => ({website: 'https://queue.example/', title, author: '测试作者'});
const book = (title, author = '测试作者', suffix = '') => ({title, author, url: `https://queue.example/book/${encodeURIComponent(title + suffix)}`, site: '合成来源'});
const sites = {sites: [{id: 'queue', name: '合成来源', home: 'https://queue.example/', hosts: ['queue.example'], spec: {kind: 'html'}}], errors: []};
const spec = b => ({version: 1, kind: 'html', title: b.title, author: b.author, sourceUrl: b.url, metadata: {title: 'h1', author: 'b'}, catalog: {links: 'a'}, chapter: {title: 'h1', content: 'article'}, delayMs: 200});
function temp(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manual-queue-')); t.after(() => { assert.equal(path.dirname(dir), os.tmpdir()); fs.rmSync(dir, {recursive: true, force: true}); }); return dir; }
async function appFor(dir, options = {}) { return createDesktop({stateDir: dir, outputDir: path.join(dir, 'out'), loadSources: () => sites, findBooks: async ({title}) => [book(title)], prepareBook: async b => spec(b), bookWorker: path.resolve('tools/novel-crawler/tests/queue-fixture-worker.mjs'), ...options}); }
async function request(app, route, body) {
  const response = await fetch(app.baseUrl + '/api/' + route, {method: body === undefined ? 'GET' : 'POST', headers: {'x-desktop-token': app.token, 'Content-Type': 'application/json'}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
  return {status: response.status, data: await response.json()};
}
const state = async app => (await request(app, 'state')).data;
async function until(check) { for (let i = 0; i < 180; i++) { const value = await check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 40)); } assert.fail('Queue state timed out'); }
const events = dir => fs.existsSync(path.join(dir, 'events.jsonl')) ? fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse) : [];

test('queue persists edits/order/drafts, rejects duplicates, and resumes interrupted work only explicitly', t => {
  const dir = temp(t), q = createBookQueue(dir), a = q.add(input('甲')), b = q.add(input('乙'));
  assert.throws(() => q.add(input('甲')), /已经在队列/);
  q.move(b.id, -1); q.edit(a.id, input('丙')); q.mark(b.id, {state: 'running'});
  assert.throws(() => q.remove(b.id), /正在处理/); assert.throws(() => q.move(a.id, -1), /正在处理/);
  q.draft({...input('草稿'), revision: 10}); q.draft({...input('旧请求'), revision: 9});
  const restored = createBookQueue(dir);
  assert.equal(restored.snapshot().paused, true); assert.equal(restored.next(), undefined);
  assert.deepEqual(restored.snapshot().items.map(i => [i.input.title, i.state]), [['乙', 'queued'], ['丙', 'queued']]);
  assert.equal(restored.snapshot().draft.title, '草稿'); restored.resume(); assert.equal(restored.next().id, b.id);
  restored.remove(a.id); assert.equal(restored.snapshot().items.length, 1);
});

test('damaged queue records are preserved and never overwritten by a new draft or item', t => {
  const dir = temp(t), file = path.join(dir, 'desktop-queue.json'); fs.writeFileSync(file, '{broken');
  const q = createBookQueue(dir); assert.ok(q.snapshot().unavailable);
  assert.throws(() => q.add(input('甲')), /无法读取/); assert.throws(() => q.draft({...input('草稿'), revision: 1}), /无法读取/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
});

test('completed history is bounded while pending books remain intact', t => {
  const dir = temp(t), q = createBookQueue(dir), items = Array.from({length: 40}, (_, index) => q.add(input(`书${index}`)));
  for (const item of items.slice(0, 35)) q.finish(item.id, {phase: 'complete', message: '已完成'});
  assert.equal(q.snapshot().items.filter(item => item.state === 'complete').length, 30);
  assert.equal(q.snapshot().items.filter(item => item.state === 'queued').length, 5);
  assert.ok(q.snapshot().items.find(item => item.id === items[34].id));
  assert.ok(!q.snapshot().items.find(item => item.id === items[0].id));
});

test('queue runs serially after worker close while accepting new input, persisted drafts and reorder/edit', async t => {
  const dir = temp(t); fs.writeFileSync(path.join(dir, 'hold-甲'), '');
  const app = await appFor(dir);
  try {
    assert.equal((await request(app, 'queue/add', input('甲'))).status, 202);
    await until(async () => (await state(app)).task.phase === 'download');
    const b = (await request(app, 'queue/add', input('乙'))).data.id, c = (await request(app, 'queue/add', input('丙'))).data.id;
    assert.equal((await request(app, 'draft', {...input('下一本草稿'), revision: 1})).status, 200);
    await request(app, 'queue/move', {id: c, direction: -1}); await request(app, 'queue/edit', {...input('丁'), id: b});
    assert.equal((await request(app, 'queue/add', input('丁'))).status, 400);
    assert.equal((await state(app)).task.title, '甲'); assert.equal((await state(app)).queue.draft.title, '下一本草稿');
    fs.unlinkSync(path.join(dir, 'hold-甲'));
    await until(async () => (await state(app)).queue.items.filter(i => i.state === 'complete').length === 3);
    assert.deepEqual(events(dir).map(e => [e.event, e.title]), [['start','甲'],['done','甲'],['closed','甲'],['start','丙'],['done','丙'],['closed','丙'],['start','丁'],['done','丁'],['closed','丁']]);
  } finally { await app.close(); }
});

test('pause finishes the current book; stopping saves it and prevents the next book from starting', async t => {
  const dir = temp(t); fs.writeFileSync(path.join(dir, 'hold-甲'), ''); fs.writeFileSync(path.join(dir, 'hold-乙'), '');
  const app = await appFor(dir);
  try {
    await request(app, 'queue/add', input('甲')); await until(async () => (await state(app)).task.phase === 'download');
    await request(app, 'queue/add', input('乙')); await request(app, 'queue/add', input('丙'));
    await request(app, 'queue/pause', {}); assert.equal((await state(app)).task.phase, 'download');
    fs.unlinkSync(path.join(dir, 'hold-甲')); await until(async () => (await state(app)).queue.items[0].state === 'complete');
    assert.deepEqual(events(dir).filter(e => e.event === 'start').map(e => e.title), ['甲']);
    await request(app, 'queue/resume', {}); await until(async () => (await state(app)).task.title === '乙' && (await state(app)).task.phase === 'download');
    await request(app, 'stop', {}); await until(async () => (await state(app)).queue.items.find(i => i.input.title === '乙').state === 'stopped');
    const s = await state(app); assert.equal(s.queue.paused, true); assert.equal(s.task.report.downloaded, 1);
    assert.deepEqual(events(dir).filter(e => e.event === 'start').map(e => e.title), ['甲', '乙']);
  } finally { await app.close(); }
});

test('ambiguous titles require choosing an author and do not start workers or the next queued book', async t => {
  const dir = temp(t), app = await appFor(dir, {findBooks: async ({title}) => title === '同名书' ? [book(title, '甲作者', 'a'), book(title, '乙作者', 'b')] : [book(title)]});
  try {
    const id = (await request(app, 'queue/add', {...input('同名书'), author: ''})).data.id;
    await request(app, 'queue/add', input('下一本'));
    await until(async () => (await state(app)).queue.items[0].state === 'waiting');
    assert.equal(events(dir).length, 0); assert.equal((await request(app, 'queue/resume', {})).status, 400);
    assert.equal((await request(app, 'queue/choose', {id, url: 'https://untrusted.example/'})).status, 400);
    await request(app, 'queue/choose', {id, url: book('同名书', '乙作者', 'b').url});
    await until(async () => (await state(app)).queue.items.filter(i => i.state === 'complete').length === 2);
    assert.equal((await state(app)).queue.items.find(i => i.id === id).book.author, '乙作者');
  } finally { await app.close(); }
});

test('failure pauses the queue, retry continues it, and a closed desktop restores paused state', async t => {
  const dir = temp(t); fs.writeFileSync(path.join(dir, 'fail-once-甲'), ''); fs.writeFileSync(path.join(dir, 'hold-乙'), '');
  let app = await appFor(dir);
  try {
    const id = (await request(app, 'queue/add', input('甲'))).data.id; await request(app, 'queue/add', input('乙'));
    await until(async () => (await state(app)).queue.items[0].state === 'error');
    assert.equal((await state(app)).queue.paused, true);
    await request(app, 'queue/retry', {id}); await until(async () => (await state(app)).task.title === '乙' && (await state(app)).task.phase === 'download');
    await app.close(); app = await appFor(dir);
    assert.equal((await state(app)).queue.paused, true); assert.equal((await state(app)).task.busy, false);
    assert.deepEqual(events(dir).filter(e => e.event === 'start').map(e => e.title), ['甲', '甲', '乙']);
    fs.unlinkSync(path.join(dir, 'hold-乙')); await request(app, 'queue/resume', {});
    await until(async () => (await state(app)).queue.items.every(i => i.state === 'complete'));
  } finally { await app.close(); }
});

test('stopping a queued search discards late results and keeps the next task waiting', async t => {
  const dir = temp(t), app = await appFor(dir, {findBooks: async ({title, signal}) => { await new Promise(resolve => signal.addEventListener('abort', resolve, {once: true})); return [book(title)]; }});
  try {
    await request(app, 'queue/add', input('甲')); await until(async () => (await state(app)).task.phase === 'search');
    assert.equal((await request(app, 'queue/add', input('乙'))).status, 202); await request(app, 'stop', {});
    await until(async () => (await state(app)).queue.items[0].state === 'stopped');
    assert.equal(events(dir).length, 0); assert.equal((await state(app)).queue.items[1].state, 'queued');
  } finally { await app.close(); }
});

test('queue accepts books during legacy collection and pauses after its failure', async t => {
  const dir = temp(t); fs.writeFileSync(path.join(dir, 'hold-甲'), ''); fs.writeFileSync(path.join(dir, 'fail-once-甲'), '');
  const app = await appFor(dir);
  try {
    await request(app, 'search', input('甲')); assert.equal((await request(app, 'start', {url: book('甲').url})).status, 200);
    await until(async () => (await state(app)).task.phase === 'download');
    assert.equal((await request(app, 'queue/add', input('乙'))).status, 202);
    fs.unlinkSync(path.join(dir, 'hold-甲')); await until(async () => !(await state(app)).task.busy);
    assert.equal((await state(app)).queue.paused, true);
    assert.deepEqual(events(dir).filter(e => e.event === 'start').map(e => e.title), ['甲']);
    await request(app, 'queue/resume', {}); await until(async () => (await state(app)).queue.items[0].state === 'complete');
  } finally { await app.close(); }
});

test('stopping while resolving a queued book prevents a late worker launch', async t => {
  const dir = temp(t), app = await appFor(dir, {prepareBook: async b => { await new Promise(resolve => b.signal.addEventListener('abort', resolve, {once: true})); return spec(b); }});
  try {
    await request(app, 'queue/add', input('甲')); await until(async () => (await state(app)).task.phase === 'resolving');
    await request(app, 'queue/add', input('乙')); await request(app, 'stop', {});
    await until(async () => (await state(app)).queue.items[0].state === 'stopped');
    assert.equal(events(dir).length, 0); assert.equal((await state(app)).queue.paused, true);
  } finally { await app.close(); }
});

test('probe-only results complete their queue item without blocking the next book', async t => {
  const dir = temp(t), app = await appFor(dir);
  try {
    await request(app, 'queue/add', {...input('甲'), probeOnly: true}); await request(app, 'queue/add', input('乙'));
    await until(async () => (await state(app)).queue.items.every(i => ['probed', 'complete'].includes(i.state)));
    assert.equal((await state(app)).queue.items.find(i => i.input.title === '甲').state, 'probed');
  } finally { await app.close(); }
});

test('queue result save failures block all new jobs until the original result is durably recorded', async t => {
  const dir = temp(t); fs.writeFileSync(path.join(dir, 'hold-甲'), '');
  const app = await appFor(dir), rename = fs.renameSync; let locked = false;
  fs.renameSync = (from, to) => { if (locked && to === path.join(dir, 'desktop-queue.json')) throw Object.assign(Error('synthetic sharing violation'), {code: 'EPERM'}); return rename(from, to); };
  try {
    await request(app, 'queue/add', input('甲')); await until(async () => (await state(app)).task.phase === 'download');
    await request(app, 'queue/add', input('乙')); locked = true; fs.unlinkSync(path.join(dir, 'hold-甲'));
    await until(async () => (await state(app)).queue.error);
    assert.equal((await state(app)).queue.items[0].state, 'running');
    assert.equal((await request(app, 'search', input('丙'))).status, 409);
    assert.equal((await request(app, 'upload-library', {})).status, 409);
    assert.deepEqual(events(dir).filter(e => e.event === 'start').map(e => e.title), ['甲']);
    locked = false; await request(app, 'draft', {...input('草稿'), revision: 1});
    await until(async () => (await state(app)).queue.items.every(i => i.state === 'complete'));
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'desktop-queue.json'), 'utf8'));
    assert.equal(saved.items.find(i => i.input.title === '甲').report.title, '甲'); assert.equal(saved.draft.title, '草稿');
  } finally { locked = false; fs.renameSync = rename; await app.close(); }
});
