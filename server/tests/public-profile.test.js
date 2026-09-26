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
import Review from '../models/Review.js';

test('public profile exposes basic identity only and review writes enforce 140 characters', async t => {
  const database = await TestDatabase.create();
  const config = readConfig({APP_ENV:'test',DATABASE_URL:database.getUri(),JWT_SECRET:crypto.randomBytes(48).toString('hex')});
  await mongoose.connect(config.uri,{autoIndex:false});
  for (const model of Object.values(mongoose.models)) await model.createIndexes();
  const server = createApp(config).listen(0,'127.0.0.1');
  await new Promise(resolve => server.once('listening',resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const jar = new Map();
  async function request(path,method='GET',body,headers={}) {
    const response = await fetch(base+path,{method,headers:{...headers,cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; '),...(body === undefined ? {} : {'content-type':'application/json'})},body:body === undefined ? undefined : JSON.stringify(body)});
    for (const cookie of response.headers.getSetCookie()) {const [key,...value]=cookie.split(';')[0].split('=');jar.set(key,value.join('='));}
    return {status:response.status,body:await response.json(),headers:response.headers};
  }
  async function write(path,body) {
    const token = (await request('/api/auth/csrf')).body.csrfToken;
    return request(path,'POST',body,{'x-csrf-token':token,origin:'http://127.0.0.1:3000'});
  }
  try {
    const user = await User.create({username:'公开昵称',email:'never-public@example.test',password:await bcrypt.hash('Local-test-12345',10),profileTheme:'sage',weekly_score:999,authVersion:5});
    const endpoint = `/api/users/${user.id}/profile`;
    await t.test('guest and signed-in public responses use the same safe whitelist',async () => {
      const guest = await request(endpoint);
      assert.equal(guest.status,200);
      assert.deepEqual(Object.keys(guest.body).sort(),['_id','avatar','created_at','id','profileTheme','role','username'].sort());
      assert.equal(guest.body.username,'公开昵称');
      assert.equal(guest.headers.get('cache-control'),'private, no-store');
      assert.equal((await write('/api/auth/signin',{username:user.username,password:'Local-test-12345'})).status,200);
      const own = await request(endpoint);
      assert.deepEqual(own.body,guest.body);
      assert.equal((await request('/api/auth/session')).body.user.email,user.email);
    });
    await t.test('invalid, unknown and banned accounts do not expose account details',async () => {
      assert.equal((await request('/api/users/not-an-id/profile')).status,400);
      assert.equal((await request(`/api/users/${new mongoose.Types.ObjectId()}/profile`)).status,404);
      await User.updateOne({_id:user._id},{$set:{isBanned:true}});
      assert.equal((await request(endpoint)).status,404);
      await User.updateOne({_id:user._id},{$set:{isBanned:false}});
    });
    await t.test('API accepts 140 Unicode characters and rejects 141 without overwriting a review',async () => {
      const book = await Book.create({title:'短评边界测试',author_id:user._id});
      const path = `/api/books/${book.id}/reviews`;
      const content = '阅'.repeat(139)+'😀';
      assert.equal((await write(path,{rating:4,content})).status,201);
      const tooLong = await write(path,{rating:2,content:content+'书'});
      assert.equal(tooLong.status,400);
      const saved = await Review.findOne({book:book._id,user:user._id});
      assert.equal(saved.content,content);assert.equal(saved.rating,4);
      const listing = await request(path);
      assert(!JSON.stringify(listing.body).includes(user.email));
      assert.deepEqual(Object.keys(listing.body[0].user).sort(),['_id','avatar','username']);
      assert.equal((await write(path,{rating:5,content:'  短评  '})).status,201);
      assert.equal((await Review.findById(saved._id)).content,'短评');
      assert.equal((await write(path,{rating:3})).status,201);
      assert.equal((await Review.findById(saved._id)).content,'短评');
      assert.equal((await write(path,{rating:3,content:''})).status,201);
      assert.equal((await request(path)).headers.get('x-total-count'),'0');
    });
  } finally {
    await new Promise(resolve=>server.close(resolve));
    await mongoose.disconnect();await database.stop();
  }
});
