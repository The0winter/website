import mongoose from 'mongoose';
import Book from '../models/Book.js';
import Chapter from '../models/Chapter.js';
import Bookmark from '../models/Bookmark.js';
import Review from '../models/Review.js';
import Media from '../models/Media.js';
import User from '../models/User.js';
import Operation from '../models/Operation.js';
import {asyncRoute} from '../security.js';
import {createChapter,lockBook,chargeQuota,validateChapter,fail,jsonDoc,contentHash} from '../services/content.js';

const fields=(body,allowed)=>{if(Object.keys(body).some(k=>!allowed.includes(k)))fail(400,'包含不可修改字段');};
export function contentRoutes(app,auth) {
  app.post('/api/books',auth.authenticate,asyncRoute(async(req,res)=>{
    fields(req.body,['title','description','cover_image','category','status']);
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
        if(!/^\/api\/media\/[a-f0-9]{24}$/.test(req.body.cover_image))fail(400,'封面必须来自本人上传');
        const asset=await Media.findOneAndUpdate({_id:req.body.cover_image.split('/').pop(),owner:req.user.id,deleted:false},{$inc:{referenceVersion:1}},{session});
        if(!asset)fail(400,'封面必须来自本人上传');
      }
      [book]=await Book.create([{...req.body,author:req.account.username,author_id:req.user.id}],{session});
      await Operation.updateOne({_id:operationId},{$set:{hash,resultId:book._id,expiresAt:new Date(Date.now()+7*86400000)}},{session,upsert:true});
    });
    res.status(201).json(jsonDoc(book));
  }));
  app.patch('/api/books/:id',auth.authenticate,asyncRoute(async(req,res)=>{
    fields(req.body,['title','description','cover_image','category','status']);
    let result;
    await mongoose.connection.transaction(async session=>{
      const book=await lockBook(req.params.id,req.user,session);
      if(req.body.cover_image && req.body.cover_image!==book.cover_image) {
        if(!/^\/api\/media\/[a-f0-9]{24}$/.test(req.body.cover_image))fail(400,'封面必须来自本人上传');
        const asset=await Media.findOneAndUpdate({_id:req.body.cover_image.split('/').pop(),owner:req.user.id,deleted:false},{$inc:{referenceVersion:1}},{session});
        if(!asset)fail(400,'封面必须来自本人上传');
      }
      Object.assign(book,req.body);result=await book.save({session});
    });res.json(jsonDoc(result));
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
    res.status(201).json(jsonDoc(await createChapter(req.user,req.body.bookId,req.body)));
  }));
  app.patch('/api/chapters/:id',auth.authenticate,asyncRoute(async(req,res)=>{
    fields(req.body,['title','content','chapter_number']);
    let result;
    await mongoose.connection.transaction(async session=>{
      const chapter=await Chapter.findById(req.params.id).session(session);if(!chapter)fail(404,'章节不存在');
      await lockBook(chapter.bookId,req.user,session);
      const data=validateChapter({...chapter.toObject(),...req.body});
      if(data.content!==chapter.content)await chargeQuota(req.user,data.content.length,session);
      Object.assign(chapter,data);result=await chapter.save({session});
    });res.json(jsonDoc(result));
  }));
  app.delete('/api/chapters/:id',auth.authenticate,asyncRoute(async(req,res)=>{
    await mongoose.connection.transaction(async session=>{
      const chapter=await Chapter.findById(req.params.id).session(session);if(!chapter)fail(404,'章节不存在');
      await lockBook(chapter.bookId,req.user,session);
      // Retain the original bytes and ID for a later explicit recovery operation.
      chapter.deletedAt=new Date();await chapter.save({session});
    });res.json({success:true});
  }));
  const own=(req,res,next)=>req.params.userId===req.user.id?next():res.status(403).json({error:'只能访问本人书架'});
  app.get('/api/users/:userId/bookmarks',auth.authenticate,own,asyncRoute(async(req,res)=>{
    const bookmarks=await Bookmark.find({user_id:req.user.id}).populate('bookId');
    res.json(bookmarks.map(b=>({...b.toObject(),bookId:b.bookId?.deletedAt?null:b.bookId})));
  }));
  app.get('/api/users/:userId/bookmarks/:bookId/check',auth.authenticate,own,asyncRoute(async(req,res)=>res.json({isBookmarked:!!await Bookmark.exists({user_id:req.user.id,bookId:req.params.bookId})})));
  app.post('/api/users/:userId/bookmarks',auth.authenticate,own,asyncRoute(async(req,res)=>{
    if(!await Book.exists({_id:req.body.bookId,deletedAt:null}))fail(404,'作品不可用');
    const b=await Bookmark.findOneAndUpdate({user_id:req.user.id,bookId:req.body.bookId},{$setOnInsert:{user_id:req.user.id,bookId:req.body.bookId}},{new:true,upsert:true});res.json(b);
  }));
  app.delete('/api/users/:userId/bookmarks/:bookId',auth.authenticate,own,asyncRoute(async(req,res)=>{await Bookmark.deleteOne({user_id:req.user.id,bookId:req.params.bookId});res.json({success:true});}));
  app.post('/api/books/:id/reviews',auth.authenticate,asyncRoute(async(req,res)=>{
    const {rating,content}=req.body;
    if(!Number.isInteger(rating)||rating<1||rating>5||typeof content!=='string'||!content.trim()||content.length>4000)fail(400,'评分须为1—5整数，评价1—4000字');
    let review;
    await mongoose.connection.transaction(async session=>{
      // Serialize review summaries against all other mutations on this book.
      await lockBook(req.params.id,{role:'import'},session);
      review=await Review.findOneAndUpdate({book:req.params.id,user:req.user.id},{$set:{rating,content}},{new:true,upsert:true,runValidators:true,session});
      const [stats]=await Review.aggregate([{$match:{book:new mongoose.Types.ObjectId(req.params.id)}},{$group:{_id:null,rating:{$avg:'$rating'},count:{$sum:1}}}]).session(session);
      await Book.updateOne({_id:req.params.id},{$set:{rating:stats.rating,numReviews:stats.count}},{session});
    });res.status(201).json(await Review.findById(review._id).populate('user','username avatar'));
  }));
}
