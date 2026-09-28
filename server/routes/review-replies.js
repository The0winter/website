import crypto from 'node:crypto';
import mongoose from 'mongoose';
import rateLimit from 'express-rate-limit';
import Review from '../models/Review.js';
import ReviewReply from '../models/ReviewReply.js';
import {readLiveBook} from '../services/book-version.js';
import {replyJson} from '../services/review-replies.js';
import {asyncRoute} from '../security.js';
import {fail} from '../services/content.js';

const validId = value => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
const base = '/api/books/:id/reviews/:reviewId/replies';
async function parent(req, res) {
  if (!validId(req.params.reviewId)) fail(400, '评论编号无效');
  await readLiveBook(req.params.id, res.locals.workAccess);
  const row = await Review.findOne({_id:req.params.reviewId, book:req.params.id, content:/\S/}).select('_id').maxTimeMS(3000).lean();
  if (!row) fail(404, '评论不存在');
  return row;
}
export function reviewReplyRoutes(app, auth) {
  const writes = rateLimit({windowMs:60000, limit:20, message:{error:'回复太频繁，请稍后再试'}});
  app.get(base, asyncRoute(async (req, res) => {
    const review = await parent(req, res);
    const filter = {review:review._id, book:new mongoose.Types.ObjectId(req.params.id)};
    let cursor;
    if (req.query.cursor !== undefined) {
      try {
        if (typeof req.query.cursor !== 'string' || req.query.cursor.length > 256 || !/^[\w-]+$/.test(req.query.cursor)) throw Error();
        cursor = JSON.parse(Buffer.from(req.query.cursor, 'base64url').toString());
        if (cursor.review !== req.params.reviewId || !validId(cursor.id) || typeof cursor.time !== 'string' || !Number.isFinite(Date.parse(cursor.time))) throw Error();
      } catch { fail(400, '回复游标无效'); }
    }
    const after = cursor ? {$or:[{createdAt:{$gt:new Date(cursor.time)}}, {createdAt:new Date(cursor.time), _id:{$gt:new mongoose.Types.ObjectId(cursor.id)}}]} : {};
    const [rows, total] = await Promise.all([
      ReviewReply.find({...filter,...after}).sort({createdAt:1,_id:1}).limit(11).populate('user','username avatar avatarColor').maxTimeMS(3000).lean(),
      ReviewReply.countDocuments(filter).maxTimeMS(3000),
    ]);
    const items = rows.slice(0,10), last = items.at(-1);
    res.set('Cache-Control','private, no-store').json({items:items.map(replyJson), total,
      cursor: rows.length > 10 ? Buffer.from(JSON.stringify({review:req.params.reviewId, time:last.createdAt.toISOString(), id:String(last._id)})).toString('base64url') : null});
  }));
  app.post(base, auth.authenticate, writes, asyncRoute(async (req, res) => {
    if (!req.body || Object.keys(req.body).some(key => !['content','requestId'].includes(key))) fail(400, '回复字段无效');
    const {content, requestId} = req.body;
    if (typeof content !== 'string' || !content.trim() || Array.from(content.trim()).length > 1000) fail(400, '回复需为1至1000字');
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,64}$/.test(requestId)) fail(400, '请求编号无效');
    const review = await parent(req, res);
    // The built-in unique _id index makes retries safe even before secondary indexes exist.
    const id = crypto.createHash('sha256').update(req.user.id + ':' + requestId).digest('hex').slice(0,24);
    let row;
    try {
      row = await ReviewReply.findOneAndUpdate({_id:id}, {$setOnInsert:{book:req.params.id, review:review._id, user:req.user.id, content:content.trim(), createdAt:new Date(), updatedAt:new Date()}}, {upsert:true,new:true,runValidators:true,setDefaultsOnInsert:true,timestamps:false});
    } catch (error) {
      if (error.code !== 11000) throw error;
      row = await ReviewReply.findById(id);
    }
    if (!row || String(row.review) !== req.params.reviewId || String(row.book) !== req.params.id || String(row.user) !== req.user.id || row.content !== content.trim()) fail(409, '请求编号已用于其他回复');
    await row.populate('user','username avatar avatarColor');
    const total = await ReviewReply.countDocuments({review:review._id}).maxTimeMS(3000);
    res.status(201).set('Cache-Control','private, no-store').json({reply:replyJson(row), total});
  }));
}
