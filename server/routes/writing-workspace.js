import crypto from 'node:crypto';
import mongoose from 'mongoose';
import Book from '../models/Book.js';
import Chapter from '../models/Chapter.js';
import ChapterDraft from '../models/ChapterDraft.js';
import Manuscript from '../models/Manuscript.js';
import User from '../models/User.js';
import WriterPublication from '../models/WriterPublication.js';
import {asyncRoute} from '../security.js';
import {chargeQuota, contentHash, fail, lockBook, validateChapter} from '../services/content.js';

async function resolve(reference, owner, session = null) {
  let manuscript, book;
  if (/^m_[a-zA-Z0-9_-]{16,128}$/.test(reference)) {
    manuscript = await Manuscript.findOne({_id: `${owner}:${reference.slice(2)}`, owner}).session(session);
    if (!manuscript) fail(404, '作品不存在');
    if (manuscript.publishedBookId) book = await Book.findOne({_id: manuscript.publishedBookId, author_id: owner, deletedAt: null}).session(session);
    if (manuscript.publishedBookId && !book) fail(404, '作品已删除');
  } else if (/^b_[a-f0-9]{24}$/.test(reference)) {
    book = await Book.findOne({_id: reference.slice(2), author_id: owner, deletedAt: null}).session(session);
    if (!book) fail(404, '作品不存在或无权查看');
    manuscript = await Manuscript.findOne({owner, publishedBookId: book._id}).session(session);
  } else fail(400, '作品编号无效');
  const work = manuscript ? `m_${manuscript._id.split(':').at(-1)}` : `b_${book._id}`;
  return {manuscript, book, work};
}

