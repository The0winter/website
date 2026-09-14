import express from "express";
import multer from "multer";
import mongoose from "mongoose";
import {retireWorkspaceDrafts} from '../services/writing-drafts.js';
import Manuscript from "../models/Manuscript.js";
import User from "../models/User.js";
import { asyncRoute } from "../security.js";
import { fail, contentHash } from "../services/content.js";
import {
  claimMedia,
  retireUnreferencedCover,
} from "../services/media-reference.js";
import { finishCoverRetirement } from "../services/cover-retention.js";
function metadata(body) {
  const data = {};
  for (const [key, max] of [["title", 15], ["description", 300], ["cover_image", 2000]]) {
    if (typeof body[key] !== "string" || Array.from(body[key]).length > max)
      fail(400, {title: "书名须在 15 个字符以内", description: "简介须在 300 个字符以内"}[key] || "封面地址无效");
    data[key] = body[key].trim();
  }
  if (!data.title || !data.description) fail(400, "请填写书名和简介");
  if (body.chapters !== undefined && (!Array.isArray(body.chapters) || body.chapters.length))
    fail(400, "请在创作页面编辑章节；此处仅保存作品资料");
  return data;
}

export function manuscriptRoutes(app, auth) {
  const router = express.Router();
  router.use(auth.authenticate, (req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    next();
  });
  const payload = multer({
    limits: { files: 0, fields: 1, fieldSize: 16 * 1024, parts: 2 },
  }).none();
  router.use("/:key", (req, res, next) =>
    /^[a-zA-Z0-9_-]{16,128}$/.test(req.params.key)
      ? next()
      : res.status(400).json({ error: "草稿编号无效" }),
  );
  const id = (req) => `${req.user.id}:${req.params.key}`;
  router.get(
    "/:key",
    asyncRoute(async (req, res) => {
      const draft = await Manuscript.findOne({
        _id: id(req),
        publishedBookId: null,
      }).select("title description cover_image revision").lean();
      if (!draft) fail(404, "草稿不存在或已提交");
      res.json(draft);
    }),
  );
  router.put(
    "/:key",
    payload,
    asyncRoute(async (req, res) => {
      let body;
      try {
        body = JSON.parse(req.body.manuscript);
      } catch {
        fail(400, "文稿资料无效");
      }
      if (
        body?.action !== "draft" ||
        !Number.isSafeInteger(body.revision) ||
        body.revision < 0
      )
        fail(400, "保存参数无效");
      const data = metadata(body),
        hash = contentHash(data);
      let result, retired;
      await mongoose.connection.transaction(async (session) => {
        retired = undefined;
        await User.updateOne(
          { _id: req.user.id },
          { $inc: { contentVersion: 1 } },
          { session },
        );
        let draft = await Manuscript.findById(id(req)).session(session);
        if (draft?.savedHash === hash) {
          result = draft;
          return;
        }
        if (draft?.publishedBookId) fail(409, "此文稿已提交，请到作品管理修改");
        if ((draft?.revision || 0) !== body.revision)
          fail(409, "草稿已在另一页面更新，请关闭后重新打开");
        if (
          !draft &&
          (await Manuscript.countDocuments({
            owner: req.user.id,
            publishedBookId: null,
          }).session(session)) >= 50
        )
          fail(400, "最多保留 50 份作品草稿，请先整理已有草稿");
        if (
          data.cover_image &&
          !(await claimMedia(data.cover_image, req.user.id, session))
        )
          fail(400, "封面不可用，请重新上传");
        const previousCover = draft?.cover_image;
        draft ||= new Manuscript({ _id: id(req), owner: req.user.id, category: "未分类", chapters: [], totalCharacters: 0 });
        Object.assign(draft, data, {
          savedHash: hash,
          revision: body.revision + 1,
        });
        result = await draft.save({ session });
        if (previousCover && previousCover !== data.cover_image)
          retired = await retireUnreferencedCover(previousCover, session);
      });
      await finishCoverRetirement(retired, {
        storage: app.locals.coverStorage,
      });
      res.json({
        revision: result.revision,
        bookId: result.publishedBookId,
        status: result.publishedBookId ? "published" : "draft",
      });
    }),
  );
  router.delete(
    "/:key",
    asyncRoute(async (req, res) => {
      let retired;
      await mongoose.connection.transaction(async (session) => {
        retired = undefined;
        await User.updateOne({_id: req.user.id}, {$inc: {contentVersion: 1}}, {session});
        const draft = await Manuscript.findOneAndDelete(
          { _id: id(req), publishedBookId: null },
          { session },
        );
        if (draft) await retireWorkspaceDrafts(req.user.id, `m_${req.params.key}`, session);
        if (draft?.cover_image)
          retired = await retireUnreferencedCover(draft.cover_image, session);
      });
      await finishCoverRetirement(retired, {
        storage: app.locals.coverStorage,
      });
      res.json({ success: true });
    }),
  );
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status =
      error.status ||
      (error.name === "MulterError" ? 413 : error.code === 11000 ? 409 : 500);
    res
      .status(status)
      .json({
        error:
          error.name === "MulterError"
            ? "作品资料超出限制"
            : status === 500
              ? "作品保存暂时失败，请重试；原内容仍保留"
              : error.message,
      });
  });
  app.use("/api/manuscripts", router);
}
