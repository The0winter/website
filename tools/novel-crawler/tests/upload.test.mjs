import '../../test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {planUpload, uploadLibrary, uploadBatchLimits} from '../desktop/upload.mjs';
import {planLibrary} from '../desktop/library.mjs';
import {createDesktop} from '../desktop/server.mjs';
import {atomicWrite, hash, readJson} from '../storage.mjs';
import {continuationKey} from '../continuation.mjs';
import {createVpsLibraryTransport, applyLibraryBatches} from '../../../infra/library-sync-vps.mjs';
import {reviewedUploadIdentity} from '../desktop/upload-identity.mjs';

const sha = content => crypto.createHash('sha256').update(content).digest('hex');
const chapter = number => ({chapter_number: number, title: `第${number}章 ${String.fromCodePoint(0x5000 + number)}`, content: Array.from({length: 300}, (_, i) => String.fromCodePoint(0x4e00 + number * 350 + i)).join(''), link: `https://example.test/chapter/${number}`});
const book = (name = '测试故事', count = 3) => ({title: name, author: '测试作者', sourceUrl: `https://example.test/book/${encodeURIComponent(name)}`, chapters: Array.from({length: count}, (_, i) => chapter(i + 1))});
const snapshot = book => book ? {book: {...book, chapters: undefined}, bookId: '123', chapters: book.chapters.map(c => ({number: c.chapter_number, title: c.title, hash: sha(c.content), link: c.link}))} : {book: null, chapters: []};
function fixture(t) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-upload-')), outputDir = path.join(stateDir, 'downloads');
  fs.mkdirSync(outputDir);
  t.after(() => { assert.equal(path.dirname(stateDir), os.tmpdir()); fs.rmSync(stateDir, {recursive: true, force: true}); });
  return {stateDir, outputDir, save: (name, data) => atomicWrite(path.join(outputDir, name), data)};
}
function memoryTransport(initial = []) {
  const books = new Map(initial.map(book => [book.sourceUrl, structuredClone(book)])), calls = [];
  return {books, calls, async send(job, {onProgress = () => {}} = {}) {
    calls.push(structuredClone(job));
    if (job.mode === 'inspect') return snapshot(books.get(job.sourceUrl));
    let added = 0;
    for (const [index, batch] of job.batches.entries()) {
      let current = books.get(batch.sourceUrl);
      if (!current) { current = {...batch, chapters: []}; books.set(batch.sourceUrl, current); }
      Object.assign(current, {...batch, chapters: current.chapters});
      for (const c of batch.chapters) {
        const previous = current.chapters.find(p => p.chapter_number === c.chapter_number);
        if (!previous) { current.chapters.push(c); added++; }
        else Object.assign(previous, c);
      }
      onProgress({batch: index + 1, batches: job.batches.length, added});
    }
    return {added, bookId: '123'};
  }};
}
const request = (app, action, body = {}) => fetch(`${app.baseUrl}/api/${action}`, {method: 'POST', headers: {'x-desktop-token': app.token, 'Content-Type': 'application/json'}, body: JSON.stringify(body)});
async function until(check) { const deadline = Date.now() + 10000; while (Date.now() < deadline) { if (await check()) return; await new Promise(r => setTimeout(r, 30)); } assert.fail('timeout'); }

test('new books batch up to 200 chapters; unchanged bodies and absent metadata do not upload; covers stay managed', () => {
  const source = {...book('长篇', 204), cover_image: 'https://example.test/old-cover.jpg'};
  const plan = planUpload(source, snapshot(null));
  assert.equal(plan.newBook, true); assert.equal(plan.expectedAdded, 204); assert.deepEqual(plan.batches.map(b => b.chapters.length), [200, 4]);
  assert.ok(plan.batches.every(batch => !Object.hasOwn(batch, 'cover_image')));
  const online = snapshot({...source, description: '网站简介'});
  assert.equal(planUpload(source, online).batches.length, 0);
  const updated = planUpload({...source, description: '更新简介', status: '完结'}, online);
  assert.equal(updated.expectedAdded, 0); assert.deepEqual(updated.batches[0].chapters, []); assert.equal(updated.batches[0].status, '完结');
});

