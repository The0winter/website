import fs from 'node:fs';
import path from 'node:path';
import {atomicWrite, hash, readJson} from '../storage.mjs';

const version = 2;
// Force an occasional fresh directory check even after out-of-band maintenance.
const maxAge = 30 * 86400000;
export function fileFingerprint(file) {
  const stat = fs.lstatSync(file, {bigint: true});
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error('下载文件必须是书库中的普通文件');
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
}
function read(file) {
  try {
    const record = readJson(file);
    return record?.version === version && record.hash === hash(record.value) ? record.value : undefined;
  } catch { return undefined; }
}
function write(file, value) {
  try { atomicWrite(file, {version, value, hash: hash(value)}); return true; }
  catch { return false; } // A locked/missing cache must never block an upload.
}
const cacheDir = (stateDir, outputDir) => path.join(stateDir, 'library-upload-cache', hash(path.resolve(outputDir)).slice(0, 20));

export function localUploadIndex({stateDir, outputDir, forceFull = false}) {
  const file = path.join(cacheDir(stateDir, outputDir), 'local-index.json');
  const previous = forceFull ? {} : read(file) || {}, next = Object.create(null);
  return {
    get(name, inspect) {
      const full = path.join(outputDir, name), fingerprint = fileFingerprint(full);
      let entry = Object.hasOwn(previous, name) ? previous[name] : null;
      if (entry?.fingerprint !== fingerprint) {
        const item = inspect();
        if (fileFingerprint(full) !== fingerprint) throw Error('核对期间下载文件被修改，请重新检查');
        entry = {fingerprint, item};
      }
      next[name] = entry;
      return entry.item ? {...entry.item, fingerprint} : null;
    },
    flush() { write(file, next); }
  };
}

export function uploadCheckpoints({stateDir, outputDir, forceFull = false}) {
  const dir = cacheDir(stateDir, outputDir), index = path.join(dir, 'verified.json');
  const records = read(index) || {};
  const keyFor = item => hash(item.file);
  return {
    get(item, header) {
      const key = keyFor(item), record = records[key];
      if (forceFull || !record || !header?.token || !header.scope || record.token !== header.token || record.scope !== header.scope ||
          !Number.isFinite(record.verifiedAt) || Date.now() - record.verifiedAt > maxAge || record.verifiedAt > Date.now()) return null;
      return record;
    },
    remote(item, record) {
      const snapshot = read(path.join(dir, keyFor(item) + '.json'));
      return snapshot && hash(snapshot) === record.manifestHash && snapshot.token === record.token && snapshot.scope === record.scope ? snapshot : null;
    },
    save(item, remote, verifiedAt = Date.now()) {
      if (!remote.token || !remote.scope || remote.partial) return;
      const key = keyFor(item);
      if (!write(path.join(dir, key + '.json'), remote)) return;
      records[key] = {fileHash: item.hash, token: remote.token, scope: remote.scope, bookId: remote.bookId,
        verifiedAt, manifestHash: hash(remote)};
      write(index, records);
    }
  };
}
