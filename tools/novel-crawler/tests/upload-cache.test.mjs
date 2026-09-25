import '../../test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {hash, atomicWrite} from '../storage.mjs';
import {uploadLibrary} from '../desktop/upload.mjs';
import {planLibrary} from '../desktop/library.mjs';
import {continuationKey} from '../continuation.mjs';
import {createVpsLibrarySession} from '../../../infra/library-sync-session.mjs';
import {applyLibraryBatches} from '../../../infra/library-sync-vps.mjs';

const chapter = number => ({chapter_number: number, title: `第${number}章 故事`, content: `章节${number}的合成测试正文。`, link: `https://example.test/${number}`});
const book = (i = 0, count = 2) => ({title: `测试书${i}`, author: '测试作者', sourceUrl: `https://example.test/book/${i}`, chapters: Array.from({length: count}, (_, i) => chapter(i + 1))});
function fixture(t) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-cache-')), outputDir = path.join(stateDir, 'downloads'); fs.mkdirSync(outputDir);
  t.after(() => { assert.equal(path.dirname(stateDir), os.tmpdir()); fs.rmSync(stateDir, {recursive: true, force: true}); });
  return {stateDir, outputDir, save: (b, name = `${b.title}.json`) => atomicWrite(path.join(outputDir, name), b)};
}
function website(initial) {
  const books = new Map(initial.map(b => [b.sourceUrl, structuredClone(b)])), calls = [];
  const state = {scope: 'database-and-release-1', closed: 0, books, calls};
  const token = b => b ? hash(b) : null;
  const send = async (job, {onProgress = () => {}} = {}) => {
    calls.push(structuredClone(job));
    if (job.mode === 'headers') return {scope: state.scope, headers: job.identities.map(b => ({sourceUrl: b.sourceUrl, token: token(books.get(b.sourceUrl))}))};
    if (job.mode === 'inspect') {
      await state.beforeInspect?.(job);
      const b = books.get(job.sourceUrl), revision = token(b);
      const partial = !!job.knownToken && job.knownToken === revision;
      return {scope: state.scope, token: revision, partial, bookId: b?.sourceUrl, book: b && {...b, chapters: undefined},
        chapters: (b?.chapters || []).filter(c => !partial || job.numbers.includes(c.chapter_number)).map(c => ({number: c.chapter_number, title: c.title, hash: hash(c.content), link: c.link}))};
    }
    return {...await applyLibraryBatches(job, {emit: onProgress, send: async (batch, dryRun) => {
      if (dryRun) return {};
      const old = books.get(batch.sourceUrl), previousToken = token(old);
      const next = {...batch, chapters: [...(old?.chapters || [])]}; delete next.missingOnly;
      for (const c of batch.chapters) if (!next.chapters.some(row => row.chapter_number === c.chapter_number)) next.chapters.push(c);
      books.set(batch.sourceUrl, next);
      return {inserted: next.chapters.length - (old?.chapters.length || 0), bookId: batch.sourceUrl, previousToken, token: token(next)};
    }}), scope: state.scope};
  };
  send.batchHeaders = true; send.close = async () => { state.closed++; };
  return {...state, transport: send, state};
}

test('1000 unchanged books take five header batches, zero chapter queries and zero export reads after a verified baseline', async t => {
  const f = fixture(t), books = Array.from({length: 1000}, (_, i) => book(i, 1)); books.forEach(b => f.save(b));
  const remote = website(books);
  assert.equal((await uploadLibrary({...f, transport: remote.transport})).unchanged, 1000);
  remote.calls.length = 0;
  const original = fs.readFileSync; let exportReads = 0;
  t.mock.method(fs, 'readFileSync', (file, ...args) => { if (path.dirname(String(file)) === f.outputDir) exportReads++; return original(file, ...args); });
  const result = await uploadLibrary({...f, transport: remote.transport});
  assert.equal(result.unchanged, 1000); assert.equal(result.failed, 0); assert.equal(result.metrics.fastSkipped, 1000);
  assert.equal(remote.calls.length, 5); assert.ok(remote.calls.every(c => c.mode === 'headers' && c.identities.length === 200));
  assert.equal(exportReads, 0); assert.equal(remote.state.closed, 2);
  t.diagnostic(`warm 1000-book local run: ${new Date(result.finishedAt) - new Date(result.startedAt)} ms (simulated website)`);
});