test('all overlapping chapters are checked before any upload, including gaps, old local files, deleted chapters and changed source links', () => {
  const source = book('旧书', 4), online = snapshot({...source, chapters: [source.chapters[0], source.chapters[2]]});
  assert.deepEqual(planUpload(source, online).batches[0].chapters.map(c => c.chapter_number), [2, 4]);
  assert.equal(planUpload({...source, chapters: source.chapters.slice(0, 2)}, snapshot(source)).batches.length, 0);
  for (const change of [{title: '别的章节'}, {hash: sha('changed')}, {deleted: true}, {link: 'https://example.test/other'}]) {
    const conflicting = structuredClone(online); Object.assign(conflicting.chapters[0], change);
    assert.throws(() => planUpload(source, conflicting), /第 1 章/);
  }
  assert.throws(() => planUpload(source, {...online, book: {...source, author: '同名其他作者'}}), /身份/);
  const noLink = snapshot(source); delete noLink.chapters[0].link;
  assert.equal(planUpload(source, noLink).batches.length, 0, 'missing provenance must not re-upload an existing body');
});

test('reviewed title aliases preserve the website title and all identity and chapter guards', async t => {
  const f = fixture(t), source = book('本地旧名', 4), online = {...source, title: '网站新名', chapters: source.chapters.slice(0, 3)};
  f.save('book.json', source);
  const value = {sourceUrl: source.sourceUrl, author: source.author, localTitle: source.title, websiteTitle: online.title, bookId: '123'};
  const file = path.join(f.stateDir, 'library-upload-identities', hash(source.sourceUrl) + '.json');
  atomicWrite(file, {value, hash: hash(value)});
  const transport = memoryTransport([online]);
  const result = await uploadLibrary({...f, transport: transport.send});
  assert.equal(result.failed, 0); assert.equal(result.added, 1);
  assert.equal(transport.books.get(source.sourceUrl).title, online.title);
  for (const remote of [
    {...snapshot(online), bookId: 'other'},
    snapshot({...online, author: '其他作者'}),
    snapshot({...online, sourceUrl: 'https://example.test/other'}),
    snapshot({...online, title: '再次改名'}),
    snapshot(null),
  ]) assert.throws(() => reviewedUploadIdentity(source, remote, f.stateDir), /映射/);
  assert.throws(() => reviewedUploadIdentity({...source, title: '不同书籍'}, snapshot(online), f.stateDir), /映射/);
  const conflict = snapshot(online); conflict.chapters[0].hash = sha('changed');
  assert.throws(() => planUpload(reviewedUploadIdentity(source, conflict, f.stateDir), conflict), /第 1 章/);
  atomicWrite(file, {value: {...value, websiteTitle: '篡改'}, hash: hash(value)});
  assert.throws(() => reviewedUploadIdentity(source, snapshot(online), f.stateDir), /映射/);
});

test('large Unicode bodies split by actual JSON bytes before the HTTP body limit', () => {
  const source = book('大章节', 50);
  source.chapters = source.chapters.map((c, i) => ({...c, content: String.fromCodePoint(0x6000 + i).repeat(60000)}));
  const plan = planUpload(source, snapshot(null));
  assert.ok(plan.batches.length > 1);
  assert.equal(plan.batches.flatMap(batch => batch.chapters).length, 50);
  assert.ok(plan.batches.every(batch => Buffer.byteLength(JSON.stringify({...batch, missingOnly: true, dryRun: false})) <= uploadBatchLimits.bytes));
});

