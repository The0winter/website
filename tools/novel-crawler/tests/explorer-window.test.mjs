import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {openLocal} from '../desktop/open-local.mjs';

const run = promisify(execFile);
const windowsEnabled = process.platform === 'win32' && process.env.NOVEL_CRAWLER_TEST_EXPLORER === '1';

test('Windows folder opens visibly from a hidden helper, reuses, restores, and reopens its actual Explorer window', {skip: !windowsEnabled}, async () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "shiye-explorer-test-中文 空格 &'$()-"));
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const fixture = fileURLToPath(new URL('./explorer-fixture.ps1', import.meta.url));
  async function inspect(action = 'inspect') {
    const {stdout} = await run(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fixture], {
      windowsHide: true, timeout: 10000, encoding: 'utf8',
      env: {...process.env, NOVEL_CRAWLER_OPEN_TARGET: target, NOVEL_CRAWLER_TEST_ACTION: action},
    });
    return JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
  }
  async function checkOpen() {
    const result = await openLocal(target);
    assert.equal(result.verified, true);
    // Inspect in an independent process after the launcher has exited.
    const windows = await inspect();
    assert.equal(windows.length, 1, 'clicks must not accumulate duplicate windows');
    assert.equal(windows[0].path, target);
    assert.equal(windows[0].visible, true);
    assert.equal(windows[0].minimized, false);
    return windows[0].windowId;
  }
  try {
    assert.deepEqual(await inspect(), []);
    const first = await checkOpen();
    assert.equal(await checkOpen(), first);
    assert.equal((await inspect('hide'))[0].visible, false);
    assert.equal(await checkOpen(), first);
    assert.equal((await inspect('minimize'))[0].minimized, true);
    assert.equal(await checkOpen(), first);
    await inspect('close');
    for (let i = 0; (await inspect()).length && i < 5; i++) await new Promise(resolve => setTimeout(resolve, 100));
    assert.deepEqual(await inspect(), []);
    await checkOpen();
  } finally {
    await inspect('close');
    assert.ok(path.resolve(target).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(target).startsWith('shiye-explorer-test-'));
    fs.rmSync(target, {recursive: true, force: true});
  }
});