test('completed books upload once, then skip all network calls and unchanged export reads', async t => {
  const f = fixture(t), source = {...book(), status: '完结'}; f.save(source);
  const remote = website([]), first = await uploadLibrary({...f, transport: remote.transport});
  assert.equal(first.newBooks, 1); assert.equal(first.added, 2); assert.equal(first.completed, 0);
  remote.calls.length = 0;
  const read = fs.readFileSync; let exportReads = 0;
  t.mock.method(fs, 'readFileSync', (file, ...args) => { if (path.dirname(String(file)) === f.outputDir) exportReads++; return read(file, ...args); });
  const next = await uploadLibrary({...f, transport: remote.transport});
  assert.equal(next.completed, 1); assert.equal(next.checked, 1); assert.equal(next.unchanged, 0); assert.equal(next.failed, 0);
  assert.equal(remote.calls.length, 0); assert.equal(exportReads, 0);
});

test('header batches exclude completed books even when they appear after ongoing books', async t => {
  const f = fixture(t), ongoing = book(0), complete = {...book(1), status: '完结'};
  f.save(ongoing); f.save(complete); const remote = website([ongoing, complete]);
  await uploadLibrary({...f, transport: remote.transport}); remote.calls.length = 0;
  const next = await uploadLibrary({...f, transport: remote.transport});
  assert.equal(next.completed, 1); assert.equal(next.unchanged, 1); assert.equal(remote.calls.length, 1);
  assert.deepEqual(remote.calls[0].identities.map(b => b.sourceUrl), [ongoing.sourceUrl]);
});

test('completed-book additions and metadata edits still upload, and conflicting body edits still fail safely', async t => {
  const f = fixture(t), source = {...book(), status: '完结'}; f.save(source); const remote = website([source]);
  await uploadLibrary({...f, transport: remote.transport});
  const expanded = {...source, chapters: [...source.chapters, chapter(3)]}; f.save(expanded);
  const added = await uploadLibrary({...f, transport: remote.transport});
  assert.equal(added.completed, 0); assert.equal(added.uploaded, 1); assert.equal(added.added, 1);
  const edited = {...expanded, description: '补充简介'}; f.save(edited);
  assert.equal((await uploadLibrary({...f, transport: remote.transport})).uploaded, 1);
  assert.equal(remote.books.get(source.sourceUrl).description, edited.description);
  assert.equal((await uploadLibrary({...f, transport: remote.transport})).completed, 1);
  f.save({...edited, status: '连载'});
  assert.equal((await uploadLibrary({...f, transport: remote.transport})).uploaded, 1);
  f.save({...edited, chapters: [{...chapter(1), content: '另一个版本'}, chapter(2), chapter(3)]});
  const conflict = await uploadLibrary({...f, transport: remote.transport});
  assert.equal(conflict.failed, 1); assert.equal(conflict.completed, 0);
  assert.equal(remote.books.get(source.sourceUrl).chapters[0].content, source.chapters[0].content);
});

test('completed skips honor legacy full verification, forceFull and corrupt receipt fallback', async t => {
  const f = fixture(t), source = {...book(), status: '完结'}; f.save(source); const remote = website([source]);
  await uploadLibrary({...f, transport: remote.transport});
  const dir = path.join(f.stateDir, 'library-upload-cache', hash(path.resolve(f.outputDir)).slice(0, 20));
  const file = path.join(dir, 'verified.json'), record = JSON.parse(fs.readFileSync(file));
  for (const value of Object.values(record.value)) { delete value.completed; value.verifiedAt -= 31 * 86400000; }
  record.hash = hash(record.value); atomicWrite(file, record); remote.calls.length = 0;
  assert.equal((await uploadLibrary({...f, transport: remote.transport})).completed, 1);
  assert.equal(remote.calls.length, 0);
  const forced = await uploadLibrary({...f, transport: remote.transport, forceFull: true});
  assert.equal(forced.completed, 0); assert.equal(forced.metrics.fullInspections, 1);
  fs.writeFileSync(file, '{broken');
  assert.equal((await uploadLibrary({...f, transport: remote.transport})).metrics.fullInspections, 1);
});

