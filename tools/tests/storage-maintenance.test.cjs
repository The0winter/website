require('../test-env.cjs');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const test = require('node:test');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {once} = require('node:events');
const {POLICY, inside, plan, execute, maintain} = require('../storage-maintenance.cjs');
const now = Date.now(), old = now - 30 * 86400000;
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-retention-'));
  fs.mkdirSync(path.join(root, '.git'));
  t.after(() => { assert.equal(path.dirname(fs.realpathSync(root)), fs.realpathSync(os.tmpdir())); fs.rmSync(root, {recursive: true, force: true}); });
  function put(relative, content = 'cached output', time = old) {
    const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, content);
    for (let p = file; p.startsWith(root + path.sep); p = path.dirname(p)) fs.utimesSync(p, time / 1000, time / 1000);
    return file;
  }
  const options = {now, processes: [], tracked: []};
  return {root, put, options, plan: extra => plan(root, {...options, ...extra})};
}
test('preview keeps current/recent builds, tracked material, pins and every business directory', t => {
  const f = fixture(t);
  for (const name of ['candidate', 'one', 'two', 'three']) f.put('web-next/.next-' + name + '/cache/out');
  for (const relative of ['downloads/book.json', 'Cover/book.png', 'backups/book.json', '.novel-crawler/jobs/job/chapters/chapter.json']) f.put(relative, '{}');
  f.put('web-next/.next-pinned/.storage-keep');
  f.put('web-next/.next-source/code.js');
  const p = f.plan({tracked: ['web-next/.next-source/code.js']});
  assert.equal(p.candidates.filter(x => x.category === 'build' && !x.path.endsWith('/cache')).length, 1);
  assert.ok(!p.candidates.some(x => /pinned|source/.test(x.path) || x.path === 'web-next/.next-candidate'));
  assert.ok(fs.existsSync(path.join(f.root, p.candidates[0].path)));
});
test('initial cleanup still respects age, current build, pins and configuration files', t => {
  const f = fixture(t);
  f.put('web-next/.next-old/cache/out');
  f.put('web-next/.next-new/cache/out', 'new', now);
  f.put('web-next/.next-candidate/cache/out');
  f.put('web-next/.next-candidate/server/route.js', 'compiled');
  f.put('web-next/.next-secret/.env');
  const p = f.plan({initial: true});
  assert.deepEqual(p.candidates.map(x => x.path), ['web-next/.next-old', 'web-next/.next-candidate/cache']);
  const r = execute(f.root, p, f.options);
  assert.equal(r.deleted.length, 2);
  assert.ok(fs.existsSync(path.join(f.root, 'web-next/.next-candidate/server/route.js')));
});
test('configured build paths are protected; unknown configuration disables build collection', t => {
  const f = fixture(t);
  f.put('web-next/.next-custom/cache/out');
  f.put('web-next/next.config.ts', "const config = {distDir: process.env.NEXT_DIST_DIR || '.next-custom/subdirectory'};");
  assert.equal(f.plan({initial: true}).candidates.length, 0);
  f.put('web-next/next.config.ts', 'const config = customConfig();');
  const p = f.plan({initial: true});
  assert.equal(p.candidates.length, 0); assert.ok(p.warnings.length);
});
test('isolated environment report pins its exact destination; missing or damaged reports fail safely', t => {
  const f = fixture(t);
  for (const id of ['100', '200']) f.put('.runtime/clean-room-' + id + '/node_modules/out');
  assert.equal(f.plan().candidates.length, 1);
  f.put('artifacts/clean-room-report.json', JSON.stringify({destination: path.join(f.root, '.runtime/clean-room-100')}));
  assert.deepEqual(f.plan().candidates.map(x => x.path), ['.runtime/clean-room-200']);
  f.put('artifacts/clean-room-report.json', 'broken');
  assert.equal(f.plan().candidates.length, 0);
  assert.ok(f.plan().warnings.length);
  f.put('artifacts/clean-room-report.json', JSON.stringify({destination: path.join(f.root, '.runtime/clean-room-999')}));
  assert.equal(f.plan().candidates.length, 0);
});
test('only recognized expired test data is deleted, with live lease and process protection', t => {
  const f = fixture(t);
  f.put('.runtime/test-tmp/test1-mongo-abcdef/journal/out');
  f.put('.runtime/test-tmp/my-backup/content');
  f.put('.runtime/test-tmp/test1-sqlite-recent/test.sqlite', 'db', now);
  assert.deepEqual(f.plan().candidates.map(x => x.path), ['.runtime/test-tmp/test1-mongo-abcdef']);
  f.put('.runtime/storage-maintenance/leases/live.json', JSON.stringify({pid: process.pid, categories: ['temp']}));
  assert.equal(f.plan().candidates.length, 0);
  fs.unlinkSync(path.join(f.root, '.runtime/storage-maintenance/leases/live.json'));
  assert.equal(f.plan({processes: [{pid: 999999, parent: 0, command: 'mongod --dbpath temp'}]}).candidates.length, 0);
});
test('changed candidates and injected business paths are rejected at execution', t => {
  const f = fixture(t);
  f.put('web-next/.next-old/cache/out'); f.put('downloads/precious.json');
  const p = f.plan({initial: true});
  f.put('web-next/.next-old/cache/new', 'new', now);
  p.candidates.push({path: 'downloads', bytes: 100, fingerprint: 'forged'});
  const result = execute(f.root, p, f.options);
  assert.equal(result.deleted.length, 0); assert.equal(result.skipped.length, 2);
  assert.ok(fs.existsSync(path.join(f.root, 'downloads/precious.json')));
});
test('a candidate that becomes tracked between preview and execution is protected', t => {
  const f = fixture(t); f.put('web-next/.next-old/a.js');
  const p = f.plan({initial: true});
  const r = execute(f.root, p, {...f.options, tracked: ['web-next/.next-old/a.js']});
  assert.equal(r.deleted.length, 0); assert.equal(r.skipped.length, 1);
});
test('links, traversal and ancestor pins never authorize deletion', t => {
  const f = fixture(t); const outside = f.put('downloads/precious.json');
  fs.mkdirSync(path.join(f.root, 'web-next'));
  fs.symlinkSync(path.dirname(outside), path.join(f.root, 'web-next/.next-linked'), 'junction');
  assert.equal(f.plan({initial: true}).candidates.length, 0);
  assert.throws(() => inside(f.root, '../downloads'));
  f.put('web-next/.next-old/cache/out'); f.put('web-next/.storage-keep');
  assert.equal(f.plan({initial: true}).candidates.length, 0);
});
function cache(f, letter, hash, time = old) {
  const key = letter.repeat(64), prefix = '.novel-crawler/cache/' + key;
  f.put(prefix + '.bin', 'original html', time);
  f.put(prefix + '.json', JSON.stringify({hash, fetchedAt: new Date(time).toISOString()}), time);
  return prefix;
}
test('cache eviction removes body/metadata pairs but retains cited evidence and recent downloads', t => {
  const f = fixture(t), hash = 'f'.repeat(64);
  const retained = cache(f, 'a', hash), removed = cache(f, 'b', 'e'.repeat(64)); cache(f, 'c', 'd'.repeat(64), now);
  f.put('.novel-crawler/jobs/job/chapters/one.json', JSON.stringify({chapter: {provenance: [{hash}]}}));
  const p = f.plan({policy: {...POLICY, cacheBytes: 1}});
  assert.deepEqual(p.candidates.map(x => x.path).sort(), [removed + '.bin', removed + '.json'].sort());
  const r = execute(f.root, p, {...f.options, policy: {...POLICY, cacheBytes: 1}});
  assert.equal(r.deleted.length, 2);
  assert.ok(fs.existsSync(path.join(f.root, retained + '.bin')));
});
test('broken evidence metadata preserves the entire cache', t => {
  const f = fixture(t); cache(f, 'a', 'f'.repeat(64));
  f.put('.novel-crawler/jobs/job/spec.json', 'broken');
  const p = f.plan(); assert.equal(p.candidates.length, 0); assert.ok(p.warnings.length);
});
test('a provenance reference found only in a partial export still pins the original response', t => {
  const f = fixture(t), hash = 'f'.repeat(64);
  cache(f, 'a', hash);
  f.put('.novel-crawler/jobs/job/partial.json', JSON.stringify({chapters: [{content: 'prose', provenance: [{hash}]}]}));
  assert.equal(f.plan().candidates.length, 0);
});
test('debug artifacts expire without touching final screenshots, scripts or tracked assets', t => {
  const f = fixture(t);
  for (const relative of ['artifacts/reader-initial.png', 'artifacts/reader-final-initial.png', 'artifacts/cover-debug.png', 'artifacts/debug-tool.cjs', 'artifacts/site-before.png']) f.put(relative);
  const p = f.plan({tracked: ['artifacts/site-before.png']});
  assert.deepEqual(p.candidates.map(x => x.path), ['artifacts/reader-initial.png']);
});
test('failed process inspection or unreadable live lease fails closed', t => {
  const f = fixture(t); f.put('web-next/.next-old/cache/out');
  assert.equal(f.plan({initial: true, processes: [{pid: 999999, command: null}]}).candidates.length, 0);
  f.put('.runtime/storage-maintenance/leases/broken.json', 'broken');
  assert.throws(() => f.plan({initial: true}));
  f.put('.runtime/storage-maintenance/leases/broken.json', JSON.stringify({pid: process.pid, categories: []}));
  assert.throws(() => f.plan({initial: true}));
});
test('maintenance produces an auditable result and never follows a linked state directory', t => {
  const f = fixture(t); f.put('web-next/.next-old/cache/out');
  const r = maintain({root: f.root, ...f.options, apply: true, initial: true});
  assert.equal(r.deleted.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, '.runtime/storage-maintenance/last-run.json'))).bytes, r.bytes);
  assert.ok(!fs.existsSync(path.join(f.root, '.runtime/storage-maintenance/maintenance.lock')));
  const other = fixture(t);
  fs.mkdirSync(path.join(other.root, '.runtime'));
  fs.symlinkSync(path.join(f.root, '.runtime/storage-maintenance'), path.join(other.root, '.runtime/storage-maintenance'), 'junction');
  assert.throws(() => maintain({root: other.root, ...other.options, apply: true}));
});
test('activity and cache-client leases protect their category until released', t => {
  const f = fixture(t);
  f.put('tools/storage-maintenance.cjs', fs.readFileSync(require.resolve('../storage-maintenance.cjs')));
  const local = require(path.join(f.root, 'tools/storage-maintenance.cjs'));
  const release = local.activity(['temp']);
  f.put('.runtime/test-tmp/test1-mongo-old/journal/out');
  assert.equal(f.plan().candidates.length, 0);
  release(); release();
  assert.equal(f.plan().candidates.length, 1);
  cache(f, 'a', 'f'.repeat(64));
  const close = local.cacheActivity(path.join(f.root, '.novel-crawler/cache'));
  assert.ok(!f.plan().candidates.some(x => x.category === 'crawler-cache'));
  close();
  assert.equal(f.plan().candidates.filter(x => x.category === 'crawler-cache').length, 2);
  assert.equal(fs.readdirSync(path.join(f.root, '.runtime/storage-maintenance/pending')).length, 0);
  f.put('.runtime/storage-maintenance/last-auto.json', JSON.stringify({finishedAt: new Date().toISOString()}));
  assert.equal(local.queueAutomatic(), false, 'the cooldown prevents another background helper');
});
test('pending foreground activity interrupts maintenance without deleting candidates', t => {
  const f = fixture(t); f.put('web-next/.next-old/cache/out');
  const proposed = f.plan({initial: true});
  f.put('.runtime/storage-maintenance/pending/new-task.json', JSON.stringify({pid: process.pid}));
  assert.throws(() => execute(f.root, proposed, f.options), {code: 'STORAGE_YIELD'});
  assert.ok(fs.existsSync(path.join(f.root, 'web-next/.next-old/cache/out')));
});

