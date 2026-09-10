import mongoose from 'mongoose';
import rateLimit from 'express-rate-limit';
import Chapter from '../models/Chapter.js';
import Book from '../models/Book.js';
import ParagraphComment from '../models/ParagraphComment.js';
import {readChapterBody} from '../services/chapter-storage.js';
import {asyncRoute} from '../security.js';
import {fail} from '../services/content.js';
import {readerParagraphs} from '../../shared/reader-paragraphs.mjs';

const base = '/api/chapters/:id/paragraph-comments';
async function visibleChapter(id) {
  const chapter = await Chapter.findOne({_id:id, deletedAt:null}).maxTimeMS(3000).lean();
  if (!chapter || !await Book.exists({_id:chapter.bookId, deletedAt:null}).maxTimeMS(3000)) fail(404, '章节不可用');
  return chapter;
}
async function paragraphFor(req) {
  if (!/^[a-f0-9]{16}-[1-9]\d{0,5}$/.test(req.params.paragraphKey)) fail(400, '段落编号无效');
  const chapter = await visibleChapter(req.params.id);
  const paragraph = readerParagraphs(await readChapterBody(chapter), chapter.title, chapter.chapter_number)
    .find(row => row.key === req.params.paragraphKey);
  if (!paragraph) fail(409, '段落内容已更新，请刷新章节后重试');
  return {chapter, paragraph};
}
function commentJson(row) {
  return {id:String(row._id), content:row.content, createdAt:row.createdAt,
    user:row.user ? {id:String(row.user._id), username:row.user.username, avatar:row.user.avatar || ''} : null};
}
export function paragraphCommentRoutes(app, auth) {
  const writes = rateLimit({windowMs:60000, limit:20, message:{error:'评论太频繁，请稍后再试'}});
  app.get(base, asyncRoute(async(req,res) => {
    const chapter = await visibleChapter(req.params.id);
    const counts = await ParagraphComment.aggregate([
      {$match:{chapter:chapter._id}}, {$group:{_id:'$paragraphKey', count:{$sum:1}}},
    ]).option({maxTimeMS:3000});
    res.set('Cache-Control','no-store').json({counts:Object.fromEntries(counts.map(row => [row._id, row.count]))});
  }));
  app.get(base+'/:paragraphKey', asyncRoute(async(req,res) => {
    const {chapter, paragraph} = await paragraphFor(req);
    const page = req.query.page === undefined ? 1 : Number(req.query.page);
    if (!Number.isSafeInteger(page) || page < 1 || page > 10000) fail(400, '分页参数无效');
    const filter = {chapter:chapter._id, paragraphKey:paragraph.key, paragraphText:paragraph.text};
    const [rows,total] = await Promise.all([
      ParagraphComment.find(filter).sort({createdAt:-1,_id:-1}).skip((page-1)*20).limit(20).populate('user','username avatar').maxTimeMS(3000).lean(),
      ParagraphComment.countDocuments(filter).maxTimeMS(3000),
    ]);
    res.set('Cache-Control','no-store').json({paragraph, items:rows.map(commentJson), total, page, pageSize:20});
  }));
  app.post(base+'/:paragraphKey', auth.authenticate, writes, asyncRoute(async(req,res) => {
    if (!req.body || Object.keys(req.body).some(key => !['content','requestId'].includes(key))) fail(400, '评论字段无效');
    const {content,requestId} = req.body;
    if (typeof content !== 'string' || !content.trim() || content.trim().length > 1000) fail(400, '评论需为1至1000字');
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,64}$/.test(requestId)) fail(400, '请求编号无效');
    const {chapter, paragraph} = await paragraphFor(req);
    const identity = {user:req.user.id, requestId};
    let row;
    try {
      row = await ParagraphComment.findOneAndUpdate(identity, {$setOnInsert:{...identity,
        book:chapter.bookId, chapter:chapter._id, paragraphKey:paragraph.key, paragraphText:paragraph.text, content:content.trim(),
      }}, {upsert:true,new:true,runValidators:true,setDefaultsOnInsert:true});
    } catch (error) {
      if (error.code !== 11000) throw error;
      row = await ParagraphComment.findOne(identity);
    }
    if (!row || String(row.chapter)!==String(chapter._id) || row.paragraphKey!==paragraph.key || row.content!==content.trim()) fail(409, '请求编号已用于其他评论');
    await row.populate('user','username avatar');
    res.status(201).set('Cache-Control','no-store').json(commentJson(row));
  }));
  app.delete(base+'/:paragraphKey/:commentId', auth.authenticate, asyncRoute(async(req,res) => {
    if (!mongoose.isObjectIdOrHexString(req.params.commentId)) fail(400, '评论编号无效');
    await visibleChapter(req.params.id);
    const row = await ParagraphComment.findOne({_id:req.params.commentId, chapter:req.params.id, paragraphKey:req.params.paragraphKey});
    if (!row) fail(404, '评论不存在');
    if (String(row.user)!==req.user.id && req.user.role!=='admin') fail(403, '只能删除自己的评论');
    await ParagraphComment.deleteOne({_id:row._id});
    res.json({success:true});
  }));
}
