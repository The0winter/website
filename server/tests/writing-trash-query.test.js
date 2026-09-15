import '../../tools/test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {TestDatabase} from '../database/testing.js';
import {purgeExpiredWritingTrash} from '../services/writing-trash.js';
import {encode} from '../database/codec.js';
import {writingWorkspaceRoutes} from '../routes/writing-workspace.js';

test('idle writing trash cleanup searches expiry indexes without scanning live content', async () => {
  const fixture = await TestDatabase.create();
  try {
    await mongoose.connect(fixture.getUri());
    for (const model of Object.values(mongoose.models)) await model.createIndexes();
    const transport = mongoose.connection.transport, db = transport.database;
    const now = new Date('2026-09-15T00:00:00Z');
    const future = new Date(+now + 86400000);
    db.exec('BEGIN');
    try {
      const chapter = db.prepare('INSERT INTO chapters(id,document) VALUES(?,?)');
      const draft = db.prepare('INSERT INTO writerdrafts(id,document) VALUES(?,?)');
      for (let i = 0; i < 14000; i++) {
        const id = i.toString(16).padStart(24, '0');
        chapter.run(id, encode({_id: id, bookId: 'b'.repeat(24), chapter_number: i + 1,
          deletedAt: i === 0 ? now : null, ...(i === 0 ? {trashUntil: future} : {})}));
        if (i < 2000) draft.run(id, encode({_id: id, deleted: i === 0,
          ...(i === 0 ? {trashUntil: future} : {})}));
      }
      db.exec('COMMIT');
    } catch (error) {db.exec('ROLLBACK'); throw error;}
    const queries = [], read = transport.query.bind(transport);
    transport.query = async sql => {queries.push(sql); return read(sql);};
    assert.deepEqual(await purgeExpiredWritingTrash(now), {purgedDrafts: 0, purgedChapters: 0});
    for (const table of ['chapters', 'writerdrafts']) {
      const sql = queries.find(value => value.includes(`FROM "${table}"`));
      assert.ok(sql, `cleanup must still check ${table}`);
      const plan = db.prepare('EXPLAIN QUERY PLAN ' + sql).all().map(row => row.detail).join('\n');
      assert.match(plan, new RegExp(`SEARCH ${table} USING INDEX`), plan);
      assert.doesNotMatch(plan, new RegExp(`SCAN ${table}|USE TEMP B-TREE FOR ORDER BY`), plan);
    }
  } finally {await mongoose.disconnect(); await fixture.stop();}
});

test('writing trash waits an hour between sweeps and stopping removes the timer', async t => {
  const fixture = await TestDatabase.create();
  try {
    await mongoose.connect(fixture.getUri());
    const queries = [], transport = mongoose.connection.transport, query = transport.query.bind(transport);
    transport.query = async sql => {queries.push(sql); return query(sql);};
    t.mock.timers.enable({apis: ['setInterval']});
    const app = {locals: {writingCleanupEnabled: true}, use() {}, get() {}, post() {}, put() {}, delete() {}, patch() {}};
    writingWorkspaceRoutes(app, {authenticate() {}});
    t.mock.timers.tick(3599999);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(queries.length, 0, 'no minute-by-minute database checks');
    t.mock.timers.tick(1);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(queries.filter(sql => sql.includes('FROM "chapters"')).length, 1);
    t.mock.timers.tick(3600000);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(queries.filter(sql => sql.includes('FROM "chapters"')).length, 2);
    app.locals.stopWritingCleanup(); t.mock.timers.tick(3600000);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(queries.filter(sql => sql.includes('FROM "chapters"')).length, 2);
  } finally {await mongoose.disconnect(); await fixture.stop();}
});
