import '../../tools/test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import {TestDatabase} from '../database/testing.js';
import {createApp} from '../app.js';
import {readConfig} from '../config.js';
import User from '../models/User.js';
import Book from '../models/Book.js';
import Bookmark from '../models/Bookmark.js';
import {legacyShelfChange} from '../services/shelf-state.js';

test('shelf revisions prevent offline resurrection, preserve old clients and make mutations replayable', async () => {
  const db = await TestDatabase.create();
  const config = readConfig({APP_ENV: 'test', DATABASE_URL: db.getUri(), JWT_SECRET: crypto.randomBytes(48).toString('hex')});
  await mongoose.connect(config.uri, {autoIndex: false});
  for (const model of Object.values(mongoose.models)) await model.createIndexes();
  const server = createApp(config).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let token;
  const request = async (path, method = 'GET', body) => {
    const response = await fetch(base + path, {method, headers: {'content-type': 'application/json', ...(token ? {authorization: `Bearer ${token}`} : {})},
      body: body ? JSON.stringify(body) : undefined});
    return {status: response.status, body: await response.json()};
  };
  try {
    const user = await User.create({username: 'shelf-cas', email: 'shelf-cas@example.test', password: await bcrypt.hash('test-password-123', 10)});
    const book = await Book.create({title: '书架冲突测试'});
    const url = `/api/v1/me/bookshelf/${book._id}`;
    assert.equal((await request(url)).status, 401);
    token = (await request('/api/v1/auth/login', 'POST', {email: user.email, password: 'test-password-123'})).body.accessToken;
    assert.deepEqual((await request(url)).body, {revision: 0, added: false, deviceId: null, updatedAt: null});
    const operation = (revision, added) => ({baseRevision: revision, added, operationId: crypto.randomUUID(), deviceId: 'test-android-device'});
    const add = operation(0, true), first = await request(url, 'PUT', add);
    assert.equal(first.status, 200); assert.equal(first.body.revision, 1);
    assert.deepEqual(await request(url, 'PUT', add), first);
    assert.equal((await request(url, 'PUT', {...add, added: false})).body.code, 'OPERATION_REUSED');
    const stale = await request(url, 'PUT', operation(0, false));
    assert.equal(stale.status, 409); assert.equal(stale.body.current.added, true);
    assert.equal((await request(url, 'PUT', operation(1, false))).body.revision, 2);
    assert.equal(await Bookmark.countDocuments({user_id: user._id}), 0);
    assert.equal((await request(url, 'PUT', operation(1, true))).body.code, 'SHELF_CONFLICT');
    assert.equal(await Bookmark.countDocuments({user_id: user._id}), 0, 'old offline addition cannot resurrect a removed book');
    await legacyShelfChange(user._id, book._id, true);
    assert.equal((await request(url)).body.revision, 3);
    const list = await request(`/api/users/${user._id}/library?tab=shelf`);
    assert.equal(list.body[0].shelfRevision, 3); assert.equal(list.body[0].shelfAdded, true);
    await legacyShelfChange(user._id, book._id, false);
    assert.equal((await request(url)).body.revision, 4);
    assert.equal((await request(url, 'PUT', operation(3, true))).status, 409);
    assert.equal((await request(url, 'PUT', operation(4, true))).status, 200, 'explicit re-add based on current revision is allowed');
    await Book.updateOne({_id: book._id}, {$set: {deletedAt: new Date()}});
    assert.equal((await request(url, 'PUT', operation(5, false))).status, 200, 'unavailable entries can be removed');
    assert.equal((await request(url, 'PUT', operation(6, true))).status, 404);
    assert.equal((await request(url.replace(String(book._id), 'invalid'))).status, 400);
    const legacyBook = await Book.create({title: 'Existing bookmark'});
    await Bookmark.create({user_id: user._id, bookId: legacyBook._id});
    assert.deepEqual((await request(`/api/v1/me/bookshelf/${legacyBook._id}`)).body,
      {revision: 0, added: true, deviceId: null, updatedAt: null}, 'preexisting bookmarks are not mistaken for absent entries');
  } finally {
    await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); await db.stop();
  }
});