test('preflight overlaps up to four batches, drains failures, and keeps writes ordered after all checks', async () => {
  const batches = Array.from({length: 9}, (_, index) => ({index, chapters: []}));
  let active = 0, peak = 0, checked = 0;
  const writes = [], progress = [];
  const send = async (batch, dryRun) => {
    assert.equal(batch.missingOnly, true);
    if (dryRun) {
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--; checked++;
      return {};
    }
    assert.equal(checked, batches.length); assert.equal(active, 0);
    writes.push(batch.index); return {inserted: 1, bookId: 'book'};
  };
  assert.equal((await applyLibraryBatches({batches}, {send, emit: event => progress.push(event)})).added, 9);
  assert.equal(peak, 4); assert.deepEqual(writes, batches.map(batch => batch.index));
  assert.deepEqual(progress.filter(p => p.stage === 'preflight').map(p => p.batch), [1,2,3,4,5,6,7,8,9]);
  let started = 0;
  await assert.rejects(applyLibraryBatches({batches}, {emit() {}, async send(batch, dryRun) {
    assert.equal(dryRun, true); started++; active++;
    try { await new Promise(resolve => setTimeout(resolve, batch.index ? 10 : 1)); if (!batch.index) throw Error('conflict'); }
    finally { active--; }
  }}), /conflict/);
  assert.equal(active, 0); assert.equal(started, 4);
});

test('upload selection follows bound editions without requiring a source adapter and refuses uncommitted or modified bindings', t => {
  const f = fixture(t), source = book(); f.save('original.json', source); f.save('accepted.json', source);
  const file = path.join(f.outputDir, 'accepted.json');
  const dir = path.join(f.stateDir, 'continuations', continuationKey(source));
  const binding = {file: 'accepted.json', outputPath: file, source: {url: 'https://other.test/book'}, exportHash: hash(fs.readFileSync(file))};
  atomicWrite(path.join(dir, 'binding.json'), {value: binding, hash: hash(binding)});
  assert.equal(planLibrary({...f, forUpload: true})[0].file, 'accepted.json');
  assert.equal(planLibrary({...f, forUpload: true})[0].state, 'pending');
  f.save('accepted.json', {...source, description: '外部修改'});
  assert.match(planLibrary({...f, forUpload: true})[0].message, /被修改/);
  atomicWrite(path.join(dir, 'pending.json'), {value: {next: binding}, hash: hash({next: binding})});
  assert.match(planLibrary({...f, forUpload: true})[0].message, /尚未完成/);
});

test('library uploads new books and only new chapters, isolates conflicts, persists results and repeat runs do no writes', async t => {
  const f = fixture(t), existing = book('旧书', 2), conflict = book('冲突书', 2), fresh = book('新书', 2);
  f.save('old.json', book('旧书', 4)); f.save('new.json', fresh); f.save('conflict.json', {...conflict, chapters: [{...chapter(1), content: '不同正文'}, chapter(2)]}); f.save('report.json', {errors: []});
  const remote = memoryTransport([existing, conflict]);
  const result = await uploadLibrary({...f, transport: remote.send});
  assert.equal(result.uploaded, 2); assert.equal(result.newBooks, 1); assert.equal(result.failed, 1); assert.equal(result.added, 4);
  assert.equal(remote.books.get(existing.sourceUrl).chapters.length, 4);
  assert.deepEqual(remote.calls.filter(c => c.mode === 'apply').map(c => c.batches.flatMap(b => b.chapters).length), [2, 2]);
  remote.calls.length = 0;
  const repeat = await uploadLibrary({...f, transport: remote.send});
  assert.equal(repeat.unchanged, 2); assert.equal(repeat.failed, 1); assert.equal(remote.calls.filter(c => c.mode === 'apply').length, 0);
  assert.equal(fs.readdirSync(path.join(f.stateDir, 'uploads')).length, 2);
});

test('stopped and partially uploaded books resume using fresh website data, and failed readback is not success', async t => {
  const f = fixture(t), source = book('断点', 204); f.save('book.json', source);
  const remote = memoryTransport(), controller = new AbortController();
  const interrupted = await uploadLibrary({...f, signal: controller.signal, transport: async (job, options) => {
    if (job.mode === 'apply') { await remote.send({...job, batches: job.batches.slice(0, 1)}, options); controller.abort(); throw Error('connection lost'); }
    return remote.send(job, options);
  }});
  assert.equal(interrupted.stopped, true); assert.equal(interrupted.uploaded, 0); assert.equal(interrupted.added, 200);
  remote.calls.length = 0;
  assert.equal((await uploadLibrary({...f, transport: remote.send})).added, 4);
  assert.equal(remote.calls.find(c => c.mode === 'apply').batches[0].chapters.length, 4);
  const failed = await uploadLibrary({...f, transport: async job => job.mode === 'inspect' ? snapshot(null) : {added: 24, bookId: 'x'}});
  assert.equal(failed.failed, 1); assert.equal(failed.uploaded, 0); assert.match(failed.items[0].message, /回读/);
});

