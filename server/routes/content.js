import mongoose from 'mongoose';
import {readChapterBody,chapterResponse} from '../services/chapter-storage.js';
import Book from '../models/Book.js';
import Chapter from '../models/Chapter.js';
import Bookmark from '../models/Bookmark.js';
import {recordBookMilestones} from '../services/book-milestones.js';
import Review from '../models/Review.js';
import {combinedRating} from '../services/book-statistics.js';
import {claimMedia,retireUnreferencedCover} from '../services/media-reference.js';
import {finishCoverRetirement} from '../services/cover-retention.js';
import {trashChapter} from '../services/writing-trash.js';
import User from '../models/User.js';
import Operation from '../models/Operation.js';
import {workAccess} from '../services/work-access.js';
import {readLiveBook} from '../services/book-version.js';
import {writerRoutes} from './writer.js';
import {reviewReactionRoutes} from './review-reactions.js';
import {pagination} from '../services/pagination.js';
import {asyncRoute} from '../security.js';
import {createChapter,lockBook,chargeQuota,validateChapter,fail,jsonDoc,contentHash} from '../services/content.js';

const fields=(body,allowed)=>{if(Object.keys(body).some(k=>!allowed.includes(k)))fail(400,'包含不可修改字段');};
function bookFields(body){
  fields(body,['title','description','cover_image','category','status','visibility']);
  if(body.visibility!==undefined&&!['public','private'].includes(body.visibility))fail(400,'作品可见范围无效');
  for(const [key,max] of [['title',200],['description',5000],['cover_image',2000],['category',80],['status',20]])if(body[key]!==undefined&&(typeof body[key]!=='string'||body[key].length>max))fail(400,'作品字段类型或长度无效');
  if(body.title!==undefined&&!body.title.trim())fail(400,'标题不能为空');
}
export function contentRoutes(app,auth) {
  workAccess(app,auth);
  reviewReactionRoutes(app,auth);
  writerRoutes(app,auth);
  app.get('/api/books/:id/reviews/mine',auth.authenticate,asyncRoute(async(req,res)=>{
    await readLiveBook(req.params.id,res.locals.workAccess);
    res.set('Cache-Control','private, no-store');
    res.json(await Review.findOne({book:req.params.id,user:req.user.id}).populate('user','username avatar'));
  }));
  app.post('/api/books',auth.authenticate,asyncRoute(async(req,res)=>{
    bookFields(req.body);
    if(typeof req.body.title!=='string' || !req.body.title.trim() || req.body.title.length>200)fail(400,'标题无效');
    const key=req.headers['idempotency-key'];
    if(typeof key!=='string'||!/^[a-zA-Z0-9_-]{16,128}$/.test(key))fail(400,'创建作品需要幂等键');
    const operationId=`book:${req.user.id}:${key}`, hash=contentHash(req.body);
    let book;
    await mongoose.connection.transaction(async session=>{
      await User.updateOne({_id:req.user.id},{$inc:{contentVersion:1}},{session});
      const operation=await Operation.findOne({_id:operationId,expiresAt:{$gt:new Date()}}).session(session);
      if(operation){if(operation.hash!==hash)fail(409,'幂等键对应不同请求');book=await Book.findById(operation.resultId).session(session);return;}
      if(req.body.cover_image) {
        const asset=await claimMedia(req.body.cover_image,req.user.id,session);
        if(!asset)fail(400,'封面必须来自本人上传');
      }
      [book]=await Book.create([{...req.body,author:req.account.username,author_id:req.user.id}],{session});
      await Operation.updateOne({_id:operationId},{$set:{hash,resultId:book._id,expiresAt:new Date(Date.now()+7*86400000)}},{session,upsert:true});
    });
    res.status(201).json(jsonDoc(book));
  }));
  app.patch('/api/books/:id',auth.authenticate,asyncRoute(async(req,res)=>{
    bookFields(req.body);
    let result,retiredCover;
    await mongoose.connection.transaction(async session=>{
      retiredCover=undefined;
      const book=await lockBook(req.params.id,req.user,session);
      const previousCover=book.cover_image;
      if(req.body.cover_image && req.body.cover_image!==book.cover_image) {
        const asset=await claimMedia(req.body.cover_image,req.user.id,session);
        if(!asset)fail(400,'封面必须来自本人上传');
      }
      Object.assign(book,req.body);result=await book.save({session});
      if(previousCover!==book.cover_image)retiredCover=await retireUnreferencedCover(previousCover,session);
    });
    const coverCleanup=await finishCoverRetirement(retiredCover,{storage:app.locals.coverStorage});
    res.json({...jsonDoc(result),coverCleanup});
  }));
  app.delete('/api/books/:id',auth.authenticate,asyncRoute(async(req,res)=>{
    await mongoose.connection.transaction(async session=>{const book=await lockBook(req.params.id,req.user,session,{includeDeleted:true});book.deletedAt=book.deletedAt||new Date();await book.save({session});});
    res.json({success:true});
  }));
  app.post('/api/books/:id/restore',auth.authenticate,asyncRoute(async(req,res)=>{
    if(req.user.role!=='admin')fail(403,'需要管理员');
    await mongoose.connection.transaction(async session=>{const book=await lockBook(req.params.id,req.user,session,{includeDeleted:true});book.deletedAt=null;await book.save({session});});
    res.json({success:true});
  }));
  app.post('/api/chapters',auth.authenticate,asyncRoute(async(req,res)=>{
    fields(req.body,['bookId','title','content','chapter_number','chapterNumber']);
    res.status(201).json(await chapterResponse(await createChapter(req.user,req.body.bookId,req.body)));
  }));
  app.patch('/api/chapters/:id',auth.authenticate,asyncRoute(async(req,res)=>{
    fields(req.body,['title','content','chapter_number']);
    let result;
    await mongoose.connection.transaction(async session=>{
      const chapter=await Chapter.findById(req.params.id).session(session);if(!chapter||chapter.deletedAt)fail(404,'章节不存在或已下架，请先恢复');
      await lockBook(chapter.bookId,req.user,session);
      const currentContent=await readChapterBody(chapter);
      const data=validateChapter({...chapter.toObject(),content:currentContent,...req.body});
      if(data.content!==currentContent)await chargeQuota(req.user,data.content.length,session);
      Object.assign(chapter,data);chapter.contentKey=undefined;chapter.contentSha256=undefined;result=await chapter.save({session});
    });res.json(await chapterResponse(result));
  }));
  app.delete('/api/chapters/:id',auth.authenticate,asyncRoute(async(req,res)=>{
    const chapter=await trashChapter(req.user,req.params.id);
    res.json({success:true,trashUntil:chapter.trashUntil});
  }));
  app.post('/api/chapters/:id/restore',auth.authenticate,asyncRoute(async(req,res)=>{
    const chapter=await trashChapter(req.user,req.params.id,{restore:true});
    res.json(await chapterResponse(chapter));
  }));
  const own=(req,res,next)=>req.params.userId===req.user.id?next():res.status(403).json({error:'只能访问本人书架'});
  app.get('/api/users/:userId/bookmarks',auth.authenticate,own,asyncRoute(async(req,res)=>{
    const {limit,skip}=pagination(req.query),filter={user_id:req.user.id};
    const bookmarks=await Bookmark.find(filter).sort({_id:-1}).skip(skip).limit(limit).populate('bookId').maxTimeMS(3000);
    res.set('X-Total-Count',String(await Bookmark.countDocuments(filter).maxTimeMS(3000)));
    res.set('Cache-Control','private, no-store');
    res.json(bookmarks.map(b=>({...b.toObject(),unavailableBookId:String(b.populated('bookId')||''),bookId:(b.bookId?.deletedAt||b.bookId?.visibility==='private')?null:b.bookId})));
  }));
  app.get('/api/users/:userId/bookmarks/:bookId/check',auth.authenticate,own,asyncRoute(async(req,res)=>res.json({isBookmarked:!!await Bookmark.exists({user_id:req.user.id,bookId:req.params.bookId})})));
  app.post('/api/users/:userId/bookmarks',auth.authenticate,own,asyncRoute(async(req,res)=>{
    if(typeof req.body.bookId!=='string'||!/^[a-f\d]{24}$/i.test(req.body.bookId))fail(400,'作品ID无效');
    let bookmark;
    await mongoose.connection.transaction(async session=>{
      const book=await Book.findOneAndUpdate({_id:req.body.bookId,deletedAt:null,visibility:{$ne:'private'}},{$inc:{milestoneVersion:1}},{session,timestamps:false});
      if(!book)fail(404,'作品不可用');
      const filter={user_id:req.user.id,bookId:book._id};
      const favorites=await Bookmark.countDocuments({bookId:book._id}).session(session);
      bookmark=await Bookmark.findOne(filter).session(session);
      const added=!bookmark;
      if(added)[bookmark]=await Bookmark.create([filter],{session});
      await recordBookMilestones(book,{favorites},{favorites:favorites+Number(added)},session);
    });
    res.json(bookmark);
  }));
  app.delete('/api/users/:userId/bookmarks/:bookId',auth.authenticate,own,asyncRoute(async(req,res)=>{
    await mongoose.connection.transaction(async session=>{
      const book=await Book.findOneAndUpdate({_id:req.params.bookId},{$inc:{milestoneVersion:1}},{session,timestamps:false});
      if(book){
        const favorites=await Bookmark.countDocuments({bookId:book._id}).session(session);
        // Preserve any pre-existing achievements before removing the bookmark.
        await recordBookMilestones(book,{favorites},{},session);
      }
      await Bookmark.deleteOne({user_id:req.user.id,bookId:req.params.bookId},{session});
    });res.json({success:true});
  }));
  app.post('/api/books/:id/reviews',auth.authenticate,asyncRoute(async(req,res)=>{
    fields(req.body,['rating','content']);
    const {rating}=req.body;
    const content=Object.hasOwn(req.body,'content') ? req.body.content : '';
    if(!Number.isInteger(rating)||rating<1||rating>5||typeof content!=='string'||content.length>4000)fail(400,'评分须为1—5整数，短评可不填，最多4000字');
    let review;
    await mongoose.connection.transaction(async session=>{
      // Serialize review summaries against all other mutations on this book.
      const book = await lockBook(req.params.id,{role:'import'},session);
      // Omitting content edits only the score; an explicit empty string removes
      // the reader's own text without deleting their vote.
      const update={rating};
      if(Object.hasOwn(req.body,'content'))update.content=content.trim();
      review=await Review.findOneAndUpdate({book:req.params.id,user:req.user.id},{$set:update},{new:true,upsert:true,runValidators:true,session});
      const [stats]=await Review.aggregate([{$match:{book:new mongoose.Types.ObjectId(req.params.id)}},{$group:{_id:null,rating:{$avg:'$rating'},count:{$sum:1}}}]).session(session);
      const comments=await Review.countDocuments({book:req.params.id,content:/\S/}).session(session);
      await Book.updateOne({_id:req.params.id},{$set:{rating:combinedRating(book,stats?.rating,stats?.count),numRatings:stats?.count || 0,numReviews:comments}},{session});
    });res.status(201).json(await Review.findById(review._id).populate('user','username avatar'));
  }));
}
