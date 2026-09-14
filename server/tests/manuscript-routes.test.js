import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { createApp } from "../app.js";
import { readConfig } from "../config.js";
import User from "../models/User.js";
import Book from "../models/Book.js";
import Chapter from "../models/Chapter.js";
import Manuscript from "../models/Manuscript.js";
import Media from "../models/Media.js";
import { hasMediaReferences } from "../services/media-reference.js";

test("work metadata are private, transactional, revision protected and idempotent", async (t) => {
  const repl = await MongoMemoryReplSet.create({
    binary: { version: "7.0.40" },
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  const config = readConfig({
    APP_ENV: "test",
    MONGO_URI: repl.getUri("test1_test"),
    JWT_SECRET: crypto.randomBytes(48).toString("hex"),
  });
  await mongoose.connect(config.uri, { autoIndex: false });
  for (const model of Object.values(mongoose.models))
    await model.createIndexes();
  const app = createApp(config),
    server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  function client() {
    const jar = new Map();
    async function request(path, method = "GET", body, csrf = true) {
      const headers = {
        cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
      };
      if (method !== "GET" && csrf) {
        headers.origin = "http://127.0.0.1:3000";
        headers["x-csrf-token"] = (
          await request("/api/auth/csrf")
        ).data.csrfToken;
        headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
      }
      if (body && !(body instanceof FormData)) {
        headers["content-type"] = "application/json";
        body = JSON.stringify(body);
      }
      const response = await fetch(base + path, { method, headers, body });
      for (const cookie of response.headers.getSetCookie()) {
        const [k, ...v] = cookie.split(";")[0].split("=");
        jar.set(k, v.join("="));
      }
      return { status: response.status, data: await response.json() };
    }
    return {
      request,
      save: async (key, data) => {
        const body = new FormData();
        body.append("manuscript", JSON.stringify(data));
        return request("/api/manuscripts/" + key, "PUT", body);
      },
    };
  }
  try {
    const password = await bcrypt.hash("Manuscript-test-123", 10);
    const [user, other] = await User.create([
      {
        username: "manuscript-owner",
        email: "manuscript@example.test",
        password,
      },
      { username: "manuscript-other", email: "other@example.test", password },
    ]);
    const owner = client(),
      stranger = client(),
      guest = client();
    for (const [c, u] of [
      [owner, user],
      [stranger, other],
    ])
      assert.equal(
        (
          await c.request("/api/auth/signin", "POST", {
            email: u.email,
            password: "Manuscript-test-123",
          })
        ).status,
        200,
      );
    const key = crypto.randomUUID(), path = '/api/manuscripts/' + key;
    let data = {title: '测试书', description: '书籍简介', cover_image: '', revision: 0, action: 'draft'};
    await t.test('metadata creation is private, authenticated, revision protected and idempotent', async () => {
      assert.equal((await guest.save(key, data)).status, 401);
      assert.equal((await owner.request(path, 'PUT', {}, false)).status, 403);
      const results = await Promise.all([owner.save(key, data), owner.save(key, data)]);
      assert.deepEqual(results.map(r => r.status), [200, 200]);
      assert.deepEqual(results.map(r => r.data.revision), [1, 1]);
      assert.equal(await Book.countDocuments(), 0);
      assert.equal((await stranger.request(path)).status, 404);
      assert.equal((await owner.save(key, {...data, title: '冲突标题'})).status, 409);
      for (const patch of [{title: '字'.repeat(16)}, {description: '字'.repeat(301)}, {description: '  '}])
        assert.equal((await owner.save(key, {...data, revision: 1, ...patch})).status, 400);
      assert.equal((await owner.request(path)).data.title, data.title);
    });
    await t.test('metadata edits preserve legacy chapter bytes and volumes without returning them', async () => {
      const chapters = [{title: '第十章 来信', content: '不能丢失的旧正文。', sourceNumber: 10, volumeTitle: '第二卷', volumeNumber: 2}];
      await Manuscript.updateOne({_id: `${user.id}:${key}`}, {$set: {chapters, totalCharacters: 10, filename: '旧文稿.docx'}});
      data = {...data, revision: 1, description: '设置中修改的简介'};
      assert.equal((await owner.save(key, data)).status, 200);
      const saved = await Manuscript.findById(`${user.id}:${key}`).lean();
      assert.deepEqual(saved.chapters, chapters);
      assert.equal(saved.filename, '旧文稿.docx'); assert.equal(saved.totalCharacters, 10);
      assert.equal((await owner.request(path)).data.chapters, undefined);
      const workspace = await owner.request(`/api/writer/workspace/m_${key}`);
      assert.equal(workspace.data.cloudDrafts[0].content, chapters[0].content);
      assert.equal((await owner.save(key, {...data, revision: 2, chapters: [{title: '覆盖', content: '覆盖'}]})).status, 400);
      assert.deepEqual((await Manuscript.findById(saved._id).lean()).chapters, chapters);
    });
    await t.test('retired import, cloud editing and whole-book publishing cannot mutate data', async () => {
      assert.equal((await owner.save(key, {...data, revision: 2, action: 'publish'})).status, 400);
      const uploaded = new FormData(); uploaded.append('file', new Blob(['第一章\n旧导入内容']), 'book.txt');
      assert.equal((await owner.request('/api/manuscripts/parse', 'POST', uploaded)).status, 400);
      const book = await Book.create({title: '已存在的作品', author_id: user.id});
      // Express uses HTML for unknown endpoints; test the HTTP status directly.
      for (const method of ['GET', 'PUT', 'DELETE']) {
        const response = await fetch(base + `/api/books/${book.id}/draft`, {method});
        assert.ok([403, 404].includes(response.status));
      }
      assert.equal(await Chapter.countDocuments(), 0);
      await Book.deleteOne({_id: book.id});
    });
    await t.test('cover ownership, retention and private-work deletion remain intact', async () => {
      const media = await Media.create({owner: user.id, content: Buffer.from('synthetic'), mime: 'image/webp', sha256: 'a'.repeat(64)});
      data = {...data, revision: 2, cover_image: '/api/media/' + media.id};
      assert.equal((await owner.save(key, data)).status, 200);
      assert.equal(await hasMediaReferences(media), true);
      assert.equal((await stranger.save(crypto.randomUUID(), {...data, revision: 0})).status, 400);
      assert.equal((await stranger.request(path, 'DELETE')).status, 200);
      assert.ok(await Manuscript.findById(`${user.id}:${key}`));
      assert.equal((await owner.request(path, 'DELETE')).status, 200);
      assert.equal(await hasMediaReferences(media), false);
      data = {...data, cover_image: ''};
    });
    await t.test('unified works, chapter publication, privacy and reader trends', async () => {
      const draftKey = crypto.randomUUID();
      const payload = {...data, title:'私密管理验证', revision:0, action:'draft'};
      assert.equal((await owner.save(draftKey,payload)).status,200);
      const owned = await owner.request('/api/writer/works');
      assert.equal(owned.status,200);
      const saved = owned.data.find(b=>b.manuscriptKey===draftKey);
      assert.equal(saved.visibility,'private');
      assert.ok(!(await stranger.request('/api/writer/works')).data.some(b=>b.manuscriptKey===draftKey));
      assert.equal((await guest.request('/api/writer/works')).status,401);
      const published = await owner.request(`/api/writer/workspace/m_${draftKey}/publish`,'POST',{id:'first-local',title:'',content:'没有章名的完整正文。',number:1});
      assert.equal(published.status,200);
      const bid=published.data.bookId;
      const chapters=(await guest.request(`/api/books/${bid}/chapters`)).data;
      assert.equal(chapters[0].title,'第1章');
      const chapter=chapters[0];
      assert.equal((await owner.request(`/api/writer/workspace/b_${bid}/publish`,'POST',{id:'second-local',title:'',content:'第二章无标题正文',number:2})).status,200);
      const reports=await Promise.all([1,2,3].map(()=>stranger.request(`/api/books/${bid}/views`,'POST',{chapterId:chapter.id})));
      assert.equal(reports.filter(r=>r.data.counted).length,1);
      const daily=mongoose.connection.collection('readdailies');
      await daily.insertMany([{_id:`${bid}:2026-01-05`,bookId:new mongoose.Types.ObjectId(bid),day:'2026-01-05',views:7},{_id:`${bid}:2026-01-06`,bookId:new mongoose.Types.ObjectId(bid),day:'2026-01-06',views:3}]);
      const stats=await owner.request('/api/writer/statistics?period=week&end=2026-01-31');
      assert.equal(stats.status,200);
      assert.equal(stats.data.points.find(p=>p.date==='2026-01-05').views,10);
      assert.equal(stats.data.bestChapter.views,1);
      assert.ok(stats.data.points.some(p=>p.views===null));
      const month=await owner.request('/api/writer/statistics?period=month&end=2026-01-31');
      assert.equal(month.data.points.at(-1).views,10);
      assert.equal((await stranger.request('/api/writer/statistics')).data.totalViews,0);
      assert.equal((await owner.request('/api/writer/statistics?period=year')).status,400);
      assert.equal((await owner.request('/api/writer/statistics?end=2026-02-30')).status,400);
      assert.equal((await owner.request(`/api/books/${bid}`,'PATCH',{visibility:'private'})).status,200);
      for(const route of [`/api/books/${bid}`,`/api/books/${bid}/catalog`,`/api/books/${bid}/chapters`,`/api/books/${bid}/statistics`,`/api/books/${bid}/reviews`,`/api/chapters/${chapter.id}`,`/api/chapters/${chapter.id}/paragraph-comments`]) {
        assert.equal((await guest.request(route)).status,404,route);
        assert.equal((await stranger.request(route)).status,404,route);
        assert.equal((await owner.request(route)).status,200,route);
      }
      for(const route of ['/api/books','/api/books?orderBy=rank_total',`/api/books?author_id=${user.id}`,'/api/sitemap-books','/api/books/sitemap-pool']) {
        const list=await guest.request(route);
        assert.ok(!list.data.some(b=>String(b.id||b._id)===bid),route);
      }
      assert.equal((await stranger.request(`/api/books/${bid}`,'PATCH',{visibility:'public'})).status,404);
      assert.equal((await owner.request(`/api/books/${bid}`,'PATCH',{visibility:'public'})).status,200);
      assert.equal((await guest.request(`/api/chapters/${chapter.id}`)).status,200);
      assert.equal((await owner.request(`/api/books/${bid}`,'DELETE')).status,200);
      assert.ok(!(await owner.request('/api/writer/works')).data.some(b=>b.id===bid));
    });
  } finally {
    await new Promise((r) => server.close(r));
    await mongoose.disconnect();
    await repl.stop();
  }
});
