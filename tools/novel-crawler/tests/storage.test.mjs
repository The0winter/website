import '../../test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {atomicWrite, readJson} from '../storage.mjs';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-storage-'));
  t.after(() => { assert.equal(path.dirname(dir), os.tmpdir()); fs.rmSync(dir, {recursive: true, force: true}); });
  const file = path.join(dir, 'state.json');
  atomicWrite(file, {version: 1});
  return {dir, file};
}

test('atomic replacement retries sharing violations and retains the original until replacement succeeds', t => {
  const {dir, file} = fixture(t), rename = fs.renameSync;
  const errors = ['EPERM', 'EACCES', 'EBUSY'];
  let attempts = 0;
  t.mock.method(fs, 'renameSync', (from, to) => {
    assert.equal(to, file);
    assert.deepEqual(readJson(file), {version: 1});
    if (attempts < errors.length) throw Object.assign(Error('sharing violation'), {code: errors[attempts++]});
    return rename(from, to);
  });
  atomicWrite(file, {version: 2});
  assert.equal(attempts, 3);
  assert.deepEqual(readJson(file), {version: 2});
  assert.deepEqual(fs.readdirSync(dir), ['state.json']);
});

test('persistent replacement errors have bounded retries, preserve the original and clean temporary files', t => {
  const {dir, file} = fixture(t);
  const failure = Object.assign(Error('file locked'), {code: 'EPERM'});
  let attempts = 0;
  t.mock.method(fs, 'renameSync', () => { attempts++; throw failure; });
  assert.throws(() => atomicWrite(file, {version: 2}), error => error === failure);
  assert.equal(attempts, 6);
  assert.deepEqual(readJson(file), {version: 1});
  assert.deepEqual(fs.readdirSync(dir), ['state.json']);
});

test('non-sharing errors fail immediately without losing the original or masking the cause with cleanup errors', t => {
  const {dir, file} = fixture(t), unlink = fs.unlinkSync;
  const failure = Object.assign(Error('disk I/O failure'), {code: 'EIO'});
  let attempts = 0;
  t.mock.method(fs, 'renameSync', () => { attempts++; throw failure; });
  const cleanup = t.mock.method(fs, 'unlinkSync', temporary => {
    unlink(temporary);
    throw Object.assign(Error('cleanup error'), {code: 'EACCES'});
  });
  assert.throws(() => atomicWrite(file, {version: 2}), error => error === failure);
  cleanup.mock.restore();
  assert.equal(attempts, 1);
  assert.deepEqual(readJson(file), {version: 1});
  assert.deepEqual(fs.readdirSync(dir), ['state.json']);
});

test('real Windows reader denying delete sharing can release during an atomic write retry', {skip: process.platform !== 'win32', timeout: 10000}, async t => {
  const {file} = fixture(t);
  // The child holds a normal read handle but excludes FileShare.Delete, just
  // like a reader that can cause Windows rename EPERM. It never edits data.
  const script = `$stream = [IO.File]::Open($env:NOVEL_TEST_LOCK_FILE, 'Open', 'Read', 'ReadWrite'); try { [Console]::WriteLine('locked'); [Console]::Out.Flush(); Start-Sleep -Milliseconds 180 } finally { $stream.Dispose() }`;
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: {...process.env, NOVEL_TEST_LOCK_FILE: file}
  });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const exited = once(child, 'exit');
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  await Promise.race([
    once(child.stdout, 'data').then(([chunk]) => assert.match(chunk.toString(), /locked/)),
    exited.then(() => assert.fail(`Lock holder exited before acquiring the lock: ${stderr}`))
  ]);
  const rename = fs.renameSync;
  let sharingErrors = 0;
  t.mock.method(fs, 'renameSync', (from, to) => {
    try { return rename(from, to); }
    catch (error) { if (['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) sharingErrors++; throw error; }
  });
  atomicWrite(file, {version: 2});
  assert.ok(sharingErrors > 0, 'the test must encounter a real Windows sharing violation');
  assert.deepEqual(readJson(file), {version: 2});
  assert.equal((await exited)[0], 0, stderr);
});
