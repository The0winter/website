import '../../tools/test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import {TestDatabase} from '../database/testing.js';
import {createApp} from '../app.js';
import {readConfig} from '../config.js';
import {seedForumFixture} from '../fixtures/forum.js';
import Book from '../models/Book.js';
import User from '../models/User.js';
import Post from '../models/ForumPost.js';
import Reply from '../models/ForumReply.js';

test('book questions share distinct answer entries, preserve source text, and keep article comments out of the feed', async () => {
  const database = await TestDatabase.create();
  const config = readConfig({APP_ENV:'test', DATABASE_URL:database.getUri(), JWT_SECRET:crypto.randomBytes(48).toString('hex')});
  await mongoose.connect(config.uri, {autoIndex:false});
  for (const model of Object.values(mongoose.models)) await model.createIndexes();
  const server = createApp(config).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const jar = new Map();
  async function request(path, body) {
    let csrf;
    if (body) csrf = (await request('/api/auth/csrf')).data.csrfToken;
    const response = await fetch(base + path, {method:body ? 'POST' : 'GET', headers:{cookie:[...jar].map(([k,v]) => `${k}=${v}`).join('; '), ...(body ? {'content-type':'application/json', origin:'http://127.0.0.1:3000', 'x-csrf-token':csrf} : {})}, body:body ? JSON.stringify(body) : undefined});
    for (const cookie of response.headers.getSetCookie()) {const [key, ...value] = cookie.split(';')[0].split('=');jar.set(key, value.join('='));}
    return {status:response.status, data:await response.json()};
  }
  try {
    const manifest = {version:1, batch:'forum-test', usage:'local-noncommercial-test', book:{title:'测试作品',author:'测试作者'}, question:{title:'如何评价测试作品？',content:'<p>讨论测试作品</p>'}, articles:Array.from({length:5}, (_, index) => {
      const content = `<p>第 ${index + 1} 篇独立回答。&lt;保留文字&gt;</p><h2>小标题</h2><p>完整正文。</p>`;
      return {id:`review-${index}`, title:`文章 ${index}`, content, sha256:crypto.createHash('sha256').update(content).digest('hex'), source:{title:`原文 ${index}`,author:`原作者 ${index}`,url:`https://example.test/review/${index}`,license:'CC BY-SA 4.0',licenseUrl:'https://creativecommons.org/licenses/by-sa/4.0/',publishedAt:'2024-01-01T00:00:00Z'}};
    })};
    await assert.rejects(seedForumFixture(manifest, {...config, mode:'production'}), /本地隔离/);
    await assert.rejects(seedForumFixture({...manifest, articles:[{...manifest.articles[0],content:'被修改的内容'}]}, config), /校验/);
    const fixture = await seedForumFixture(manifest, config);
    assert.deepEqual(await seedForumFixture(manifest, config), fixture, 'reimport is idempotent');
    assert.equal(await Reply.countDocuments({postId:fixture.questionId}), 5);
    const question = (await request(`/api/forum/posts/${fixture.questionId}`)).data;
    assert.equal(question.comments, 5);
    assert.equal(question.bookId, fixture.bookId);
    assert.equal(question.bookTitle, '测试作品');
    const feed = (await request('/api/forum/posts?view=answers')).data;
    assert.equal(feed.length, 5);
    assert.equal(new Set(feed.map(row => row.entryId)).size, 5);
    assert.ok(feed.every(row => row.id === fixture.questionId && row.topReply.source.author.startsWith('原作者')));
    const all = (await request(`/api/forum/posts/${fixture.questionId}/replies`)).data;
    assert.equal(all.length, 5);
    for (const [index, id] of fixture.answerIds.entries()) {
      const row = all.find(row => row.id === id);
      assert.equal(row.content, manifest.articles[index].content);
      assert.equal(row.source.url, manifest.articles[index].source.url);
      assert.equal(row.author.name, manifest.articles[index].source.author);
      assert.equal(new Date(row.time).toISOString(), row.time);
    }
    const bookFeed = (await request(`/api/books/${fixture.bookId}/discussions`)).data;
    assert.deepEqual(bookFeed.items, feed);
    assert.equal(bookFeed.total, 5);
    assert.equal((await request(`/api/books/${fixture.bookId}/discussions?page=2`)).data.items.length, 0);
    const pages = await Promise.all([1,2,3].map(page => request(`/api/forum/posts?view=answers&limit=2&page=${page}`)));
    assert.deepEqual(pages.flatMap(page => page.data), feed, 'pagination cannot repeat one question key or omit answers');

    const user = await User.create({username:'讨论测试读者', email:'reader-forum-test@example.test', password:await bcrypt.hash('Local-test-12345', 10)});
    assert.equal((await request('/api/auth/signin', {email:user.email,password:'Local-test-12345'})).status, 200);
    const linked = await request('/api/forum/posts', {title:'另一个书籍问题？',content:'书籍问题正文',type:'question',bookId:fixture.bookId});
    assert.equal(linked.status, 201);
    assert.equal(linked.data.bookId, fixture.bookId);
    const article = await request('/api/forum/posts', {title:'独立文章',content:'<p>独立文章正文</p>',type:'article',bookId:fixture.bookId});
    assert.equal(article.status, 201);
    const articleComment = await request(`/api/forum/posts/${article.data.id}/replies`, {content:'独立文章的评论'});
    assert.equal(articleComment.status, 201);
    const after = (await request('/api/forum/posts?view=answers')).data;
    assert.equal(after.length, 7);
    assert.ok(after.some(row => row.id === article.data.id && row.type === 'article' && row.topReply === null));
    assert.ok(!after.some(row => row.entryId === articleComment.data.id));
    assert.equal((await request(`/api/books/${fixture.bookId}/discussions`)).data.total, 7);
    assert.deepEqual((await request(`/api/forum/posts/${linked.data.id}/replies?target=${fixture.answerIds[0]}`)).data, []);
    assert.equal((await request(`/api/forum/posts/${linked.data.id}/replies`, {content:'冒用原作者',source:manifest.articles[0].source})).status, 400);
    const reply = fixture.answerIds[0];
    assert.equal((await request(`/api/forum/replies/${reply}/like`, {liked:true})).data.votes, 1);
    assert.equal((await request('/api/forum/posts?view=answers&tab=hot')).data[0].entryId, reply);
    assert.equal((await request(`/api/forum/replies/${reply}/comments`, {content:'书评的评论'})).status, 201);
    assert.equal((await request(`/api/forum/posts/${fixture.questionId}/replies?target=${reply}`)).data[0].comments, 1);
    assert.equal((await request(`/api/books/${fixture.bookId}/discussions`)).data.items.find(row => row.entryId === reply).topReply.comments, 1);

    await Book.updateOne({_id:fixture.bookId}, {$set:{visibility:'private'}});
    assert.equal((await request(`/api/books/${fixture.bookId}/discussions`)).status, 404);
    assert.equal((await request(`/api/forum/posts/${fixture.questionId}`)).status, 404);
    assert.deepEqual((await request('/api/forum/posts?view=answers')).data, []);
    assert.equal((await request('/api/forum/posts', {title:'私密书问题？',content:'测试',bookId:fixture.bookId})).status, 400);
    await Book.updateOne({_id:fixture.bookId}, {$set:{visibility:'public',deletedAt:new Date()}});
    assert.equal((await request(`/api/books/${fixture.bookId}/discussions`)).status, 404);
    assert.deepEqual((await request('/api/forum/posts?view=answers')).data, []);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect(); await database.stop();
  }
});