test('activity waits while another process publishes and releases its maintenance lock', async t => {
  const f = fixture(t);
  f.put('tools/storage-maintenance.cjs', fs.readFileSync(require.resolve('../storage-maintenance.cjs')));
  const mutex = f.put('.runtime/storage-maintenance/maintenance.lock', '');
  const child = spawn(process.execPath, ['-e', `
    const fs = require('node:fs'), file = process.argv[1];
    process.send('publishing');
    setTimeout(() => {
      fs.writeFileSync(file, JSON.stringify({pid: process.pid, token: 'owner'}));
      setTimeout(() => { fs.unlinkSync(file); process.disconnect(); }, 100);
    }, 200);
  `, mutex], {windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc']});
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const closed = once(child, 'close');
  await once(child, 'message');
  const local = require(path.join(f.root, 'tools/storage-maintenance.cjs'));
  const release = local.activity(['temp']);
  assert.equal(fs.readdirSync(path.join(f.root, '.runtime/storage-maintenance/leases')).length, 1);
  release();
  assert.equal((await closed)[0], 0);
  assert.ok(!fs.existsSync(mutex));
});

test('known crawler workers protect acquisition without blocking rebuildable developer caches', t => {
  const f = fixture(t);
  f.put('web-next/.next-candidate/dev/cache/entry');
  const p = f.plan({processes: [{pid: 999999, command: `node ${f.root}/tools/novel-crawler/desktop/worker.mjs`} ]});
  assert.ok(p.busy.includes('crawler-cache'));
  assert.ok(!p.busy.includes('all'));
  assert.ok(p.candidates.some(x => x.path.endsWith('/dev/cache')));
  assert.equal(p.blockers[0].pid, 999999);
});

test('Codex workspace hosts do not block cleanup, but their unknown project children do', t => {
  const f = fixture(t); f.put('web-next/.next-candidate/dev/cache/entry');
  const host = {pid: 999998, command: `C:/Users/test/AppData/Local/OpenAI/Codex/runtimes/cua_node/v/bin/node.exe C:/Temp/.tmp123/kernel.js --working-dir ${f.root}`};
  assert.ok(f.plan({processes: [host]}).candidates.length);
  const child = {pid: 999999, parent: host.pid, command: `node ${f.root}/unknown-job.cjs`};
  assert.equal(f.plan({processes: [host, child]}).candidates.length, 0);
});

test('temporary Chromium profiles are protected by their exact live paths', t => {
  const f = fixture(t), a = '.runtime/test-tmp/playwright_chromiumdev_profile-aaa', b = '.runtime/test-tmp/playwright_chromiumdev_profile-bbb';
  f.put(a + '/Default/cache'); f.put(b + '/Default/cache');
  const p = f.plan({processes: [{pid: 999999, command: `chrome.exe --user-data-dir="${f.root}/${a}"`} ]});
  assert.deepEqual(p.candidates.map(x => x.path), [b]);
  assert.ok(p.protectedPaths.some(x => x.path === a));
});

test('default build cache budget never removes the compiled output and live Next protects both', t => {
  const f = fixture(t);
  f.put('web-next/.next-candidate/dev/cache/entry', 'large enough cache', now);
  f.put('web-next/.next-candidate/server/route.js', 'compiled', now);
  const options = {policy: {...POLICY, buildCacheBytes: 1}};
  assert.deepEqual(f.plan(options).candidates.map(x => x.path), ['web-next/.next-candidate/dev/cache']);
  assert.equal(f.plan({...options, processes: [{pid: 999999, command: `node ${f.root}/web-next/node_modules/next/dist/bin/next dev`}]}).candidates.length, 0);
  assert.ok(fs.existsSync(path.join(f.root, 'web-next/.next-candidate/server/route.js')));
});

test('maintenance records bounded diagnostic history with blocker reasons', t => {
  const f = fixture(t);
  const history = Array.from({length: 150}, () => ({at: new Date().toISOString()}));
  f.put('.runtime/storage-maintenance/history.json', JSON.stringify(history));
  maintain({root: f.root, ...f.options, apply: true, processes: [{pid: 999999, command: `node ${f.root}/unknown-job.cjs`} ]});
  const saved = JSON.parse(fs.readFileSync(path.join(f.root, '.runtime/storage-maintenance/history.json')));
  assert.equal(saved.length, 120); assert.equal(saved.at(-1).blockers[0].reason, 'Unknown project runtime');
});
test('Windows empty calculated command objects are ignored only for non-runtime processes', t => {
  const f = fixture(t); f.put('web-next/.next-candidate/cache/out');
  assert.ok(f.plan({processes: [{pid: 999999, name: 'svchost.exe', command: {}}]}).candidates.length);
  assert.equal(f.plan({processes: [{pid: 999999, name: 'node.exe', command: {}}]}).candidates.length, 0);
});
