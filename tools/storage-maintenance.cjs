// Local, allowlisted retention. Business data is never a deletion category.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync, spawn} = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const DAY = 86400000;
const POLICY = Object.freeze({buildAge: 2 * DAY, keepBuilds: 2, tempAge: DAY,
  cacheAge: 7 * DAY, cacheBytes: 1024 ** 3, artifactAge: 14 * DAY,
  artifactBytes: 500 * 1024 ** 2, interval: 12 * 3600000});
const STATE = '.runtime/storage-maintenance';
const norm = value => value.replaceAll('\\', '/');
const alive = pid => { if (!Number.isInteger(pid) || pid < 1) return true; try { process.kill(pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; } };

function inside(root, relative, checkedParents) {
  if (!relative || path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some(x => !x || x === '.' || x === '..')) throw Error('Invalid relative path');
  const target = path.resolve(root, relative);
  if (!target.startsWith(root + path.sep)) throw Error('Path escapes project');
  let cursor = root;
  for (const component of relative.split('/')) {
    cursor = path.join(cursor, component);
    if (cursor !== target && checkedParents?.has(cursor)) continue;
    try {
      const stat = fs.lstatSync(cursor);
      if (stat.isSymbolicLink()) throw Error('Linked path is protected: ' + relative);
      if (stat.isDirectory()) checkedParents?.add(cursor);
    } catch (e) { if (e.code === 'ENOENT') break; throw e; }
  }
  return target;
}
function validateRoot(root) {
  root = path.resolve(root);
  if (fs.realpathSync(root).toLowerCase() !== root.toLowerCase() || !fs.existsSync(path.join(root, '.git'))) throw Error('Local Git checkout required');
  return root;
}
function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
function entries(root, relative) {
  const target = inside(root, relative);
  return fs.existsSync(target) ? fs.readdirSync(target, {withFileTypes: true}) : [];
}
function write(root, relative, value) {
  const file = inside(root, relative);
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const tmp = file + '.' + crypto.randomUUID() + '.tmp';
  try { fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n'); fs.renameSync(tmp, file); }
  finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
function lock(root, action) {
  const file = inside(root, STATE + '/maintenance.lock');
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const token = crypto.randomUUID(), deadline = Date.now() + 60000;
  for (;;) {
    try { fs.writeFileSync(file, JSON.stringify({pid: process.pid, token}), {flag: 'wx'}); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let owner;
      try { owner = read(file); }
      catch (error) {
        // Another process can release the lock, or still be publishing its
        // owner record, between our exclusive-create attempt and this read.
        if (error.code === 'ENOENT') continue;
        if (!(error instanceof SyntaxError)) throw error;
      }
      if (owner && !alive(owner.pid)) {
        try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        continue;
      }
      if (Date.now() >= deadline) throw Error('Storage maintenance is busy');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
  try { return action(); }
  finally { if (read(file).token === token) fs.unlinkSync(file); }
}

function processSnapshot() {
  if (process.platform !== 'win32') {
    return execFileSync('ps', ['-eo', 'pid=,ppid=,args='], {encoding: 'utf8', timeout: 10000}).trim().split('\n').map(line => {
      const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
      return m && {pid: +m[1], parent: +m[2], command: m[3]};
    }).filter(Boolean);
  }
  const script = 'Get-CimInstance Win32_Process | Where-Object { $_.Name -match "^(node|mongod|chrome|msedge|nginx)(.exe)?$" } | Select-Object @{n="pid";e={$_.ProcessId}},@{n="parent";e={$_.ParentProcessId}},@{n="command";e={$_.CommandLine}} | ConvertTo-Json -Compress';
  const data = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 4 * 1024 ** 2}) || '[]');
  return Array.isArray(data) ? data : [data];
}
function busyCategories(root, processes) {
  const busy = new Set(), ancestors = new Set([process.pid, process.ppid]);
  for (let i = 0; i < processes.length; i++) for (const p of processes) if (ancestors.has(p.pid)) ancestors.add(p.parent);
  for (const p of processes) {
    if (ancestors.has(p.pid)) continue;
    if (!p.command) { busy.add('all'); continue; }
    const command = norm(p.command).toLowerCase();
    if (/desktop-browser/.test(command)) continue; // UI profile is never a cleanup target.
    if (/mongod|--test|test-env\.cjs/.test(command)) { busy.add('temp'); busy.add('build'); busy.add('clean-room'); }
    if (/next[/ ]|next-server|server\/(dev|staging)\.js|clean-room\.mjs/.test(command)) { busy.add('build'); busy.add('clean-room'); }
    if (/novel-crawler/.test(command) && !/desktop\/main\.mjs/.test(command)) busy.add('crawler-cache');
    if (/npm-cli|npm (install|ci)/.test(command)) busy.add('npm-cache');
    if (/browser_data/.test(command)) busy.add('browser-cache');
    if (command.includes(norm(root).toLowerCase()) && !/desktop\/main\.mjs|desktop-browser/.test(command)) busy.add('all');
  }
  for (const e of entries(root, STATE + '/leases')) {
    if (!e.isFile() || !e.name.endsWith('.json')) { busy.add('all'); continue; }
    const lease = read(inside(root, STATE + '/leases/' + e.name));
    const categories = ['all', 'temp', 'build', 'clean-room', 'crawler-cache', 'npm-cache', 'browser-cache', 'artifacts'];
    if (!Number.isInteger(lease.pid) || lease.pid < 1 || !Array.isArray(lease.categories) || !lease.categories.length || lease.categories.some(x => !categories.includes(x))) throw Error('Invalid activity lease');
    if (alive(lease.pid)) for (const category of lease.categories) busy.add(category);
  }
  return busy;
}
function trackedFiles(root) {
  return execFileSync('git', ['-C', root, 'ls-files', '-z'], {encoding: 'utf8', maxBuffer: 16 * 1024 ** 2}).split('\0').filter(Boolean);
}
function pendingCheck(root) {
  let count = 0;
  return (force = false) => {
    if (!force && ++count % 256) return;
    for (const entry of entries(root, STATE + '/pending')) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) throw Error('Unknown pending activity');
      if (alive(read(inside(root, STATE + '/pending/' + entry.name)).pid)) throw Object.assign(Error('A new task needs these files; cleanup deferred'), {code: 'STORAGE_YIELD'});
    }
  };
}
function snapshot(root, relative, tracked = [], checkedParents, check = () => {}) {
  if (tracked.some(file => file === relative || file.startsWith(relative + '/'))) throw Error('Git tracked path');
  const target = inside(root, relative, checkedParents), hash = crypto.createHash('sha256');
  let bytes = 0, files = 0, newest = 0;
  // A .storage-keep file pins a directory and all descendants.
  for (let p = path.dirname(target); p === root || p.startsWith(root + path.sep); p = path.dirname(p)) if (fs.existsSync(path.join(p, '.storage-keep'))) throw Error('Pinned directory');
  function visit(file) {
    check();
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) throw Error('Linked child');
    newest = Math.max(newest, stat.mtimeMs);
    hash.update(norm(path.relative(target, file)) + ':' + stat.size + ':' + stat.mtimeMs + ':' + stat.ino + ';');
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(file).sort()) {
        if (name === '.storage-keep' || /^\.env(?:\.|$)/.test(name)) throw Error('Pinned or configuration file');
        visit(path.join(file, name));
      }
    } else if (stat.isFile()) { bytes += stat.size; files++; }
    else throw Error('Unexpected file type');
  }
  visit(target);
  return {path: relative, bytes, files, newest, fingerprint: hash.digest('hex')};
}

