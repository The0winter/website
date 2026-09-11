import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const run = promisify(execFile);

export async function openLocal(target) {
  target = path.resolve(target);
  if (!fs.statSync(target).isDirectory()) throw Error('要打开的目录不存在');
  try {
    if (process.platform === 'win32') {
      const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
      // Shell-open the directory in a visible Explorer window. Keep only the
      // helper console hidden; pass the path as data, never as PowerShell code.
      await run(powershell, ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference = 'Stop'; Start-Process -FilePath $env:NOVEL_CRAWLER_OPEN_TARGET -WindowStyle Normal"], {
        windowsHide: true, timeout: 10000, maxBuffer: 65536,
        env: {...process.env, NOVEL_CRAWLER_OPEN_TARGET: target},
      });
    } else {
      await run(process.platform === 'darwin' ? 'open' : 'xdg-open', [target], {timeout: 10000, maxBuffer: 65536});
    }
  } catch (error) {
    throw new Error(`无法打开目录，请手动打开：${target}`, {cause: error});
  }
}