test('queued file mutations fail before writing and duplicate versions cannot create duplicate website books', async t => {
  const f = fixture(t); f.save('a.json', book('一本')); f.save('b.json', book('另一本'));
  const remote = memoryTransport(); let changed = false;
  const result = await uploadLibrary({...f, transport: remote.send, onLibrary: batch => {
    if (!changed && batch.items.some(i => i.state === 'uploaded')) { changed = true; f.save('b.json', book('被修改')); }
  }});
  assert.equal(result.failed, 1); assert.match(result.items.find(i => i.state === 'failed').message, /文件被修改/);
  f.save('duplicate.json', book('一本'));
  assert.match(planLibrary({...f, forUpload: true}).find(i => i.title === '一本').message, /多个/);
});

test('a website-wide outage stops the queue once and keeps unfinished books available to retry', async t => {
  const f = fixture(t); f.save('a.json', book('一本')); f.save('b.json', book('二本'));
  let calls = 0;
  const result = await uploadLibrary({...f, transport: async () => { calls++; throw Object.assign(Error('网站 D1 今日额度已用尽'), {fatal: true}); }});
  assert.equal(calls, 1); assert.equal(result.failed, 1); assert.equal(result.uploaded, 0);
  assert.match(result.blockedReason, /额度/); assert.equal(result.items[1].state, 'stopped');
});

test('SSH transport keeps payload out of the command, reports partial progress, cancels and hides diagnostic output', async () => {
  let child, spawnArgs, script;
  const spawnProcess = (...args) => {
    spawnArgs = args; child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.stdin.on('data', bytes => { script = bytes.toString(); }); child.kill = () => queueMicrotask(() => child.emit('close', 1)); return child;
  };
  const send = createVpsLibraryTransport({spawnProcess});
  const progress = [], pending = send({mode: 'inspect', title: '`danger` $(secret)'}, {onProgress: p => progress.push(p)});
  assert.equal(spawnArgs[2].windowsHide, true); assert.ok(!spawnArgs[1].join(' ').includes('danger')); assert.ok(script.includes('danger'));
  child.stderr.write('sensitive environment detail'); child.stdout.write('{"type":"progress","batch":1}\n{"type":"result","result":{"book":null,"chapters":[]}}\n'); child.emit('close', 0);
  assert.deepEqual(await pending, snapshot(null)); assert.equal(progress.length, 1);
  const controller = new AbortController(), canceled = send({mode: 'inspect'}, {signal: controller.signal}); controller.abort(); await assert.rejects(canceled, /已停止/);
  const failed = send({mode: 'inspect'}); child.stderr.write('PRIVATE'); child.emit('close', 255); await assert.rejects(failed, error => !error.message.includes('PRIVATE'));
});

test('desktop upload endpoint rejects foreign requests, blocks simultaneous work and restores interrupted status', async t => {
  const f = fixture(t), workerPath = path.join(f.stateDir, 'worker.mjs');
  fs.writeFileSync(workerPath, `process.on('message', m => { if (m.type === 'start') process.send({type:'upload-phase',title:'合成测试书'}); if (m.type === 'stop') { process.send({type:'upload-done',batch:{kind:'upload',stopped:true,total:1,newBooks:0,added:0,unchanged:0,items:[]}}); process.disconnect(); } });`);
  let app = await createDesktop({...f, uploadWorker: workerPath});
  try {
    assert.equal((await fetch(app.baseUrl + '/api/upload-library', {method: 'POST'})).status, 403);
    assert.equal((await fetch(app.baseUrl + '/api/upload-library', {method: 'POST', headers: {'x-desktop-token': app.token, origin: 'https://foreign.test'}})).status, 403);
    assert.equal((await request(app, 'upload-library')).status, 202);
    await until(() => app.state().title === '合成测试书');
    for (const action of ['upload-library', 'update-library', 'search', 'start']) assert.equal((await request(app, action)).status, 409);
    assert.equal((await request(app, 'stop')).status, 200); await until(() => app.state().phase === 'stopped');
  } finally { await app.close(); }
  atomicWrite(path.join(f.stateDir, 'desktop-last-task.json'), {kind: 'upload', phase: 'upload', batch: {items: [{state: 'running'}, {state: 'uploaded'}]}});
  app = await createDesktop(f);
  try { assert.equal(app.state().phase, 'paused'); assert.match(app.state().message, /上传书库/); assert.deepEqual(app.state().batch.items.map(i => i.state), ['stopped', 'uploaded']); }
  finally { await app.close(); }
});

