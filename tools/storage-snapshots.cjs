// Immutable, compressed recovery objects. No business files are removed here.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {gzipSync, gunzipSync} = require('node:zlib');
const BASE = '.runtime/storage-snapshots';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const norm = value => value.replaceAll('\\', '/');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const retention = () => require('./storage-maintenance.cjs');
function file(root, relative) { return retention().inside(root, relative); }
function atomic(root, relative, data) {
  const target = file(root, relative); fs.mkdirSync(path.dirname(target), {recursive: true});
  const temp = target + '.' + crypto.randomUUID() + '.tmp';
  try { fs.writeFileSync(temp, data, {flag: 'wx'}); fs.renameSync(temp, target); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
function locked(root, action) {
  const target = file(root, BASE + '/store.lock'); fs.mkdirSync(path.dirname(target), {recursive: true});
  try { fs.writeFileSync(target, JSON.stringify({pid: process.pid}), {flag: 'wx'}); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const owner = read(target); if (!Number.isInteger(owner.pid) || owner.pid < 1) throw Error('Invalid snapshot lock');
    try { process.kill(owner.pid, 0); throw Error('Snapshot store is busy'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
    fs.unlinkSync(target); fs.writeFileSync(target, JSON.stringify({pid: process.pid}), {flag: 'wx'});
  }
  try { return action(); } finally { fs.unlinkSync(target); }
}
function objectPath(hash) {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw Error('Invalid content hash');
  return BASE + '/objects/' + hash.slice(0, 2) + '/' + hash + '.gz';
}
function body(root, entry) {
  if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > 512 * 1024 ** 2) throw Error('Invalid snapshot object size');
  const bytes = gunzipSync(fs.readFileSync(file(root, objectPath(entry.hash))), {maxOutputLength: Math.max(1, entry.bytes)});
  if (bytes.length !== entry.bytes || sha(bytes) !== entry.hash) throw Error('Snapshot object failed verification: ' + entry.hash);
  return bytes;
}
function manifest(root, id) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw Error('Invalid snapshot ID');
  const record = read(file(root, BASE + '/manifests/' + id + '.json'));
  if (record.hash !== sha(JSON.stringify(record.value)) || record.value.version !== 1 || record.value.id !== id || !Array.isArray(record.value.files)) throw Error('Snapshot manifest failed verification');
  const paths = new Set();
  for (const entry of record.value.files) {
    file(root, entry.path);
    if (paths.has(entry.path) || entry.path.startsWith(BASE + '/')) throw Error('Invalid snapshot file path');
    paths.add(entry.path);
  }
  return record.value;
}
function save(root, value) { atomic(root, BASE + '/manifests/' + value.id + '.json', JSON.stringify({value, hash: sha(JSON.stringify(value))}, null, 2) + '\n'); }
function list(root) {
  const dir = file(root, BASE + '/manifests');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => /^[a-f0-9-]{36}\.json$/.test(n)).map(n => manifest(root, n.slice(0, -5))) : [];
}
function verify(root, id) {
  const value = manifest(root, id), verified = new Set();
  for (const entry of value.files) if (!verified.has(entry.hash)) { body(root, entry); verified.add(entry.hash); }
  return {id, files: value.files.length, bytes: value.files.reduce((n, f) => n + f.bytes, 0), verifiedAt: new Date().toISOString()};
}
function create(root, {files, group, pinned = false, sourceRoot}) {
  root = path.resolve(root);
  if (!/^[a-zA-Z0-9-]{1,120}$/.test(group) || !files?.length) throw Error('Snapshot group and files required');
  return locked(root, () => {
    const records = [], stamps = new Map();
    let storedBytes = 0;
    for (const relative of [...new Set(files)].sort()) {
      if (relative.startsWith(BASE + '/')) throw Error('Cannot snapshot the snapshot store');
      const target = file(root, relative), before = fs.lstatSync(target);
      if (!before.isFile() || before.isSymbolicLink()) throw Error('Snapshot input must be an ordinary file');
      const bytes = fs.readFileSync(target), after = fs.lstatSync(target);
      const stamp = s => [s.ino, s.size, s.mtimeMs, s.ctimeMs].join(':');
      if (stamp(before) !== stamp(after)) throw Error('Snapshot input changed: ' + relative);
      stamps.set(relative, stamp(after));
      const entry = {path: relative, hash: sha(bytes), bytes: bytes.length, mtime: after.mtime.toISOString()};
      const object = file(root, objectPath(entry.hash));
      if (fs.existsSync(object)) body(root, entry);
      else { const compressed = gzipSync(bytes); atomic(root, objectPath(entry.hash), compressed); body(root, entry); storedBytes += compressed.length; }
      records.push(entry);
    }
    for (const [relative, previous] of stamps) {
      const s = fs.lstatSync(file(root, relative));
      if ([s.ino, s.size, s.mtimeMs, s.ctimeMs].join(':') !== previous) throw Error('Snapshot inputs changed during capture');
    }
    const signature = sha(JSON.stringify(records.map(({path, hash}) => ({path, hash}))));
    const previous = list(root).find(m => m.group === group && m.signature === signature && !!m.pinned === pinned);
    if (previous) return {...verify(root, previous.id), reused: true, storedBytes};
    const value = {version: 1, id: crypto.randomUUID(), group, createdAt: new Date().toISOString(), status: 'pending', pinned, sourceRoot, signature, files: records};
    save(root, value);
    return {...verify(root, value.id), reused: false, storedBytes};
  });
}
function accept(root, id) {
  return locked(root, () => { verify(root, id); const value = manifest(root, id); value.status = 'accepted'; value.acceptedAt ||= new Date().toISOString(); save(root, value); return {id, accepted: true}; });
}
function restore(root, id, destination) {
  return locked(root, () => restoreUnlocked(root, id, destination));
}
function restoreUnlocked(root, id, destination) {
  verify(root, id); // Complete verification before writing any output.
  if (!/^\.runtime\/test-tmp\/restored-[a-zA-Z0-9-]+$/.test(destination)) throw Error('Restore into a new .runtime/test-tmp/restored-* directory');
  const target = file(root, destination);
  if (fs.existsSync(target)) throw Error('Restore destination already exists');
  fs.mkdirSync(target, {recursive: true});
  for (const entry of manifest(root, id).files) {
    const restored = file(root, destination + '/' + entry.path);
    fs.mkdirSync(path.dirname(restored), {recursive: true}); fs.writeFileSync(restored, body(root, entry), {flag: 'wx'});
  }
  return {id, destination: target};
}
function archive(root, relative) {
  // Explicit command only. Not a heuristic based on the age of unknown data.
  if (!/^\.runtime\/(?:task-artifacts\/)?[a-zA-Z0-9-]+\/(?:backup|before)$/.test(relative)) throw Error('Only an explicitly selected task backup/before directory can be archived');
  const tracked = retention().trackedFiles(root), before = retention().snapshot(root, relative, tracked), files = [];
  function walk(rel) { for (const e of fs.readdirSync(file(root, rel), {withFileTypes: true})) { const child = rel + '/' + e.name; if (e.isDirectory()) walk(child); else if (e.isFile()) files.push(child); else throw Error('Unexpected backup entry'); } }
  walk(relative);
  const result = create(root, {files, group: 'archive-' + sha(relative).slice(0, 24), pinned: true, sourceRoot: relative});
  if (retention().snapshot(root, relative, tracked).fingerprint !== before.fingerprint) throw Error('Original backup changed during archive');
  accept(root, result.id);
  atomic(root, BASE + '/archives/' + result.id + '.json', JSON.stringify({path: relative, fingerprint: before.fingerprint, snapshotId: result.id, verifiedAt: result.verifiedAt}, null, 2) + '\n');
  return {...result, originalBytes: before.bytes, source: relative};
}
function archivedCandidates(root, warnings) {
  const dir = file(root, BASE + '/archives'), results = [];
  if (!fs.existsSync(dir)) return results;
  for (const name of fs.readdirSync(dir)) {
    try {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) throw Error('Unknown archive registry entry');
      const record = read(file(root, BASE + '/archives/' + name));
      if (!/^\.runtime\/(?:task-artifacts\/)?[a-zA-Z0-9-]+\/(?:backup|before)$/.test(record.path)) throw Error('Invalid archive source');
      if (!fs.existsSync(file(root, record.path))) continue;
      const saved = manifest(root, record.snapshotId);
      if (!saved.pinned || saved.status !== 'accepted' || saved.sourceRoot !== record.path) throw Error('Backup archive is not accepted');
      verify(root, record.snapshotId); results.push(record);
    } catch (error) { warnings.push('Archive preserved: ' + error.message); }
  }
  return results;
}
function prune(root, {apply = false, now = Date.now()} = {}) {
  if (!fs.existsSync(file(root, BASE))) return {bytes: 0, candidates: []};
  return locked(root, () => {
    const manifests = file(root, BASE + '/manifests');
    if (fs.existsSync(manifests) && fs.readdirSync(manifests, {withFileTypes: true}).some(e => !e.isFile() || !/^[a-f0-9-]{36}\.json$/.test(e.name))) throw Error('Unknown snapshot manifest entry; preserving recovery store');
    const all = list(root), groups = new Map(), removed = new Set(), candidates = [];
    for (const value of all) { const group = groups.get(value.group) || []; group.push(value); groups.set(value.group, group); }
    for (const group of groups.values()) {
      const accepted = group.filter(x => x.status === 'accepted' && !x.pinned).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      for (const value of accepted.slice(2)) if (now - Date.parse(value.createdAt) > 7 * 86400000) removed.add(value.id);
    }
    const tracked = retention().trackedFiles(root);
    // Do not prune a manifest whose directory/pin/Git guard protects it.
    for (const id of [...removed]) {
      try { candidates.push(retention().snapshot(root, BASE + '/manifests/' + id + '.json', tracked)); }
      catch { removed.delete(id); }
    }
    const referenced = new Set(all.filter(x => !removed.has(x.id)).flatMap(x => x.files.map(f => f.hash)));
    for (const hash of new Set(all.filter(x => removed.has(x.id)).flatMap(x => x.files.map(f => f.hash)))) {
      if (referenced.has(hash)) continue;
      try { candidates.push(retention().snapshot(root, objectPath(hash), tracked)); } catch { /* Pin/config/tracked protection. */ }
    }
    // Interrupted captures may leave fully written objects without a manifest.
    // While holding the writer lock, collect only known old object filenames.
    const objects = file(root, BASE + '/objects'), selected = new Set(candidates.map(x => x.path));
    if (fs.existsSync(objects)) for (const prefix of fs.readdirSync(objects, {withFileTypes: true})) {
      if (!prefix.isDirectory() || !/^[a-f0-9]{2}$/.test(prefix.name)) continue;
      const dir = file(root, BASE + '/objects/' + prefix.name);
      for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        if (!entry.isFile() || !/^[a-f0-9]{64}\.gz$/.test(entry.name)) continue;
        const hash = entry.name.slice(0, -3), relative = objectPath(hash);
        if (hash.slice(0, 2) !== prefix.name || referenced.has(hash) || selected.has(relative)) continue;
        try { const item = retention().snapshot(root, relative, tracked); if (now - item.newest > 7 * 86400000) candidates.push(item); } catch { /* Preserve unknown/pinned content. */ }
      }
    }
    if (!candidates.length) return {bytes: 0, candidates: [], applied: apply};
    // Corrupt retained snapshots must never lead to deleting possible recovery data.
    for (const value of all.filter(x => !removed.has(x.id))) verify(root, value.id);
    if (apply) for (const entry of candidates) {
      if (retention().snapshot(root, entry.path, tracked).fingerprint !== entry.fingerprint) throw Error('Snapshot retention candidate changed');
      fs.unlinkSync(file(root, entry.path));
    }
    return {bytes: candidates.reduce((n, x) => n + x.bytes, 0), candidates: candidates.map(x => x.path), applied: apply};
  });
}
// Capture only the selected book and its recovery metadata; unchanged objects
// and unchanged snapshots are reused across runs. Fixtures/custom roots opt out.
function beforeBook({stateDir, outputDir, item, job, key}) {
  const root = path.resolve(__dirname, '..');
  if (path.resolve(stateDir) !== path.join(root, '.novel-crawler') || path.resolve(outputDir) !== path.join(root, 'downloads')) return null;
  const files = ['downloads/' + item.file];
  if (fs.existsSync(file(root, '.novel-crawler/sources.json'))) files.push('.novel-crawler/sources.json');
  for (const name of ['spec.json', 'export.json', 'reading-edition.json', 'reading-edition-pending.json']) {
    const rel = '.novel-crawler/jobs/' + job + '/' + name; if (fs.existsSync(file(root, rel))) files.push(rel);
  }
  const continuation = '.novel-crawler/continuations/' + key;
  function walk(rel) { if (!fs.existsSync(file(root, rel))) return; for (const e of fs.readdirSync(file(root, rel), {withFileTypes: true})) { const child = rel + '/' + e.name; if (e.isSymbolicLink()) throw Error('Linked continuation metadata cannot be snapshotted'); if (e.isDirectory()) walk(child); else if (e.isFile() && e.name.endsWith('.json')) files.push(child); } }
  walk(continuation);
  return {root, ...create(root, {files, group: 'book-' + key})};
}
module.exports = {BASE, create, verify, restore, accept, archive, archivedCandidates, beforeBook, list, prune};
if (require.main === module) {
  const root = path.resolve(__dirname, '..'), [command, ...args] = process.argv.slice(2);
  try {
    let result;
    if (command === 'archive' && args.length === 1) result = archive(root, norm(args[0]));
    else if (command === 'verify' && args.length === 1) result = verify(root, args[0]);
    else if (command === 'restore' && args.length === 2) result = restore(root, args[0], norm(args[1]));
    else if (command === 'list' && !args.length) result = list(root).map(({id, group, status, createdAt, pinned}) => ({id, group, status, createdAt, pinned}));
    else throw Error('Usage: storage:snapshot archive <task-backup> | verify <id> | restore <id> <.runtime/test-tmp/restored-name> | list');
    console.log(JSON.stringify(result, null, 2));
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
