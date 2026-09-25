import mongoose from 'mongoose';
import Book from '../models/Book.js';
import {ensureBookStatistics} from '../services/initial-book-statistics.js';
import Chapter from '../models/Chapter.js';
import ChapterDraft from '../models/ChapterDraft.js';
import Manuscript from '../models/Manuscript.js';
import User from '../models/User.js';
import WriterPublication from '../models/WriterPublication.js';
import WriterDraft from '../models/WriterDraft.js';
import WriterBlob from '../models/WriterBlob.js';
import WriterDiscard from '../models/WriterDiscard.js';
import {moveDraftToTrash, purgeExpiredWritingTrash} from '../services/writing-trash.js';
import {createWritingStorage} from '../services/writing-storage.js';
import {cleanupDraftObjects, draftKey, draftJson, saveCloudDraft} from '../services/writing-drafts.js';
import {asyncRoute} from '../security.js';
import {chargeQuota, contentHash, fail, lockBook, validateChapter} from '../services/content.js';

async function resolve(reference, actor, session = null) {
  const owner = actor.id;
  let manuscript, book;
  if (/^m_[a-zA-Z0-9_-]{16,128}$/.test(reference)) {
    manuscript = await Manuscript.findOne({_id: `${owner}:${reference.slice(2)}`, owner}).session(session);
    if (!manuscript) fail(404, '作品不存在');
    if (manuscript.publishedBookId) book = await Book.findOne({_id: manuscript.publishedBookId, author_id: owner, deletedAt: null}).session(session);
    if (manuscript.publishedBookId && !book) fail(404, '作品已删除');
  } else if (/^b_[a-f0-9]{24}$/.test(reference)) {
    book = await Book.findOne({_id: reference.slice(2), ...(actor.role === 'admin' ? {} : {author_id: owner}), deletedAt: null}).session(session);
    if (!book) fail(404, '作品不存在或无权查看');
    manuscript = await Manuscript.findOne({owner, publishedBookId: book._id}).session(session);
  } else fail(400, '作品编号无效');
  const work = manuscript ? `m_${manuscript._id.split(':').at(-1)}` : `b_${book._id}`;
  return {manuscript, book, work};
}