test('upload survives progress-file locks, retries the final summary without new events and repeats without duplicate writes', async t => {
  const f = fixture(t), source = book(); f.save('book.json', source);
  const file = path.join(f.stateDir, 'desktop-last-task.json'), rename = fs.renameSync;
  let locked = false, denied = 0;
  t.mock.method(fs, 'renameSync', (from, to) => {
    if (to === file && locked) { denied++; throw Object.assign(Error('summary is locked'), {code: 'EPERM'}); }
    return rename(from, to);
  });
  const app = await createDesktop({...f, uploadWorker: path.resolve('tools/novel-crawler/tests/upload-fixture-worker.mjs')});
  try {
    assert.equal((await request(app, 'upload-library')).status, 202);
    locked = true;
    await until(() => app.state().phase === 'complete');
    assert.ok(denied >= 6);
    const state = await (await fetch(app.baseUrl + '/api/state', {headers: {'x-desktop-token': app.token}})).json();
    assert.match(state.task.persistenceWarning, /进度暂未保存/);
    assert.equal(state.task.batch.added, source.chapters.length);
    assert.equal(readJson(file).phase, 'upload', 'the old summary remains valid while locked');
    const website = path.join(f.stateDir, 'synthetic-website.json'), uploaded = fs.readFileSync(website, 'utf8');
    assert.equal(readJson(website)[source.sourceUrl].chapters.length, source.chapters.length);
    locked = false;
    await until(() => !app.state().persistenceWarning && readJson(file).phase === 'complete');
    assert.equal(readJson(file).batch.added, source.chapters.length);
    assert.ok(!Object.hasOwn(readJson(file), 'persistenceWarning'), 'warnings are not persisted as task results');
    assert.equal((await request(app, 'upload-library')).status, 202);
    await until(() => app.state().phase === 'complete');
    assert.equal(app.state().batch.unchanged, 1);
    assert.equal(app.state().batch.added, 0);
    assert.equal(fs.readFileSync(website, 'utf8'), uploaded);
    assert.ok(!fs.readdirSync(f.stateDir).some(name => name.endsWith('.tmp')));
  } finally { locked = false; await app.close(); }
});

test('an unwritable initial summary does not prevent stopping the worker or closing the desktop', async t => {
  const f = fixture(t), workerPath = path.join(f.stateDir, 'worker.mjs');
  fs.writeFileSync(workerPath, `process.on('message', m => { if (m.type === 'start') process.send({type:'upload-phase',title:'等待停止'}); if (m.type === 'stop') { process.send({type:'upload-done',batch:{kind:'upload',stopped:true,total:0,newBooks:0,added:0,unchanged:0,items:[]}}); process.disconnect(); } });`);
  const write = fs.writeFileSync, prefix = path.join(f.stateDir, 'desktop-last-task.json.');
  const injected = t.mock.method(fs, 'writeFileSync', (file, ...args) => {
    if (String(file).startsWith(prefix)) throw Object.assign(Error('disk is full'), {code: 'ENOSPC'});
    return write(file, ...args);
  });
  const app = await createDesktop({...f, uploadWorker: workerPath});
  try {
    assert.equal((await request(app, 'upload-library')).status, 202);
    await until(() => app.state().title === '等待停止');
    assert.match(app.state().persistenceWarning, /自动重试/);
    assert.equal((await request(app, 'stop')).status, 200);
    await until(() => app.state().phase === 'stopped');
  } finally { await app.close(); }
  const writesAfterClose = injected.mock.callCount();
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.equal(injected.mock.callCount(), writesAfterClose, 'closing cancels pending save retries');
});
