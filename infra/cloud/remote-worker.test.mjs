import '../../tools/test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {queueJob, runNext, listJobs, classify, resumeJob, workerLock} from './remote-worker.mjs';
import {resticEnvironment, backupWorker} from './backup-worker.mjs';

const spec = base => ({version: 1, kind: 'html', title: '云端恢复测试', author: '测试作者', sourceUrl: base + '/book',
  delayMs: 200, retries: 0, metadata: {title: 'h1', author: '#author'}, catalog: {links: '#catalog a'}, chapter: {title: 'h1', content: '#content'}});
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'test1-remote-worker-'));
  t.after(() => {
    const absolute = fs.realpathSync(root);
    assert.equal(path.dirname(absolute), fs.realpathSync(os.tmpdir()));
    assert.match(path.basename(absolute), /^test1-remote-worker-/);
    fs.rmSync(absolute, {recursive: true, force: true});
  });
  return root;
}
test('real crawler resumes one-chapter batches without refetching accepted chapters', async t => {
  const root = fixture(t), calls = new Map();
  const server = http.createServer((req, res) => {
    calls.set(req.url, (calls.get(req.url) || 0) + 1); res.setHeader('content-type', 'text/html; charset=utf-8');
    if (req.url === '/book') return res.end('<h1>云端恢复测试</h1><p id="author">测试作者</p><div id="catalog"><a href="/1">第1章 山村</a><a href="/2">第2章 海岸</a></div>');
    if (req.url === '/1') return res.end('<h1>第1章 山村</h1><div id="content">' + '山间的晨雾渐渐散去，小路通往村口，院中的人准备出发。'.repeat(35) + '</div>');
    if (req.url === '/2') return res.end('<h1>第2章 海岸</h1><div id="content">' + '海岸远处有一座灯塔，船员们把绳索收好，等待晴朗天气到来。'.repeat(35) + '</div>');
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const queued = queueJob(root, spec(`http://127.0.0.1:${server.address().port}`), {mode: 'download', batchSize: 1});
  const first = await runNext(root); assert.equal(first.state, 'queued'); assert.equal(first.report.downloaded, 1);
  assert.equal((await runNext(root, {enforceBackup: true})).reason, 'checkpoint_needs_backup');
  const second = await runNext(root); assert.equal(second.state, 'complete'); assert.equal(second.report.downloaded, 2);
  assert.equal(calls.get('/1'), 1); assert.equal(calls.get('/2'), 1);
  assert.equal(listJobs(root)[0].id, queued.id);
  assert.equal((await runNext(root)).idle, true);
});
test('bad content and interrupted runs cannot be reported as success', () => {
  assert.equal(classify({structuralPass: false, downloaded: 1, missing: [{}], failures: [], issues: [{level: 'error', code: 'garbled'}]}, 'download'), 'needs_attention');
  assert.equal(classify({structuralPass: true, completeAgainstSource: false, paused: true, downloaded: 1, missing: [{}]}, 'download'), 'needs_attention');
});
test('single writer lock protects a job and crashes are bounded', async t => {
  const root = fixture(t), job = queueJob(root, spec('https://example.com'));
  let release;
  const pending = runNext(root, {collect: () => new Promise(resolve => { release = resolve; })});
  await assert.rejects(runNext(root), /already running/);
  await assert.rejects(backupWorker({root, force: true}), /already running/);
  assert.throws(() => queueJob(root, spec('https://example.org')), /already running/);
  assert.throws(() => resumeJob(root, job.id), /already running/);
  release({structuralPass: true, issues: []}); await pending;
  const unlock = workerLock(root);
  await assert.rejects(runNext(root), /already running/);
  unlock();
  await assert.rejects(backupWorker({root, force: true, env: {}}), /Private R2/);
  assert.equal(fs.existsSync(path.join(root, 'worker.lock')), false);
  const file = path.join(root, 'queue', job.id + '.json'), saved = JSON.parse(fs.readFileSync(file));
  fs.writeFileSync(file, JSON.stringify({...saved, state: 'running', crashes: 2}));
  assert.equal((await runNext(root)).state, 'needs_attention');
});
test('queue rejects duplicates and browser requirements', t => {
  const root = fixture(t), input = spec('https://example.com');
  queueJob(root, input); assert.throws(() => queueJob(root, input), /already exists/);
  assert.throws(() => queueJob(root, {...input, transport: 'browser'}), /Browser sources/);
});
test('backup child receives only R2 credentials and rejects public cover bucket', () => {
  const env = {R2_ENDPOINT: 'https://' + 'a'.repeat(32) + '.r2.cloudflarestorage.com', R2_BUCKET: 'private', COVER_R2_BUCKET: 'covers', R2_ACCESS_KEY_ID: 'key', R2_SECRET_ACCESS_KEY: 'secret', DATABASE_URL: 'do-not-forward'};
  const child = resticEnvironment(env); assert.equal(child.DATABASE_URL, undefined);
  assert.match(child.RESTIC_REPOSITORY, /private\/backups\/codex-hybrid\/restic$/);
  assert.throws(() => resticEnvironment({...env, R2_BUCKET: 'covers'}), /Private R2/);
});
