require('../test-env.cjs');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const test = require('node:test'), assert = require('node:assert/strict');
const store = require('../storage-snapshots.cjs');
const retention = require('../storage-maintenance.cjs');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-snapshots-'));
  execFileSync('git', ['init', '-q', root], {windowsHide: true});
  t.after(() => { assert.equal(path.dirname(fs.realpathSync(root)), fs.realpathSync(os.tmpdir())); fs.rmSync(root, {recursive: true, force: true}); });
  const put = (relative, data) => { const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, data); return file; };
  return {root, put};
}
test('shared contents are stored once and a complete restoration has identical bytes', t => {
  const f = fixture(t), data = Buffer.from('同一本小说\n'.repeat(1000));
  f.put('downloads/a.json', data); f.put('downloads/b.json', data);
  const a = store.create(f.root, {files: ['downloads/a.json'], group: 'first'});
  const b = store.create(f.root, {files: ['downloads/a.json', 'downloads/b.json'], group: 'second'});
  assert.equal(b.storedBytes, 0); assert.ok(a.storedBytes < data.length);
  assert.equal(store.create(f.root, {files: ['downloads/a.json'], group: 'first'}).id, a.id);
  const result = store.restore(f.root, b.id, '.runtime/test-tmp/restored-check');
  assert.deepEqual(fs.readFileSync(path.join(result.destination, 'downloads/b.json')), data);
  assert.throws(() => store.restore(f.root, b.id, '.runtime/test-tmp/restored-check'), /already exists/);
  assert.throws(() => store.restore(f.root, b.id, '../outside'), /Restore into/);
});
test('original backups become candidates only after complete verified archival', t => {
  const f = fixture(t), relative = '.runtime/task-artifacts/completed-task/backup';
  f.put(relative + '/downloads/book.json', '{"book":"original"}');
  assert.ok(!retention.plan(f.root, {processes: [], tracked: []}).candidates.length);
  const result = store.archive(f.root, relative);
  const p = retention.plan(f.root, {processes: [], tracked: []});
  assert.equal(p.candidates[0].category, 'archived-backup');
  const r = retention.execute(f.root, p, {processes: [], tracked: []});
  assert.equal(r.deleted.length, 1); assert.ok(!fs.existsSync(path.join(f.root, relative)));
  const restored = store.restore(f.root, result.id, '.runtime/test-tmp/restored-backup');
  assert.equal(fs.readFileSync(path.join(restored.destination, relative, 'downloads/book.json'), 'utf8'), '{"book":"original"}');
});
test('changed backups, corrupt objects, pins and linked inputs never authorize original deletion', t => {
  const f = fixture(t), relative = '.runtime/task-artifacts/completed-task/backup';
  const original = f.put(relative + '/book.json', 'original');
  const result = store.archive(f.root, relative);
  const p = retention.plan(f.root, {processes: [], tracked: []});
  fs.writeFileSync(original, 'modified');
  assert.equal(retention.execute(f.root, p, {processes: [], tracked: []}).deleted.length, 0);
  const manifest = JSON.parse(fs.readFileSync(path.join(f.root, store.BASE, 'manifests', result.id + '.json'))).value;
  const hash = manifest.files[0].hash;
  f.put(store.BASE + '/objects/' + hash.slice(0, 2) + '/' + hash + '.gz', 'corrupt');
  const plan = retention.plan(f.root, {processes: [], tracked: []});
  assert.equal(plan.candidates.length, 0); assert.ok(plan.warnings.length);
  assert.throws(() => store.restore(f.root, result.id, '.runtime/test-tmp/restored-corrupt'));
  assert.ok(!fs.existsSync(path.join(f.root, '.runtime/test-tmp/restored-corrupt')));
  f.put(relative + '/.storage-keep', 'keep'); assert.throws(() => store.archive(f.root, relative));
  fs.symlinkSync(path.join(f.root, 'downloads'), f.put('link-placeholder', '' ) + '-link', 'junction');
  assert.throws(() => store.create(f.root, {files: ['link-placeholder-link/a'], group: 'linked'}));
});
test('snapshot retention keeps two accepted versions, pending failures and pinned archives', t => {
  const f = fixture(t), ids = [];
  for (let i = 0; i < 4; i++) {
    f.put('downloads/book.json', 'version ' + i);
    const created = store.create(f.root, {files: ['downloads/book.json'], group: 'book-a'});
    store.accept(f.root, created.id); ids.push(created.id);
    const file = path.join(f.root, store.BASE, 'manifests', created.id + '.json'), record = JSON.parse(fs.readFileSync(file));
    record.value.createdAt = new Date(Date.now() - (14-i) * 86400000).toISOString();
    record.hash = crypto.createHash('sha256').update(JSON.stringify(record.value)).digest('hex'); fs.writeFileSync(file, JSON.stringify(record));
  }
  f.put('downloads/book.json', 'failed run');
  const pending = store.create(f.root, {files: ['downloads/book.json'], group: 'book-a'});
  f.put('.runtime/task-artifacts/old/backup/book.json', 'pinned');
  const pinned = store.archive(f.root, '.runtime/task-artifacts/old/backup');
  const result = store.prune(f.root, {apply: true});
  assert.ok(result.bytes > 0);
  assert.deepEqual(store.list(f.root).map(x => x.id).sort(), [...ids.slice(2), pending.id, pinned.id].sort());
  for (const id of ids.slice(2)) store.verify(f.root, id);
});
test('interrupted capture objects have a grace period and unknown manifests stop collection', t => {
  const f = fixture(t), hash = 'a'.repeat(64), relative = store.BASE + '/objects/aa/' + hash + '.gz';
  const orphan = f.put(relative, 'unreferenced object');
  assert.equal(store.prune(f.root).bytes, 0);
  const old = (Date.now() - 8 * 86400000) / 1000; fs.utimesSync(orphan, old, old);
  assert.equal(store.prune(f.root).candidates.length, 1);
  f.put(store.BASE + '/manifests/unknown.json', '{}');
  assert.throws(() => store.prune(f.root, {apply: true}), /Unknown snapshot/);
  assert.ok(fs.existsSync(orphan));
});