test('completed receipts still reject binding changes, incomplete editions and corrupt binding summaries', async t => {
  for (const kind of ['continuation', 'reading']) {
    const f = fixture(t), source = {...book(), status: '完结'};
    f.save(source, 'original.json'); f.save(source, 'accepted.json');
    const file = path.join(f.outputDir, 'accepted.json');
    const dir = kind === 'continuation' ? path.join(f.stateDir, 'continuations', continuationKey(source)) : path.join(f.stateDir, 'jobs', 'a'.repeat(20));
    const name = kind === 'continuation' ? 'binding.json' : 'reading-edition.json';
    if (kind === 'reading') atomicWrite(path.join(dir, 'spec.json'), {...source, chapters: undefined});
    const binding = {file: 'accepted.json', outputPath: file, source: {url: source.sourceUrl}, exportHash: hash(fs.readFileSync(file))};
    atomicWrite(path.join(dir, name), {value: binding, hash: hash(binding)});
    const remote = website([source]); assert.equal((await uploadLibrary({...f, transport: remote.transport})).unchanged, 1);
    const read = fs.readFileSync; let reads = 0;
    const spy = t.mock.method(fs, 'readFileSync', (file, ...args) => { if (String(file) === path.join(dir, name) || path.dirname(String(file)) === f.outputDir) reads++; return read(file, ...args); });
    assert.equal((await uploadLibrary({...f, transport: remote.transport})).completed, 1); assert.equal(reads, 0); spy.mock.restore();
    const cache = path.join(f.stateDir, 'library-upload-cache', hash(path.resolve(f.outputDir)).slice(0, 20), 'bindings.json');
    fs.writeFileSync(cache, '{broken');
    assert.equal((await uploadLibrary({...f, transport: remote.transport})).completed, 1);
    atomicWrite(path.join(dir, name), {value: {...binding, exportHash: 'changed'}, hash: hash({...binding, exportHash: 'changed'})});
    assert.equal((await uploadLibrary({...f, transport: remote.transport})).failed, 1);
    atomicWrite(path.join(dir, name), {value: binding, hash: hash(binding)});
    atomicWrite(path.join(dir, kind === 'continuation' ? 'pending.json' : 'reading-edition-pending.json'), {unfinished: true});
    const pending = await uploadLibrary({...f, transport: remote.transport});
    assert.equal(pending.failed, 1); assert.match(pending.items[0].message, /尚未完成/);
  }
});

test('files changed or removed after planning cannot retain completed status or stop other uploads', async t => {
  const f = fixture(t), complete = {...book(1), status: '完结'}, ongoing = book(2);
  f.save(complete); f.save(ongoing); const remote = website([complete, ongoing]);
  await uploadLibrary({...f, transport: remote.transport}); let changed = false;
  const result = await uploadLibrary({...f, transport: remote.transport, onLibrary() {
    if (!changed) { changed = true; fs.unlinkSync(path.join(f.outputDir, `${complete.title}.json`)); }
  }});
  assert.equal(result.completed, 0); assert.equal(result.failed, 1); assert.equal(result.unchanged, 1);
});

test('changed local books reuse a verified directory, fill middle holes and verify only uploaded numbers', async t => {
  const f = fixture(t), initial = book(1, 1); f.save(initial);
  const remote = website([initial]); await uploadLibrary({...f, transport: remote.transport}); remote.calls.length = 0;
  f.save(book(1, 3));
  const result = await uploadLibrary({...f, transport: remote.transport});
  assert.equal(result.added, 2); assert.equal(result.metrics.reusedDirectories, 1); assert.equal(result.metrics.deltaInspections, 1);
  assert.deepEqual(remote.calls.filter(c => c.mode === 'inspect').map(c => c.numbers), [[2, 3]]);
  assert.deepEqual(remote.calls.find(c => c.mode === 'apply').batches[0].chapters.map(c => c.chapter_number), [2, 3]);
  // A remote deletion advances its token, so a formerly verified middle chapter
  // is fetched afresh and restored from the local book.
  remote.books.get(initial.sourceUrl).chapters.splice(1, 1); remote.calls.length = 0;
  const repaired = await uploadLibrary({...f, transport: remote.transport});
  assert.equal(repaired.added, 1); assert.equal(repaired.metrics.fastSkipped, 0);
  assert.deepEqual(remote.calls.find(c => c.mode === 'apply').batches[0].chapters.map(c => c.chapter_number), [2]);
});

test('remote edits, release/database changes, corrupt checkpoints, forced checks and equal-size local edits invalidate fast skips', async t => {
  const f = fixture(t), source = book(); f.save(source); const remote = website([source]);
  await uploadLibrary({...f, transport: remote.transport});
  const online = remote.books.get(source.sourceUrl); online.chapters[0].content += '改变';
  assert.equal((await uploadLibrary({...f, transport: remote.transport})).failed, 1);
  online.chapters[0].content = source.chapters[0].content;
  remote.state.scope = 'new-database';
  assert.equal((await uploadLibrary({...f, transport: remote.transport})).metrics.fullInspections, 1);
  assert.equal((await uploadLibrary({...f, transport: remote.transport, forceFull: true})).metrics.fullInspections, 1);
  const dir = path.join(f.stateDir, 'library-upload-cache', hash(path.resolve(f.outputDir)).slice(0, 20));
  fs.writeFileSync(path.join(dir, 'verified.json'), '{broken');
  assert.equal((await uploadLibrary({...f, transport: remote.transport})).metrics.fullInspections, 1);
  const indexFile = path.join(dir, 'verified.json'), record = JSON.parse(fs.readFileSync(indexFile));
  for (const value of Object.values(record.value)) value.verifiedAt -= 31 * 86400000;
  record.hash = hash(record.value); atomicWrite(indexFile, record);
  assert.equal((await uploadLibrary({...f, transport: remote.transport})).metrics.fullInspections, 1);
  const file = path.join(f.outputDir, `${source.title}.json`), old = fs.statSync(file);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('合成', '变动')); fs.utimesSync(file, old.atime, old.mtime);
  assert.equal((await uploadLibrary({...f, transport: remote.transport})).failed, 1);
  // Existing binding checks still run when file metadata comes from the index.
  f.save(source, 'duplicate.json');
  assert.match(planLibrary({...f, forUpload: true})[0].message, /多个/);
});