// Keep original responses cited by durable chapter/checkpoint/review metadata.
function evidenceHashes(root, check) {
  const hashes = new Set();
  function collect(value, key) {
    // Prose is not a reference field. Avoid regex-scanning gigabytes of it,
    // while retaining metadata from every durable copy, including partials.
    if (key === 'content') return;
    if (typeof value === 'string') {
      for (const match of value.matchAll(/\b[a-f0-9]{64}\b/g)) hashes.add(match[0]);
    } else if (value && typeof value === 'object') {
      for (const [name, child] of Object.entries(value)) collect(child, name);
    }
  }
  function visit(file) {
    check();
    if (!fs.existsSync(file)) return;
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) throw Error('Linked evidence path');
    if (stat.isDirectory()) for (const e of fs.readdirSync(file, {withFileTypes: true})) visit(path.join(file, e.name));
    else if (stat.isFile() && file.endsWith('.json')) collect(read(file));
  }
  for (const relative of ['.novel-crawler/sources.json', '.novel-crawler/jobs', '.novel-crawler/continuations']) visit(inside(root, relative));
  return hashes;
}
function plan(root, {now = Date.now(), initial = false, policy = POLICY, processes = processSnapshot(), tracked = trackedFiles(root)} = {}) {
  root = validateRoot(root);
  const busy = busyCategories(root, processes), candidates = [], protectedPaths = [], warnings = [], checkedParents = new Set();
  const check = pendingCheck(root); check(true);
  function inspect(relative, category) {
    if (busy.has('all') || busy.has(category)) return null;
    try { return {...snapshot(root, relative, tracked, checkedParents, check), category}; }
    catch (e) { if (e.code === 'STORAGE_YIELD') throw e; protectedPaths.push({path: relative, reason: e.message}); return null; }
  }
  function directories(parent, regex, category) {
    return entries(root, parent).filter(e => e.isDirectory() && regex.test(e.name)).map(e => inspect(parent + '/' + e.name, category)).filter(Boolean).sort((a, b) => b.newest - a.newest);
  }
  let defaultBuild = '.next-candidate';
  const config = inside(root, 'web-next/next.config.ts');
  if (fs.existsSync(config)) {
    const match = fs.readFileSync(config, 'utf8').match(/distDir:\s*process\.env\.NEXT_DIST_DIR\s*\|\|\s*['"]([^'"]+)['"]/);
    if (match) defaultBuild = match[1];
    else { busy.add('build'); warnings.push('Build output configuration is unknown; preserving all builds'); }
  }
  const activeBuilds = [defaultBuild, process.env.NEXT_DIST_DIR].filter(Boolean).map(value => norm(path.relative(root, path.resolve(root, 'web-next', value))));
  const builds = directories('web-next', /^\.next(?:-[a-z0-9-]+)?$/, 'build').filter(x => !activeBuilds.some(active => active === x.path || active.startsWith(x.path + '/')));
  for (const item of builds.slice(initial ? 0 : policy.keepBuilds)) if (now - item.newest > policy.buildAge) candidates.push(item);
  let cleanKeep;
  const cleanReport = inside(root, 'artifacts/clean-room-report.json');
  if (fs.existsSync(cleanReport)) {
    try {
      cleanKeep = norm(path.relative(root, path.resolve(read(cleanReport).destination)));
      if (!/^\.runtime\/clean-room-\d+$/.test(cleanKeep) || !fs.existsSync(inside(root, cleanKeep))) throw Error('Unknown isolated environment');
    }
    catch { warnings.push('Unreadable clean-room report: preserving all isolated environments'); cleanKeep = '*'; }
  }
  const cleanRooms = directories('.runtime', /^clean-room-\d+$/, 'clean-room');
  // Never infer that an absent report authorizes deleting the last environment.
  cleanKeep ||= cleanRooms[0]?.path;
  let keptFailure = false;
  for (const item of cleanRooms) {
    if (cleanKeep === '*' || item.path === cleanKeep) continue;
    const marker = inside(root, item.path + '/.storage-result.json');
    let finished;
    try {
      if (fs.existsSync(marker)) {
        finished = read(marker);
        if (typeof finished.success !== 'boolean' || !Number.isFinite(Date.parse(finished.completedAt))) continue;
      }
    } catch { continue; }
    if (finished?.success === false && !keptFailure && now - item.newest < policy.cacheAge) { keptFailure = true; continue; }
    if (now - item.newest > (finished ? policy.tempAge : policy.cacheAge)) candidates.push(item);
  }
  for (const item of directories('.runtime/test-tmp', /^(?:test1-(?:mongo|sqlite)|mongo-mem|novel-browser)-[A-Za-z0-9]+$/, 'temp')) if (now - item.newest > policy.tempAge) candidates.push(item);
  for (const [relative, category] of [['.runtime/npm-cache', 'npm-cache'], ['browser_data/Default/Cache', 'browser-cache']]) {
    if (!fs.existsSync(inside(root, relative))) continue;
    const item = inspect(relative, category);
    if (item && (initial || now - item.newest > policy.cacheAge || item.bytes > policy.cacheBytes)) candidates.push(item);
  }
  if (!busy.has('all') && !busy.has('crawler-cache')) {
    try {
      const pins = evidenceHashes(root, check), groups = [];
      for (const e of entries(root, '.novel-crawler/cache')) {
        check();
        if (!e.isFile() || !/^[a-f0-9]{64}\.json$/.test(e.name)) continue;
        const relative = '.novel-crawler/cache/' + e.name, meta = read(inside(root, relative, checkedParents));
        const body = relative.replace(/\.json$/, '.bin');
        if (!/^[a-f0-9]{64}$/.test(meta.hash) || !Number.isFinite(Date.parse(meta.fetchedAt)) || !fs.existsSync(inside(root, body, checkedParents))) continue;
        const pair = [inspect(relative, 'crawler-cache'), inspect(body, 'crawler-cache')];
        if (pair.some(x => !x)) continue;
        groups.push({pair, pinned: pins.has(meta.hash), newest: Math.max(...pair.map(x => x.newest)), bytes: pair.reduce((n, x) => n + x.bytes, 0)});
      }
      let total = groups.reduce((n, x) => n + x.bytes, 0);
      for (const group of groups.sort((a, b) => a.newest - b.newest)) {
        if (group.pinned || now - group.newest < policy.tempAge) continue;
        if (now - group.newest > policy.cacheAge || total > policy.cacheBytes) { candidates.push(...group.pair.slice().reverse()); total -= group.bytes; }
      }
      if (total > policy.cacheBytes) warnings.push('Crawler cache exceeds 1 GiB: referenced evidence and files newer than 24 hours are protected');
    } catch (e) { if (e.code === 'STORAGE_YIELD') throw e; warnings.push('Crawler cache preserved: ' + e.message); }
  }
  // Existing artifacts mix useful source material with generated output. Only
  // plainly named debug screenshots/logs qualify; final evidence stays pinned.
  const artifacts = [];
  function scanArtifacts(parent) {
    check(true);
    for (const e of entries(root, parent)) {
      const relative = parent + '/' + e.name;
      if (e.isSymbolicLink() || /(?:^|[-_/])(final|public|live|verified|accepted|cover|source|original)(?:[-_.\/]|$)/i.test(relative)) continue;
      if (e.isDirectory()) scanArtifacts(relative);
      else if (/\.(?:png|log)$/.test(e.name) && /(?:initial|baseline|debug|pending|loading|before|after|strip-\d)/i.test(relative)) {
        const item = inspect(relative, 'artifacts'); if (item) artifacts.push(item);
      }
    }
  }
  for (const relative of ['artifacts', 'web-next/artifacts', '.runtime/task-artifacts']) scanArtifacts(relative);
  let artifactBytes = artifacts.reduce((n, x) => n + x.bytes, 0);
  for (const item of artifacts.sort((a, b) => a.newest - b.newest)) if (now - item.newest > policy.artifactAge || (artifactBytes > policy.artifactBytes && now - item.newest > policy.tempAge)) { candidates.push(item); artifactBytes -= item.bytes; }
  check(true);
  return {root, createdAt: new Date(now).toISOString(), initial, candidates, bytes: candidates.reduce((n, x) => n + x.bytes, 0), busy: [...busy], protectedPaths, warnings};
}