export function writingWorkspaceRoutes(app, auth) {
  app.get('/api/writer/workspace/:reference', auth.authenticate, asyncRoute(async (req, res) => {
    const {manuscript, book, work} = await resolve(req.params.reference, req.user.id);
    const page = Number(req.query.page || 1);
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000) fail(400, '页码无效');
    const receipts = await WriterPublication.find({owner: req.user.id, work}).select('draftId').lean();
    const publishedIds = new Set(receipts.map(receipt => receipt.draftId));
    const cloudDrafts = (manuscript?.chapters || []).flatMap((chapter, index) => {
      const id = `manuscript-${index}`;
      return publishedIds.has(id) ? [] : [{id, title: chapter.title, content: chapter.content, number: index + 1,
        volumeTitle: chapter.volumeTitle, volumeNumber: chapter.volumeNumber, updatedAt: manuscript.updatedAt}];
    });
    let published = [], total = 0, maxNumber = manuscript?.chapters.length || 0;
    if (book) {
      const filter = {bookId: book._id, deletedAt: null};
      const [rows, count, last, legacy] = await Promise.all([
        Chapter.find(filter).select('_id title chapter_number word_count updatedAt').sort({chapter_number: -1}).skip((page - 1) * 50).limit(50).lean(),
        Chapter.countDocuments(filter),
        // Deleted numbers remain reserved by the catalog's unique index.
        Chapter.findOne({bookId: book._id}).sort({chapter_number: -1}).select('chapter_number').lean(),
        ChapterDraft.findOne({bookId: book._id, owner: req.user.id, publishedChapterId: null}).lean(),
      ]);
      published = rows.map(row => ({id: String(row._id), title: row.title, number: row.chapter_number, words: row.word_count, updatedAt: row.updatedAt}));
      total = count; maxNumber = Math.max(maxNumber, last?.chapter_number || 0);
      if (legacy && !publishedIds.has(`legacy-${legacy._id}`)) {
        const target = legacy.targetChapterId && await Chapter.findById(legacy.targetChapterId).select('updatedAt').lean();
        cloudDrafts.push({id: `legacy-${legacy._id}`, title: legacy.title, content: legacy.content, number: legacy.chapter_number,
          targetChapterId: legacy.targetChapterId ? String(legacy.targetChapterId) : undefined,
          baseUpdatedAt: target?.updatedAt, legacyBaseHash: legacy.baseHash, updatedAt: legacy.updatedAt});
        maxNumber = Math.max(maxNumber, legacy.chapter_number);
      }
    }
    res.set('Cache-Control', 'private, no-store').json({work: {reference: work, title: (book || manuscript).title,
      bookId: book ? String(book._id) : null, visibility: book?.visibility || 'private'}, cloudDrafts, published, total, maxNumber, publishedDraftIds: [...publishedIds]});
  }));

  app.post('/api/writer/workspace/:reference/publish', auth.authenticate, asyncRoute(async (req, res) => {
    const body = req.body;
    if (!body || Object.keys(body).some(key => !['id', 'title', 'content', 'number', 'targetChapterId', 'baseUpdatedAt', 'legacyBaseHash'].includes(key)) ||
        typeof body.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(body.id) ||
        (body.targetChapterId && !/^[a-f0-9]{24}$/.test(body.targetChapterId))) fail(400, '发布参数无效');
    const data = validateChapter({...body, chapter_number: body.number});
    const hash = contentHash(body);
    let result;
    await mongoose.connection.transaction(async session => {
      await User.updateOne({_id: req.user.id}, {$inc: {contentVersion: 1}}, {session});
      const resolved = await resolve(req.params.reference, req.user.id, session);
      let {book} = resolved;
      const {manuscript, work} = resolved;
      const receiptId = `${req.user.id}:${work}:${body.id}`;
      const receipt = await WriterPublication.findById(receiptId).session(session);
      if (receipt) {
        if (receipt.hash !== hash) fail(409, '此草稿已经发布，请重新打开已发布章节后修改');
        result = {bookId: String(receipt.bookId), chapterId: String(receipt.chapterId)}; return;
      }
      if (!book) {
        if (body.targetChapterId) fail(400, '章节不存在');
        [book] = await Book.create([{title: manuscript.title, description: manuscript.description, cover_image: manuscript.cover_image,
          category: manuscript.category || '未分类', author: req.account.username, author_id: req.user.id}], {session});
        manuscript.publishedBookId = book._id;
        // Keep unpublished imported chapters recoverable after the first chapter is published.
        manuscript.revision++; manuscript.savedHash = undefined;
        await manuscript.save({session});
      } else book = await lockBook(book._id, req.user, session);
      let chapter;
      if (body.targetChapterId) {
        chapter = await Chapter.findOne({_id: body.targetChapterId, bookId: book._id, deletedAt: null}).session(session);
        if (!chapter || chapter.chapter_number !== body.number) fail(409, '原章节已删除或编号发生变化');
        if (chapter.updatedAt.toISOString() !== body.baseUpdatedAt) fail(409, '章节已在另一页面更新，请重新打开后修改；本地草稿仍保留');
        if (body.legacyBaseHash) {
          // Legacy drafts use a content hash. Never replace a chapter changed since that draft began.
          // Installations with externalized bodies provide their existing storage adapter.
          const content = typeof chapter.content === 'string' ? chapter.content : await (await import('../services/chapter-storage.js')).readChapterBody(chapter);
          if (contentHash({title: chapter.title, content, number: chapter.chapter_number}) !== body.legacyBaseHash)
            fail(409, '旧草稿对应的原章节已更新，请核对已发布正文后再修改');
        }
        const sameBody = typeof chapter.content === 'string' ? chapter.content === data.content : chapter.get('contentSha256') === crypto.createHash('sha256').update(data.content).digest('hex');
        if (!sameBody) await chargeQuota(req.user, data.content.length, session);
        Object.assign(chapter, data);
        chapter.set('contentKey', undefined); chapter.set('contentSha256', undefined);
        await chapter.save({session});
      } else {
        if (await Chapter.exists({bookId: book._id, chapter_number: data.chapter_number}).session(session)) fail(409, '此章节序号已被使用，请返回草稿箱重新编号后发布');
        await chargeQuota(req.user, data.content.length, session);
        const source = /^manuscript-\d+$/.test(body.id) && manuscript?.chapters[Number(body.id.slice(11))];
        [chapter] = await Chapter.create([{...data, bookId: book._id, ...(source ? {volume_title: source.volumeTitle, volume_number: source.volumeNumber} : {})}], {session});
      }
      if (/^legacy-[a-f0-9]{24}$/.test(body.id)) await ChapterDraft.updateOne({_id: body.id.slice(7), bookId: book._id, owner: req.user.id}, {$set: {publishedChapterId: chapter._id}}, {session});
      await WriterPublication.create([{_id: receiptId, owner: req.user.id, work, draftId: body.id, hash, bookId: book._id, chapterId: chapter._id}], {session});
      result = {bookId: String(book._id), chapterId: String(chapter._id)};
    });
    res.set('Cache-Control', 'private, no-store').json(result);
  }));
}
