import '../../tools/test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import {TestDatabase} from '../database/testing.js';
import {createApp} from '../app.js';
import {readConfig} from '../config.js';
import Book from '../models/Book.js';
import Chapter from '../models/Chapter.js';

test('native visitor persists anonymous preferences and views but never grants account/CSRF privileges', async () => {
  const db = await TestDatabase.create();
  const config = readConfig({APP_ENV: 'test', DATABASE_URL: db.getUri(), JWT_SECRET: crypto.randomBytes(48).toString('hex')});
  await mongoose.connect(config.uri, {autoIndex: false});
  for (const model of Object.values(mongoose.models)) await model.createIndexes();
  const server = createApp(config).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = async (path, method = 'GET', body, token, extras = {}) => {
    const response = await fetch(base + path, {method, headers: {'content-type': 'application/json',
      ...(token ? {'x-native-visitor': token} : {}), ...extras}, body: body ? JSON.stringify(body) : undefined});
    return {status: response.status, body: await response.json()};
  };
  try {
    const issued = await send('/api/v1/visitor', 'POST', {});
    assert.equal(issued.status, 200);
    assert.ok(issued.body.visitorToken); assert.ok(issued.body.expiresAt);
    const token = issued.body.visitorToken;
    assert.equal((await send('/api/v1/visitor', 'POST', {}, null, {origin: 'https://evil.test'})).status, 403);
    assert.equal((await send('/api/v1/visitor', 'POST', {}, null, {'sec-fetch-site': 'same-origin'})).status, 403);
    assert.equal((await send('/api/v1/visitor', 'POST', {}, null, {cookie: 'session=invalid'})).status, 403);
    assert.equal((await send('/api/v1/visitor', 'POST', {}, null, {'content-type': 'text/plain'})).status, 415);
    assert.equal((await send('/api/forum/preferences', 'PATCH', {enabled: false}, token)).status, 200);
    assert.equal((await send('/api/forum/preferences', 'GET', null, token)).body.enabled, false);
    const other = (await send('/api/v1/visitor', 'POST', {})).body.visitorToken;
    assert.equal((await send('/api/forum/preferences', 'GET', null, other)).body.enabled, true);
    assert.equal((await send('/api/forum/preferences', 'PATCH', {enabled: false})).status, 403);
    assert.equal((await send('/api/forum/preferences', 'PATCH', {enabled: true}, token, {origin: 'http://127.0.0.1:3000'})).status, 403);
    assert.equal((await send('/api/admin/users', 'GET', null, token)).status, 401);
    assert.equal((await send('/api/v1/auth/me', 'GET', null, token)).status, 401);
    assert.equal((await send('/api/auth/signin', 'POST', {email: 'no@example.test', password: 'irrelevant'}, token)).status, 403);
    assert.equal((await send('/api/books', 'POST', {title: 'unauthorized'}, token)).status, 403);
    const book = await Book.create({title: '匿名阅读测试'});
    const chapter = await Chapter.create({bookId: book._id, title: '第一章', chapter_number: 1, content: '测试正文'});
    const url = `/api/books/${book._id}/views`, body = {chapterId: String(chapter._id)};
    assert.equal((await send(url, 'POST', body, token)).body.counted, true);
    assert.equal((await send(url, 'POST', body, token)).body.counted, false);
    assert.equal((await send(url, 'POST', body, other)).body.counted, true);
    assert.equal((await send('/api/forum/preferences', 'GET', null, token + 'x')).body.code, 'VISITOR_INVALID');
    const expired = jwt.sign({sub: crypto.randomBytes(32).toString('hex'), typ: 'native_visitor', exp: 1}, config.jwtSecret,
      {algorithm: 'HS256', issuer: 'jiutian-native', audience: 'jiutian-native-visitor'});
    assert.equal((await send('/api/forum/preferences', 'GET', null, expired)).body.code, 'VISITOR_EXPIRED');
  } finally {
    await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); await db.stop();
  }
});
