import express from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import mongoose from "mongoose";
import Manuscript from "../models/Manuscript.js";
import Book from "../models/Book.js";
import Chapter from "../models/Chapter.js";
import User from "../models/User.js";
import { asyncRoute } from "../security.js";
import { fail, contentHash, chargeQuota, dayKey } from "../services/content.js";
import {
  claimMedia,
  retireUnreferencedCover,
} from "../services/media-reference.js";
import { finishCoverRetirement } from "../services/cover-retention.js";
import {
  manuscriptLimits,
  validateManuscript,
} from "../services/manuscript.js";
import { readManuscriptFile } from "../services/manuscript-file.js";

export function manuscriptRoutes(app, auth) {
  const router = express.Router();
  router.use(auth.authenticate, (req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    next();
  });
  const fileUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: manuscriptLimits.bytes,
      files: 1,
      fields: 1,
      fieldSize: 40,
      parts: 3,
    },
  }).single("file");
  const payload = multer({
    limits: { files: 0, fields: 1, fieldSize: 8 * 1024 * 1024, parts: 2 },
  }).none();
  let parsing = 0;
  router.post(
    "/parse",
    rateLimit({
      windowMs: 60000,
      limit: 12,
      message: { error: "文稿识别过于频繁，请稍后再试" },
    }),
    (req, res, next) => {
      if (parsing >= 2)
        return res.status(503).json({ error: "正在处理其他文稿，请稍后重试" });
      parsing++;
      fileUpload(req, res, (error) => {
        if (error) {
          parsing--;
          return next(error);
        }
        Promise.resolve()
          .then(() => readManuscriptFile(req.file, req.body.encoding))
          .then((result) => res.json(result))
          .catch(next)
          .finally(() => parsing--);
      });
    },
  );
  router.get(
    "/",
    asyncRoute(async (req, res) => {
      const drafts = await Manuscript.find({
        owner: req.user.id,
        publishedBookId: null,
      })
        .select("-chapters -savedHash")
        .sort({ updatedAt: -1 })
        .limit(50)
        .lean();
      const account = req.account;
      res.json({
        drafts,
        remainingCharacters:
          req.user.role === "admin"
            ? null
            : Math.max(
                0,
                100000 -
                  (account.uploadDay === dayKey()
                    ? account.daily_upload_words || 0
                    : 0),
              ),
      });
    }),
  );
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
      }).lean();
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
      const publish = body.action === "publish";
      if (
        !["draft", "publish"].includes(body.action) ||
        !Number.isSafeInteger(body.revision) ||
        body.revision < 0
      )
        fail(400, "保存参数无效");
      const data = validateManuscript(body, publish),
        hash = contentHash({ data, publish });
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
        draft ||= new Manuscript({ _id: id(req), owner: req.user.id });
        Object.assign(draft, data, {
          savedHash: hash,
          revision: body.revision + 1,
        });
        if (publish) {
          if (req.user.role !== "admin") {
            const account = await User.findById(req.user.id).session(session);
            const remaining =
              100000 -
              (account.uploadDay === dayKey()
                ? account.daily_upload_words || 0
                : 0);
            if (data.totalCharacters > remaining)
              fail(
                429,
                `今日还可提交 ${Math.max(0, remaining)} 字，当前文稿 ${data.totalCharacters} 字；可先保存草稿`,
              );
          }
          await chargeQuota(req.user, data.totalCharacters, session);
          const [book] = await Book.create(
            [
              {
                title: data.title,
                description: data.description,
                cover_image: data.cover_image,
                category: data.category || "未分类",
                author: req.account.username,
                author_id: req.user.id,
              },
            ],
            { session },
          );
          await Chapter.insertMany(
            data.chapters.map((c, i) => ({
              bookId: book._id,
              title: c.title,
              content: c.content,
              chapter_number: i + 1,
              word_count: c.content.length,
            })),
            { session },
          );
          draft.publishedBookId = book._id;
          // Keep the receipt for idempotent retries without retaining a second manuscript copy.
          draft.chapters = [];
        }
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
        const draft = await Manuscript.findOneAndDelete(
          { _id: id(req), publishedBookId: null },
          { session },
        );
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
            ? "上传超出限制：文稿最多 10 MB，请只选择一个文件"
            : status === 500
              ? "文稿保存暂时失败，请重试；原内容仍保留"
              : error.message,
      });
  });
  app.use("/api/manuscripts", router);
}
