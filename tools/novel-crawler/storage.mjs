import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';

export const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export const readJson = (file, fallback = undefined) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
export function atomicWrite(file, data, {mode} = {}) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const temporary = `${file}.${randomUUID()}.tmp`;
  const bytes = typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data, null, 2) + '\n';
  try {
    fs.writeFileSync(temporary, bytes, {flag: 'wx', ...(mode === undefined ? {} : {mode})});
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

// Serialize writers; an abandoned lock is recoverable after its process exits.
export function acquireLock(file) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const token = randomUUID();
  for (let attempt = 0; ; attempt++) {
    try {
      fs.writeFileSync(file, JSON.stringify({pid: process.pid, token}), {flag: 'wx'});
      break;
    } catch (error) {
      if (error.code !== 'EEXIST' || attempt > 0) throw error;
      const previous = readJson(file);
      try { process.kill(previous.pid, 0); }
      catch (e) {
        if (e.code === 'ESRCH') { fs.unlinkSync(file); continue; }
      }
      throw Object.assign(Error(`另一个采集进程仍在运行（PID ${previous.pid}）：${file}`), {code: 'RESOURCE_BUSY'});
    }
  }
  return () => { if (readJson(file)?.token === token) fs.unlinkSync(file); };
}

export async function withLock(file, action) {
  const release = acquireLock(file);
  try { return await action(); }
  finally { release(); }
}

export const safeName = value => String(value).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 70) || 'book';