export function writingWorkspaceRoutes(app, auth) {
  let storage, cleaning = false;
  const getStorage = () => app.locals.writingStorage || (storage ||= createWritingStorage());
  // Seven-day trash and retired draft objects tolerate an hourly sweep.
  // This processes retired objects; it does not autosave drafts.
  const cleanup = setInterval(async () => {
    if (cleaning || !app.locals.writingCleanupEnabled || mongoose.connection.readyState !== 1) return;
    cleaning = true;
    try {
      await purgeExpiredWritingTrash();
      if (storage || app.locals.writingStorage || process.env.CHAPTER_STORAGE === 'r2') await cleanupDraftObjects(getStorage());
    }
    catch {console.warn('Draft object cleanup deferred');}
    finally {cleaning = false;}
  }, 60 * 60 * 1000);
  cleanup.unref();
  app.locals.stopWritingCleanup = () => clearInterval(cleanup);

  for (const action of ['delete', 'restore']) app.post(`/api/writer/workspace/:reference/trash/drafts/:draftId/${action}`, auth.authenticate, asyncRoute(async (req, res) => {
    if (!Number.isSafeInteger(req.body?.revision) || req.body.revision < 1) fail(400, '草稿版本无效，请刷新后重试');
    let result;
    await mongoose.connection.transaction(async session => {
      await User.updateOne({_id: req.user.id}, {$inc: {contentVersion: 1}}, {session});
      const {work} = await resolve(req.params.reference, req.user, session);
      const draft = await WriterDraft.findById(draftKey(req.user, work, req.params.draftId)).session(session);
      if (!draft || draft.published) fail(404, '草稿不存在或已过期清除');
      if (action === 'delete' && draft.deleted) {result = draft; return;}
      if (action === 'restore' && !draft.deleted && draft.revision === req.body.revision + 1) {result = draft; return;}
      if (draft.revision !== req.body.revision) fail(409, '草稿已在另一页面更新，请刷新后重试');
      if (action === 'delete') result = await moveDraftToTrash(draft, session);
      else {
        if (!draft.deleted || !draft.trashUntil || draft.trashUntil <= new Date()) fail(410, '已超过七天恢复期限');
        draft.deleted = false; draft.deletedAt = undefined; draft.trashUntil = undefined; draft.revision++; draft.savedHash = undefined;
        result = await draft.save({session});
      }
    });
    res.set('Cache-Control', 'private, no-store').json(draftJson(result));
  }));

  app.put('/api/writer/workspace/:reference/drafts/:draftId', auth.authenticate, asyncRoute(async (req, res) => {
    if (req.body?.id !== req.params.draftId) fail(400, '草稿编号不一致');
    const result = await saveCloudDraft({actor: req.user, reference: req.params.reference, body: req.body, resolve, storage: getStorage()});
    res.set('Cache-Control', 'private, no-store').json(result);
  }));
  app.get('/api/writer/workspace/:reference/drafts/:draftId', auth.authenticate, asyncRoute(async (req, res) => {
    const {work} = await resolve(req.params.reference, req.user);
    const draft = await WriterDraft.findById(draftKey(req.user, work, req.params.draftId)).lean();
    if (!draft || draft.deleted || draft.published) fail(404, '草稿已删除或发布');
    res.set('Cache-Control', 'private, no-store').json(draftJson(draft, await getStorage().read(draft)));
  }));
  app.get('/api/writer/workspace/:reference', auth.authenticate, asyncRoute(async (req, res) => {
    const {manuscript, book, work} = await resolve(req.params.reference, req.user);
    const page = Number(req.query.page || 1);
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000) fail(400, '页码无效');
    const search = req.query.search || '', order = req.query.order || 'desc';
    if (typeof search !== 'string' || search.length > 100 || !['asc', 'desc'].includes(order)) fail(400, '筛选参数无效');
    const receipts = await WriterPublication.find({owner: req.user.id, work}).select('draftId').lean();
    const removed = await WriterDiscard.find({owner: req.user.id, work}).select('draftId').lean();
    const removedIds = new Set(removed.map(row => row.draftId));
    const publishedIds = new Set(receipts.map(receipt => receipt.draftId));
    const cloudDrafts = (manuscript?.chapters || []).flatMap((chapter, index) => {
      const id = `manuscript-${index}`;
      return publishedIds.has(id) || removedIds.has(id) || !chapter.title && !chapter.content ? [] : [{id, title: chapter.title, content: chapter.content, number: index + 1,
        volumeTitle: chapter.volumeTitle, volumeNumber: chapter.volumeNumber, updatedAt: manuscript.updatedAt}];
    });
    let published = [], total = 0, maxNumber = manuscript?.chapters.length || 0, recycledChapters = [];
    if (book) {
      const filter = {bookId: book._id, deletedAt: null, ...(search ? {title: {$regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i'}} : {})};
      const [rows, count, last, legacy] = await Promise.all([
        Chapter.find(filter).select('_id title chapter_number word_count updatedAt').sort({chapter_number: order === 'asc' ? 1 : -1}).skip((page - 1) * 50).limit(50).maxTimeMS(5000).lean(),
        Chapter.countDocuments(filter),
        // Deleted numbers remain reserved by the catalog's unique index.
        Chapter.findOne({bookId: book._id}).sort({chapter_number: -1}).select('chapter_number').lean(),
        ChapterDraft.findOne({bookId: book._id, owner: req.user.id, publishedChapterId: null}).lean(),
      ]);
      published = rows.map(row => ({id: String(row._id), title: row.title, number: row.chapter_number, words: row.word_count, updatedAt: row.updatedAt}));
      recycledChapters = await Chapter.find({bookId: book._id, deletedAt: {$ne: null}, trashUntil: {$gt: new Date()}}).select('_id title chapter_number word_count updatedAt deletedAt trashUntil').sort({deletedAt: -1}).lean();
      total = count; maxNumber = Math.max(maxNumber, last?.chapter_number || 0);
      if (legacy && !publishedIds.has(`legacy-${legacy._id}`) && !removedIds.has(`legacy-${legacy._id}`)) {
        const target = legacy.targetChapterId && await Chapter.findById(legacy.targetChapterId).select('updatedAt').lean();
        cloudDrafts.push({id: `legacy-${legacy._id}`, title: legacy.title, content: legacy.content, number: legacy.chapter_number,
          targetChapterId: legacy.targetChapterId ? String(legacy.targetChapterId) : undefined,
          baseUpdatedAt: target?.updatedAt, legacyBaseHash: legacy.baseHash, updatedAt: legacy.updatedAt});
        maxNumber = Math.max(maxNumber, legacy.chapter_number);
      }
    }
    const saved = await WriterDraft.find({owner: req.user.id, work}).sort({number: -1}).lean();
    const savedIds = new Set(saved.map(row => row.draftId));
    for (const row of saved) maxNumber = Math.max(maxNumber, row.number);
    const trash = [
      ...saved.filter(row => row.deleted && row.trashUntil > new Date()).map(row => ({...draftJson(row), id: `draft:${row.draftId}`, sourceId: row.draftId, kind: 'draft'})),
      ...recycledChapters.map(row => ({id: `chapter:${row._id}`, sourceId: String(row._id), kind: 'chapter', title: row.title, number: row.chapter_number, words: row.word_count, updatedAt: row.updatedAt, deletedAt: row.deletedAt, trashUntil: row.trashUntil})),
    ].sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
    res.set('Cache-Control', 'private, no-store').json({work: {reference: work, title: (book || manuscript).title,
      bookId: book ? String(book._id) : null, visibility: book?.visibility || 'private'},
      cloudDrafts: [...cloudDrafts.filter(row => !savedIds.has(row.id)), ...saved.filter(row => !row.published).map(row => draftJson(row))],
      published, total, maxNumber, publishedDraftIds: [...publishedIds], removedDraftIds: [...removedIds], trash});
  }));

  app.post('/api/writer/workspace/:reference/publish', auth.authenticate, asyncRoute(async (req, res) => {
    const body = req.body;
    if (!body || Object.keys(body).some(key => !['id', 'title', 'content', 'number', 'targetChapterId', 'baseUpdatedAt', 'legacyBaseHash', 'cloudRevision'].includes(key)) ||
        typeof body.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(body.id) ||
        (body.targetChapterId && !/^[a-f0-9]{24}$/.test(body.targetChapterId))) fail(400, '发布参数无效');
    const data = validateChapter({...body, chapter_number: body.number});
    const {cloudRevision, ...publicationBody} = body;
    const hash = contentHash(publicationBody);
    const initial = await resolve(req.params.reference, req.user);
    const prior = await WriterPublication.findById(`${req.user.id}:${initial.work}:${body.id}`).lean();
    if (prior) {
      if (prior.hash !== hash) fail(409, '此草稿已经发布，请重新打开已发布章节后修改');
      return res.set('Cache-Control', 'private, no-store').json({bookId: String(prior.bookId), chapterId: String(prior.chapterId)});
    }
    if (!body.targetChapterId && initial.book && await Chapter.exists({bookId: initial.book._id, chapter_number: data.chapter_number})) {
      const receipt = await WriterPublication.findById(`${req.user.id}:${initial.work}:${body.id}`).lean();
      if (receipt?.hash === hash) return res.set('Cache-Control', 'private, no-store').json({bookId: String(receipt.bookId), chapterId: String(receipt.chapterId)});
      fail(409, '此章节序号已被使用，请返回草稿箱重新编号后发布');
    }
    let cloud;
    try {
      cloud = await saveCloudDraft({actor: req.user, reference: req.params.reference,
        body: {...body, revision: cloudRevision ?? 0}, resolve, storage: getStorage()});
    } catch (error) {
      // Another identical publication can finish between the first receipt read and draft save.
      const receipt = await WriterPublication.findById(`${req.user.id}:${initial.work}:${body.id}`).lean();
      if (receipt?.hash === hash) return res.set('Cache-Control', 'private, no-store').json({bookId: String(receipt.bookId), chapterId: String(receipt.chapterId)});
      throw error;
    }
    const storedBody = await getStorage().publish(data.content);
    let result;
    await mongoose.connection.transaction(async session => {
      await User.updateOne({_id: req.user.id}, {$inc: {contentVersion: 1}}, {session});
      const resolved = await resolve(req.params.reference, req.user, session);
      let {book} = resolved;
      const {manuscript, work} = resolved;
      const receiptId = `${req.user.id}:${work}:${body.id}`;
      const receipt = await WriterPublication.findById(receiptId).session(session);
      if (receipt) {
        if (receipt.hash !== hash) fail(409, '此草稿已经发布，请重新打开已发布章节后修改');
        result = {bookId: String(receipt.bookId), chapterId: String(receipt.chapterId)}; return;
      }
      const draft = await WriterDraft.findById(draftKey(req.user, work, body.id)).session(session);
      if (!draft || draft.deleted || draft.published || draft.revision !== cloud.cloudRevision)
        fail(409, '草稿已在另一页面更新，请核对后重新发布');
      if (!book) {
        if (body.targetChapterId) fail(400, '章节不存在');
        [book] = await Book.create([{title: manuscript.title, description: manuscript.description, cover_image: manuscript.cover_image,
          category: manuscript.category || '未分类', author: req.account.username, author_id: req.user.id}], {session});
        manuscript.publishedBookId = book._id;
        // Keep unpublished imported chapters recoverable after the first chapter is published.
        manuscript.revision++; manuscript.savedHash = undefined;
        await manuscript.save({session});
      } else book = await lockBook(book._id, req.user, session);
      await ensureBookStatistics(book,{session});
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
        Object.assign(chapter, data, storedBody);
        chapter.set('content', undefined);
        await chapter.save({session});
      } else {
        if (await Chapter.exists({bookId: book._id, chapter_number: data.chapter_number}).session(session)) fail(409, '此章节序号已被使用，请返回草稿箱重新编号后发布');
        const source = /^manuscript-\d+$/.test(body.id) && manuscript?.chapters[Number(body.id.slice(11))];
        [chapter] = await Chapter.create([{...data, ...storedBody, content: undefined, bookId: book._id, ...(source ? {volume_title: source.volumeTitle, volume_number: source.volumeNumber} : {})}], {session});
      }
      await chargeQuota(req.user, 0, session);
      if (draft.contentKey) await WriterBlob.updateOne({_id: draft.contentKey}, {$set: {retireAt: new Date(Date.now() + 300000)}}, {session});
      draft.published = true; draft.revision++; draft.contentKey = undefined; draft.contentSha256 = undefined;
      await draft.save({session});
      if (/^legacy-[a-f0-9]{24}$/.test(body.id)) await ChapterDraft.updateOne({_id: body.id.slice(7), bookId: book._id, owner: req.user.id}, {$set: {publishedChapterId: chapter._id}}, {session});
      await WriterPublication.create([{_id: receiptId, owner: req.user.id, work, draftId: body.id, hash, bookId: book._id, chapterId: chapter._id}], {session});
      result = {bookId: String(book._id), chapterId: String(chapter._id)};
    });
    res.set('Cache-Control', 'private, no-store').json(result);
  }));
  app.use('/api/writer/workspace', (error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.status || (error.code === 11000 ? 409 : 500);
    res.status(status).json({error: status < 500 && error.status ? error.message : '草稿同步暂时失败，请重试；当前文字仍保留'});
  });
}
