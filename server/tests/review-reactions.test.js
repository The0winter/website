import '../../tools/test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import {MongoMemoryReplSet} from 'mongodb-memory-server';
import {createApp} from '../app.js';
import {readConfig} from '../config.js';
import Book from '../models/Book.js';
import Review from '../models/Review.js';
import User from '../models/User.js';

test('review feedback persists exclusive, idempotent choices without exposing voters', async t => {
  const repl = await MongoMemoryReplSet.create({binary:{version:'7.0.40'}, replSet:{count:1}});
  const config = readConfig({APP_ENV:'test', MONGO_URI:repl.getUri('test1_test'), JWT_SECRET:crypto.randomBytes(48).toString('hex')});
  await mongoose.connect(config.uri, {autoIndex:false});
  for (const model of Object.values(mongoose.models)) await model.createIndexes();
  const server = createApp(config).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  function client() {
    const jar = new Map();
    async function request(path, method='GET', body, extra={}) {
      const response = await fetch(base+path, {method, headers:{cookie:[...jar].map(([k,v]) => `${k}=${v}`).join('; '),
        ...(body === undefined ? {} : {'content-type':'application/json'}), ...extra}, body:body === undefined ? undefined : JSON.stringify(body)});
      for (const cookie of response.headers.getSetCookie()) {const [key,...value] = cookie.split(';')[0].split('='); jar.set(key, value.join('='));}
      return {status:response.status, data:await response.json(), headers:response.headers};
    }
    async function write(path, body) {
      const csrf = await request('/api/auth/csrf');
      return request(path, path === '/api/auth/signin' ? 'POST' : 'PUT', body, {origin:'http://127.0.0.1:3000', 'x-csrf-token':csrf.data.csrfToken});
    }
    return {request, write};
  }
  try {
    const password = await bcrypt.hash('Local-test-password', 10);
    const [author, voter] = await User.create([{username:'author', email:'author@example.test', password}, {username:'voter', email:'voter@example.test', password}]);
    const book = await Book.create({title:'反馈测试', author_id:author._id});
    const review = await Review.create({book:book._id, user:author._id, rating:4, content:'评论正文'});
    // Exercise existing documents without the new optional fields.
    await Review.collection.updateOne({_id:review._id}, {$unset:{likedBy:1, dislikedBy:1}});
    const endpoint = `/api/books/${book.id}/reviews/${review.id}/reaction`;
    const listing = `/api/books/${book.id}/review-reactions?ids=${review.id}`;
    const owner = client(), other = client(), guest = client();
    for (const [c,u] of [[owner,author], [other,voter]]) assert.equal((await c.write('/api/auth/signin', {email:u.email, password:'Local-test-password'})).status, 200);
    await t.test('session, CSRF, input and review ownership boundaries', async () => {
      assert.equal((await guest.request(endpoint, 'PUT', {reaction:'like'})).status, 403);
      assert.equal((await guest.write(endpoint, {reaction:'like'})).status, 401);
      for (const body of [{}, {reaction:'bad'}, {reaction:1}, {reaction:'like', user:author.id}]) assert.equal((await other.write(endpoint, body)).status, 400);
      assert.equal((await other.write(endpoint.replace(review.id, new mongoose.Types.ObjectId().toString()), {reaction:'like'})).status, 404);
      assert.equal((await guest.request(listing+'&ids=bad')).status, 400);
      const initial = await guest.request(listing);
      assert.deepEqual(initial.data, [{id:review.id, likes:0, dislikes:0, reaction:null}]);
      assert.equal(initial.headers.get('cache-control'), 'private, no-store');
    });
    await t.test('repeat likes count once; switching and canceling persist', async () => {
      for (const result of await Promise.all(Array.from({length:4}, () => other.write(endpoint, {reaction:'like'})))) {
        assert.equal(result.status, 200);
        assert.deepEqual(result.data, {id:review.id, likes:1, dislikes:0, reaction:'like'});
      }
      assert.equal((await other.request(listing)).data[0].reaction, 'like');
      assert.deepEqual((await other.write(endpoint, {reaction:'dislike'})).data, {id:review.id, likes:0, dislikes:1, reaction:'dislike'});
      assert.deepEqual((await owner.write(endpoint, {reaction:'like'})).data, {id:review.id, likes:1, dislikes:1, reaction:'like'});
      assert.deepEqual((await guest.request(listing)).data, [{id:review.id, likes:1, dislikes:1, reaction:null}]);
      await other.write(endpoint, {reaction:null});
      assert.deepEqual((await other.request(listing)).data, [{id:review.id, likes:1, dislikes:0, reaction:null}]);
      const saved = await Review.findById(review.id).select('+likedBy +dislikedBy');
      assert.equal(saved.rating, 4); assert.equal(saved.content, '评论正文');
      assert.equal(saved.updatedAt.toISOString(), review.updatedAt.toISOString());
    });
    await t.test('concurrent opposite choices remain mutually exclusive; voters stay private', async () => {
      await Promise.all(['like','dislike','like','dislike'].map(reaction => other.write(endpoint, {reaction})));
      const row = (await other.request(listing)).data[0];
      assert.equal(row.likes + row.dislikes, 2);
      assert(['like','dislike'].includes(row.reaction));
      for (const path of [`/api/books/${book.id}/reviews`, `/api/books/${book.id}/reviews/mine`]) {
        const result = await owner.request(path), reviewJson = Array.isArray(result.data) ? result.data[0] : result.data;
        assert(!('likedBy' in reviewJson)); assert(!('dislikedBy' in reviewJson));
      }
      const another = await Book.create({title:'另一本书', author_id:author._id});
      assert.equal((await other.write(endpoint.replace(book.id, another.id), {reaction:'like'})).status, 404);
    });
    await t.test('private and deleted works retain access restrictions', async () => {
      await Book.updateOne({_id:book._id}, {$set:{visibility:'private'}});
      assert.equal((await guest.request(listing)).status, 404);
      assert.equal((await other.write(endpoint, {reaction:'like'})).status, 404);
      assert.equal((await owner.request(listing)).status, 200);
      await Book.updateOne({_id:book._id}, {$set:{deletedAt:new Date()}});
      assert.equal((await owner.request(listing)).status, 404);
      assert.equal((await owner.write(endpoint, {reaction:null})).status, 404);
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect(); await repl.stop();
  }
});