test('a retried or intervening write breaks the receipt chain and requires a complete final inspection', async () => {
  const job = {mode: 'apply', expectedToken: 'a', batches: [{}, {}, {}]};
  let index = 0;
  const result = await applyLibraryBatches(job, {emit() {}, async send(batch, dryRun) {
    if (dryRun) return {};
    return [{previousToken: 'a', token: 'b'}, {previousToken: 'c', token: 'd'}, {previousToken: 'd', token: 'e'}][index++];
  }});
  assert.equal(result.verifiedToken, undefined);
});

test('concurrent website edits during delta verification fall back to full comparison without caching a false success', async t => {
  const f = fixture(t), source = book(1, 1); f.save(source); const remote = website([source]);
  await uploadLibrary({...f, transport: remote.transport}); f.save(book(1, 2));
  remote.state.beforeInspect = job => { if (job.knownToken) remote.books.get(source.sourceUrl).chapters[0].content += '并发修改'; };
  const result = await uploadLibrary({...f, transport: remote.transport});
  assert.equal(result.failed, 1); assert.equal(result.uploaded, 0); assert.match(result.items[0].message, /第 1 章/);
  assert.equal((await uploadLibrary({...f, transport: remote.transport})).failed, 1);
});

test('failed cache writes degrade to full inspection and queued edits cannot pass a cached check', async t => {
  const f = fixture(t), source = book(); f.save(source); const remote = website([source]);
  const rename = fs.renameSync;
  const injected = t.mock.method(fs, 'renameSync', (from, to) => {
    if (String(to).includes('library-upload-cache')) throw Object.assign(Error('disk full'), {code: 'ENOSPC'});
    return rename(from, to);
  });
  assert.equal((await uploadLibrary({...f, transport: remote.transport})).unchanged, 1);
  assert.equal((await uploadLibrary({...f, transport: remote.transport})).metrics.fullInspections, 1);
  injected.mock.restore(); await uploadLibrary({...f, transport: remote.transport});
  const result = await uploadLibrary({...f, transport: remote.transport, onPhase() { f.save({...source, description: '排队后修改'}); }});
  assert.equal(result.failed, 1); assert.equal(result.metrics.fastSkipped, 0);
});

test('persistent SSH protocol reuses one hidden connection, isolates request errors, cancels and never exposes stderr', async () => {
  let child, spawned = 0; const received = [];
  const send = createVpsLibrarySession({spawnProcess: (command, args, options) => {
    spawned++; assert.equal(options.windowsHide, true); assert.ok(!args.join(' ').includes('danger'));
    child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.stdin.on('data', data => received.push(JSON.parse(data))); child.stdin.on('finish', () => queueMicrotask(() => child.emit('close', 0)));
    child.kill = () => queueMicrotask(() => child.emit('close', 1)); return child;
  }});
  const reply = value => child.stdout.write(JSON.stringify({protocol: 1, id: received.at(-1).id, ...value}) + '\n');
  const first = send({mode: 'headers', title: '`danger` $(secret)'}); child.stderr.write('PRIVATE');
  reply({type: 'result', result: {scope: 'a', headers: []}}); await first;
  const second = send({mode: 'inspect'}); reply({type: 'error', fatal: false, error: 'conflict'}); await assert.rejects(second, /conflict/);
  const third = send({mode: 'inspect'}); reply({type: 'result', result: {book: null, chapters: []}}); await third;
  assert.equal(spawned, 1); await send.close();
  const controller = new AbortController();
  const canceled = createVpsLibrarySession({spawnProcess: () => child});
  const pending = canceled({mode: 'inspect'}, {signal: controller.signal}); controller.abort();
  await assert.rejects(pending, error => /已停止/.test(error.message) && !error.message.includes('PRIVATE'));
});
