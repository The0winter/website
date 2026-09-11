import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

const run = promisify(execFile);

export async function openLocal(target) {
  target = path.resolve(target);
  if (!fs.statSync(target).isDirectory()) throw Error('要打开的目录不存在');
  try {
    if (process.platform === 'win32') {
      const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
      const helper = fileURLToPath(new URL('./open-directory.ps1', import.meta.url));
      const {stdout} = await run(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper], {
        windowsHide: true, timeout: 15000, maxBuffer: 65536, encoding: 'utf8',
        env: {...process.env, NOVEL_CRAWLER_OPEN_TARGET: target},
      });
      const result = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
      if (!result.verified || !result.visible || result.minimized || typeof result.path !== 'string' || path.resolve(result.path).toLowerCase() !== target.toLowerCase()) throw Error('目录窗口未显示');
      return result;
    } else {
      await run(process.platform === 'darwin' ? 'open' : 'xdg-open', [target], {timeout: 10000, maxBuffer: 65536});
      return {verified: false};
    }
  } catch (error) {
    throw new Error(`未能显示目录窗口，请重试或手动打开：${target}`, {cause: error});
  }
}