function execute(root, proposed, options = {}) {
  // Rebuild the allowlist from current state; never trust a saved path list.
  const current = proposed.candidates.length ? plan(root, {...options, initial: proposed.initial}) : proposed;
  const allowed = new Map(current.candidates.map(x => [x.path, x]));
  const result = {startedAt: new Date().toISOString(), deleted: [], skipped: [], warnings: current.warnings, busy: current.busy};
  const tracked = options.tracked || trackedFiles(root);
  const indexStamp = () => {
    const file = path.join(root, '.git/index');
    if (!fs.existsSync(file)) return '';
    const s = fs.statSync(file); return [s.ino, s.size, s.mtimeMs, s.ctimeMs].join(':');
  };
  const index = indexStamp(), failedCacheBodies = new Set(), check = pendingCheck(root);
  for (const item of proposed.candidates) {
    try {
      check(true);
      if (indexStamp() !== index) throw Error('Git index changed during cleanup');
      if (item.category === 'crawler-cache' && item.path.endsWith('.json') && failedCacheBodies.has(item.path.replace(/\.json$/, '.bin'))) throw Error('Cache body could not be removed; retaining its metadata');
      const fresh = allowed.get(item.path);
      if (!fresh || fresh.fingerprint !== item.fingerprint) throw Error('Candidate changed or is now protected');
      if (snapshot(root, item.path, tracked, undefined, check).fingerprint !== item.fingerprint) throw Error('Candidate changed during cleanup');
      fs.rmSync(inside(root, item.path), {recursive: true, force: false, maxRetries: 2, retryDelay: 100});
      result.deleted.push({path: item.path, bytes: item.bytes, files: item.files});
    } catch (e) {
      if (item.category === 'crawler-cache' && item.path.endsWith('.bin')) failedCacheBodies.add(item.path);
      result.skipped.push({path: item.path, reason: e.message});
      if (e.code === 'STORAGE_YIELD') { result.deferred = proposed.candidates.length - result.deleted.length - result.skipped.length; break; }
    }
  }
  result.finishedAt = new Date().toISOString();
  result.bytes = result.deleted.reduce((n, x) => n + x.bytes, 0);
  return result;
}
function maintain({root = ROOT, apply = false, initial = false, ...options} = {}) {
  root = validateRoot(root);
  return lock(root, () => {
    const proposed = plan(root, {...options, initial});
    if (!apply) return proposed;
    const result = execute(root, proposed, options);
    for (const folder of ['leases', 'pending']) for (const entry of entries(root, STATE + '/' + folder)) {
      if (!entry.isFile() || !/^[a-f0-9-]+\.json$/.test(entry.name)) continue;
      const file = inside(root, STATE + '/' + folder + '/' + entry.name);
      if (!alive(read(file).pid)) fs.unlinkSync(file);
    }
    write(root, STATE + '/last-run.json', result);
    if (!result.busy.length && !result.skipped.length) write(root, STATE + '/last-auto.json', {finishedAt: result.finishedAt});
    return result;
  });
}
function automatic() {
  if (process.env.LOCAL_STORAGE_MAINTENANCE === 'off' || process.env.CI || !fs.existsSync(path.join(ROOT, '.git'))) return;
  try {
    const last = inside(ROOT, STATE + '/last-auto.json');
    if (fs.existsSync(last) && Date.now() - Date.parse(read(last).finishedAt) < POLICY.interval) return;
    const result = maintain({apply: true});
    // Busy categories must get another chance at the next quiet entry point.
    if (!result.busy.length && !result.skipped.length) write(ROOT, STATE + '/last-auto.json', {finishedAt: result.finishedAt});
    if (result.bytes) console.error('[storage] Reclaimed ' + (result.bytes / 1024 ** 3).toFixed(2) + ' GiB');
  } catch (e) { console.error('[storage] Cleanup deferred: ' + e.message); }
}
function queueAutomatic() {
  if (process.env.LOCAL_STORAGE_MAINTENANCE === 'off' || process.env.CI || !fs.existsSync(path.join(ROOT, '.git'))) return false;
  try {
    const last = inside(ROOT, STATE + '/last-auto.json'), mutex = inside(ROOT, STATE + '/maintenance.lock');
    if (fs.existsSync(last) && Date.now() - Date.parse(read(last).finishedAt) < POLICY.interval) return false;
    if (fs.existsSync(mutex) && alive(read(mutex).pid)) return false;
    const child = spawn(process.execPath, [__filename, '--auto'], {cwd: ROOT, env: process.env, windowsHide: true, detached: true, stdio: 'ignore'});
    child.once('error', error => console.error('[storage] Background cleanup deferred: ' + error.message));
    child.unref(); return true;
  } catch (e) { console.error('[storage] Background cleanup deferred: ' + e.message); return false; }
}
function activity(categories, {sweep = false} = {}) {
  if (process.env.LOCAL_STORAGE_MAINTENANCE === 'off' || process.env.CI || !fs.existsSync(path.join(ROOT, '.git'))) return () => {};
  const relative = STATE + '/leases/' + crypto.randomUUID() + '.json';
  const pending = STATE + '/pending/' + crypto.randomUUID() + '.json';
  write(ROOT, pending, {pid: process.pid});
  try { lock(ROOT, () => write(ROOT, relative, {pid: process.pid, categories, startedAt: new Date().toISOString()})); }
  finally { fs.unlinkSync(inside(ROOT, pending)); }
  if (sweep) queueAutomatic();
  let released = false;
  const release = () => {
    if (released) return; released = true;
    process.removeListener('exit', release);
    try { fs.unlinkSync(inside(ROOT, relative)); } catch (e) { if (e.code !== 'ENOENT') console.error('[storage] Lease retained: ' + e.code); }
  };
  process.once('exit', release);
  return release;
}

function cacheActivity(cacheDir) {
  return path.resolve(cacheDir) === path.join(ROOT, '.novel-crawler/cache') ? activity(['crawler-cache']) : () => {};
}
module.exports = {POLICY, inside, snapshot, plan, execute, maintain, automatic, queueAutomatic, activity, cacheActivity};
if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.some(x => !['--apply', '--initial', '--auto'].includes(x))) throw Error('Usage: node tools/storage-maintenance.cjs [--apply] [--initial] [--auto]');
    if (args.includes('--auto')) automatic();
    else console.log(JSON.stringify(maintain({apply: args.includes('--apply'), initial: args.includes('--initial')}), null, 2));
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
