// Explicit integration check: a loopback disposable database and uniquely named R2 objects.
// Run from the repository root. No production database is opened or modified.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import {MongoMemoryReplSet} from 'mongodb-memory-server';
import {DeleteObjectCommand} from '@aws-sdk/client-s3';
import {createApp} from '../app.js';
import {readConfig} from '../config.js';
import {r2Client} from '../services/r2.js';
import {createWritingStorage} from '../services/writing-storage.js';
import {cleanupDraftObjects} from '../services/writing-drafts.js';
import User from '../models/User.js';
import Manuscript from '../models/Manuscript.js';
import WriterDraft from '../models/WriterDraft.js';
import WriterBlob from '../models/WriterBlob.js';
import Chapter from '../models/Chapter.js';

Object.assign(process.env, dotenv.parse(fs.readFileSync('.runtime/r2.env')));
const client = r2Client(), storage = createWritingStorage({client, bucket: process.env.R2_BUCKET});
const nonce = crypto.randomUUID(), content = `云草稿真实存储检查 ${nonce}。\n第二段😀。`;
let repl, server, app, user;
try {
  repl = await MongoMemoryReplSet.create({binary: {version: '7.0.40'}, replSet: {count: 1, storageEngine: 'wiredTiger'}});
  const config = readConfig({APP_ENV: 'test', MONGO_URI: repl.getUri('test1_test'), JWT_SECRET: crypto.randomBytes(32).toString('hex')});
  await mongoose.connect(config.uri, {autoIndex: false});
  for (const model of Object.values(mongoose.models)) await model.createIndexes();
  app = createApp(config); app.locals.writingStorage = storage;
  server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`, cookies = new Map();
  async function request(path, method = 'GET', body) {
    const headers = {'content-type': 'application/json'};
    if (method !== 'GET') {headers.origin = 'http://127.0.0.1:3000'; headers['x-csrf-token'] = (await request('/api/auth/csrf')).data.csrfToken;}
    headers.cookie = [...cookies].map(([k,v]) => `${k}=${v}`).join('; ');
    const response = await fetch(base + path, {method, headers, body: body && JSON.stringify(body)});
    for (const cookie of response.headers.getSetCookie()) {const [key, ...value] = cookie.split(';')[0].split('='); cookies.set(key, value.join('='));}
    return {status: response.status, data: await response.json()};
  }
  user = await User.create({username: 'R2 isolated ' + nonce, email: nonce + '@example.test', password: await bcrypt.hash(nonce, 10)});
  assert.equal((await request('/api/auth/signin', 'POST', {email: user.email, password: nonce})).status, 200);
  await Manuscript.create({_id: `${user.id}:${nonce}`, owner: user.id, title: '隔离云端检查'});
  const url = '/api/writer/workspace/m_' + nonce, payload = {id: nonce, title: '云端章节', content, number: 1, revision: 0};
  const first = await request(`${url}/drafts/${nonce}`, 'PUT', payload);
  assert.equal(first.status, 200, JSON.stringify(first));
  assert.equal((await request(`${url}/drafts/${nonce}`)).data.content, content);
  assert.equal((await WriterDraft.findOne()).toObject().content, undefined);
  assert.equal((await request(`${url}/drafts/${nonce}`, 'PUT', payload)).data.cloudRevision, 1);
  assert.equal((await User.findById(user.id)).daily_upload_words, Array.from(content).length);
  const {revision, ...publication} = payload;
  const published = await request(url + '/publish', 'POST', {...publication, cloudRevision: 1});
  assert.equal(published.status, 200, JSON.stringify(published));
  const chapter = await Chapter.findById(published.data.chapterId);
  assert.equal(chapter.content, undefined);
  assert.equal((await request('/api/chapters/' + chapter.id)).data.content, content);
  assert.equal((await User.findById(user.id)).daily_upload_words, Array.from(content).length);
  await cleanupDraftObjects(storage, new Date(Date.now() + 3600000));
  assert.equal((await request('/api/chapters/' + chapter.id)).data.content, content);
  console.log(JSON.stringify({passed: true, checks: ['real R2 draft roundtrip', 'metadata-only MongoDB draft', 'retry deduplication', 'R2 publication', 'public chapter read', 'no second quota charge', 'obsolete draft cleanup preserves published body']}));
} finally {
  app?.locals.stopWritingCleanup();
  if (server) await new Promise(r => server.close(r));
  if (mongoose.connection.readyState === 1) {
    for (const blob of await WriterBlob.find().lean()) {
      assert.ok(user && blob._id.startsWith(`drafts/${user.id}/`)); await storage.remove(blob._id);
    }
    for (const chapter of await Chapter.find().lean()) {
      assert.equal(await storage.readChapter(chapter), content);
      await client.send(new DeleteObjectCommand({Bucket: process.env.R2_BUCKET, Key: chapter.contentKey}));
    }
  }
  await mongoose.disconnect(); if (repl) await repl.stop(); client.destroy();
}
