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
import { dayKey } from "../services/content.js";

test("whole manuscript drafts are private, transactional, revision protected and idempotent", async (t) => {
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
    const key = crypto.randomUUID(),
      path = "/api/manuscripts/" + key;
    let data = {
      title: "测试书",
      description: "书籍简介",
      cover_image: "",
      category: "仙侠",
      filename: "文稿.txt",
      chapters: [
        { title: "第十章 风起", content: "保留原文顺序。", sourceNumber: 10 },
        { title: "第二章 来信", content: "完整的第二项。", sourceNumber: 2 },
      ],
      revision: 0,
      action: "draft",
    };
    await t.test(
      "anonymous and CSRF requests rejected; parse is preview only",
      async () => {
        assert.equal((await guest.save(key, data)).status, 401);
        assert.equal((await owner.request(path, "PUT", {}, false)).status, 403);
        const body = new FormData();
        body.append("file", new Blob(["第一章\n正文内容。"]), "book.txt");
        const result = await owner.request(
          "/api/manuscripts/parse",
          "POST",
          body,
        );
        assert.equal(result.status, 200);
        assert.equal(result.data.chapters[0].content, "正文内容。");
        assert.equal(await Manuscript.countDocuments(), 0);
      },
    );
    await t.test(
      "save whole draft and retry creates no public book; others cannot read it",
      async () => {
        const saved = await owner.save(key, data);
        assert.equal(saved.status, 200);
        assert.equal(saved.data.revision, 1);
        assert.equal((await owner.save(key, data)).data.revision, 1);
        assert.equal(await Book.countDocuments(), 0);
        assert.equal(
          (await owner.request(path)).data.chapters[1].content,
          data.chapters[1].content,
        );
        assert.equal((await stranger.request(path)).status, 404);
        assert.equal(
          (await stranger.request("/api/manuscripts")).data.drafts.length,
          0,
        );
      },
    );
    await t.test(
      "field limits, empty chapter and stale revision cannot overwrite draft",
      async () => {
        assert.equal(
          (await owner.save(key, { ...data, title: "新标题" })).status,
          409,
        );
        assert.equal(
          (
            await owner.save(key, {
              ...data,
              revision: 1,
              title: "字".repeat(16),
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await owner.save(key, {
              ...data,
              revision: 1,
              description: "字".repeat(301),
            })
          ).status,
          400,
        );
        const bad = await owner.save(key, {
          ...data,
          revision: 1,
          action: "publish",
          chapters: [{ title: "第一章", content: "" }],
        });
        assert.equal(bad.status, 400);
        assert.match(bad.data.error, /正文为空/);
        assert.equal((await owner.request(path)).data.title, "测试书");
      },
    );
    await t.test(
      "draft covers count as references and foreign covers rejected",
      async () => {
        const media = await Media.create({
          owner: user._id,
          content: Buffer.from("synthetic"),
          mime: "image/webp",
          sha256: "a".repeat(64),
        });
        data = { ...data, revision: 1, cover_image: "/api/media/" + media._id };
        assert.equal((await owner.save(key, data)).status, 200);
        assert.equal(await hasMediaReferences(media), true);
        assert.equal(
          (await stranger.save(crypto.randomUUID(), { ...data, revision: 0 }))
            .status,
          400,
        );
      },
    );
    await t.test(
      "quota failure keeps whole draft and creates neither book nor chapter",
      async () => {
        await User.updateOne(
          { _id: user._id },
          { $set: { uploadDay: dayKey(), daily_upload_words: 99999 } },
        );
        const result = await owner.save(key, {
          ...data,
          revision: 2,
          action: "publish",
        });
        assert.equal(result.status, 429);
        assert.match(result.data.error, /保存草稿/);
        assert.equal(await Book.countDocuments(), 0);
        assert.equal(await Chapter.countDocuments(), 0);
        assert.equal((await owner.request(path)).data.chapters.length, 2);
        await User.updateOne(
          { _id: user._id },
          { $set: { daily_upload_words: 0 } },
        );
      },
    );
    await t.test(
      "concurrent submission and retry yield one complete book in document order",
      async () => {
        const publish = { ...data, revision: 2, action: "publish" };
        const results = await Promise.all([
          owner.save(key, publish),
          owner.save(key, publish),
        ]);
        assert.deepEqual(
          results.map((r) => r.status),
          [200, 200],
        );
        assert.equal(results[0].data.bookId, results[1].data.bookId);
        assert.equal(await Book.countDocuments(), 1);
        assert.equal(await Chapter.countDocuments(), 2);
        const chapters = await Chapter.find()
          .sort({ chapter_number: 1 })
          .lean();
        assert.deepEqual(
          chapters.map((c) => c.title),
          data.chapters.map((c) => c.title),
        );
        assert.deepEqual(
          chapters.map((c) => c.content),
          data.chapters.map((c) => c.content),
        );
        assert.equal(
          (await owner.request("/api/manuscripts")).data.drafts.length,
          0,
        );
        assert.equal(
          (await owner.save(key, { ...publish, title: "改名" })).status,
          409,
        );
      },
    );
    await t.test(
      "volume parsing survives draft resume, publication and both reader catalog endpoints",
      async () => {
        const body = new FormData();
        body.append(
          "file",
          new Blob([
            "第二卷 远行\n第二章 归来\n归来正文。\n第一章 启程\n启程正文。\n第一卷 风起\n第二章 来信\n来信正文。\n第一章 初遇\n初遇正文。",
          ]),
          "volumes.txt",
        );
        const parsed = await owner.request(
          "/api/manuscripts/parse",
          "POST",
          body,
        );
        assert.equal(parsed.status, 200);
        const key = crypto.randomUUID();
        const draft = {
          ...data,
          title: "分卷测试",
          chapters: parsed.data.chapters,
          revision: 0,
        };
        assert.equal((await owner.save(key, draft)).status, 200);
        const resumed = (await owner.request("/api/manuscripts/" + key)).data;
        assert.deepEqual(resumed.chapters, parsed.data.chapters);
        const published = await owner.save(key, {
          ...resumed,
          action: "publish",
        });
        assert.equal(published.status, 200);
        const list = await guest.request(
          "/api/books/" + published.data.bookId + "/chapters?order=asc",
        );
        assert.deepEqual(
          list.data.map((c) => [c.title, c.volume_title, c.chapter_number]),
          [
            ["第一章 初遇", "第一卷 风起", 1],
            ["第二章 来信", "第一卷 风起", 2],
            ["第一章 启程", "第二卷 远行", 3],
            ["第二章 归来", "第二卷 远行", 4],
          ],
        );
        const catalog = await guest.request(
          "/api/books/" + published.data.bookId + "/catalog",
        );
        assert.equal(catalog.status, 200);
        assert.deepEqual(
          catalog.data.volumes.map(({ title, start, count }) => ({
            title,
            start,
            count,
          })),
          [
            { title: "第一卷 风起", start: 0, count: 2 },
            { title: "第二卷 远行", start: 2, count: 2 },
          ],
        );
        const content = await guest.request("/api/chapters/" + list.data[2].id);
        assert.equal(content.data.content, "启程正文。");
      },
    );
    await t.test('unified private works, publication without chapter names, privacy and reader trends', async () => {
      const draftKey = crypto.randomUUID();
      const payload = {...data, title:'私密管理验证', chapters:[{title:'',content:'没有章名的完整正文。'}], revision:0, action:'draft'};
      assert.equal((await owner.save(draftKey,payload)).status,200);
      const owned = await owner.request('/api/writer/works');
      assert.equal(owned.status,200);
      const saved = owned.data.find(b=>b.manuscriptKey===draftKey);
      assert.equal(saved.visibility,'private');
      assert.ok(!(await stranger.request('/api/writer/works')).data.some(b=>b.manuscriptKey===draftKey));
      assert.equal((await guest.request('/api/writer/works')).status,401);
      const published = await owner.save(draftKey,{...payload,revision:1,action:'publish'});
      assert.equal(published.status,200);
      const bid=published.data.bookId;
      const chapters=(await guest.request(`/api/books/${bid}/chapters`)).data;
      assert.equal(chapters[0].title,'第1章');
      const chapter=chapters[0];
      const draft=(await owner.request(`/api/books/${bid}/draft`,'PUT',{title:'',content:'第二章无标题正文'}));
      assert.equal(draft.status,200);
      assert.equal(draft.data.title,'第2章');
      assert.equal((await owner.request(`/api/books/${bid}/draft/publish`,'POST',{draftId:draft.data.id})).status,200);
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
