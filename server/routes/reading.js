import crypto from 'node:crypto';
import mongoose from 'mongoose';
import rateLimit from 'express-rate-limit';
import Book from '../models/Book.js';
import Chapter from '../models/Chapter.js';
import UserDaily from '../models/UserDaily.js';
import {asyncRoute} from '../security.js';
import {dayKey,fail} from '../services/content.js';

const receiptSchema=new mongoose.Schema({_id:String,bookId:mongoose.Schema.Types.ObjectId,chapterId:mongoose.Schema.Types.ObjectId,day:String,expiresAt:{type:Date,expires:0}});
const Receipt=mongoose.models.ReadReceipt||mongoose.model('ReadReceipt',receiptSchema);
const dailySchema=new mongoose.Schema({_id:String,bookId:mongoose.Schema.Types.ObjectId,day:String,views:Number,expiresAt:{type:Date,expires:0}});
dailySchema.index({day:1,bookId:1});
const Daily=mongoose.models.ReadDaily||mongoose.model('ReadDaily',dailySchema);
const integer=(value,fallback,max)=>{const n=value===undefined?fallback:Number(value);if(!Number.isSafeInteger(n)||n<1||n>max)fail(400,'分页参数无效');return n;};
const formatted=doc=>({...doc,id:String(doc._id)});
export function readingRoutes(app,auth) {
  app.get('/api/sitemap-books',asyncRoute(async(req,res)=>{
    const page=integer(req.query.page,1,100000);
    const books=await Book.find({deletedAt:null}).select('_id updatedAt').sort({_id:1}).skip((page-1)*100).limit(100).lean();
    const counts=await Chapter.aggregate([{$match:{bookId:{$in:books.map(b=>b._id)},deletedAt:null}},{$group:{_id:'$bookId',count:{$sum:1}}}]).option({maxTimeMS:5000});
    const byId=new Map(counts.map(c=>[String(c._id),c.count]));res.json(books.map(b=>({...b,chapters:byId.get(String(b._id))||0})));
  }));
  app.get('/api/books',asyncRoute(async(req,res)=>{
    const {orderBy='views',order='desc',author_id,q,category}=req.query;
    if(!['views','weekly_views','daily_views','monthly_views','updatedAt','createdAt','rating','composite'].includes(orderBy)||!['asc','desc'].includes(order))fail(400,'排序参数无效');
    const limit=integer(req.query.limit,20,100),page=integer(req.query.page,1,100000);
    const filter={deletedAt:null};
    if(author_id){if(typeof author_id!=='string'||!/^[a-f0-9]{24}$/i.test(author_id))fail(400,'作者ID无效');filter.author_id=new mongoose.Types.ObjectId(author_id);}
    if(category)filter.category=String(category).slice(0,80);
    if(q){if(typeof q!=='string'||q.length>100)fail(400,'搜索关键词过长');const escaped=q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');filter.$or=[{title:{$regex:escaped,$options:'i'}},{author:{$regex:escaped,$options:'i'}}];}
    let books;
    if(orderBy==='composite')books=await Book.aggregate([{$match:filter},{$addFields:{score:{$add:[{$multiply:[{$ifNull:['$rating',0]},60]},{$multiply:[{$ifNull:['$weekly_views',0]},0.4]}]}}},{$sort:{score:order==='asc'?1:-1,_id:1}},{$skip:(page-1)*limit},{$limit:limit},{$unset:'score'}]).option({maxTimeMS:3000});
    else books=await Book.find(filter).sort({[orderBy]:order==='asc'?1:-1,_id:1}).skip((page-1)*limit).limit(limit).populate('author_id','username').maxTimeMS(3000).lean();
    res.set('X-Total-Count',String(await Book.countDocuments(filter).maxTimeMS(3000)));
    res.json(books.map(formatted));
  }));
  app.get('/api/books/sitemap-pool',asyncRoute(async(req,res)=>{
    const page=integer(req.query.page,1,100000);
    const books=await Book.find({deletedAt:null}).select('_id updatedAt').sort({_id:1}).skip((page-1)*100).limit(100).lean();res.json(books);
  }));
  app.get('/api/books/:bookId/chapters',asyncRoute(async(req,res)=>{
    if(!await Book.exists({_id:req.params.bookId,deletedAt:null}))fail(404,'作品不可用');
    const limit=integer(req.query.limit,100,200),page=integer(req.query.page,1,100000);
    const filter={bookId:req.params.bookId,deletedAt:null};
    // (bookId, chapter_number) is unique: no extra _id sort that forces a full catalog sort.
    const chapters=await Chapter.find(filter).select('title chapter_number published_at bookId word_count').sort({chapter_number:req.query.order==='desc'?-1:1}).skip((page-1)*limit).limit(limit).maxTimeMS(3000).lean();
    res.set('X-Total-Count',String(await Chapter.countDocuments(filter)));res.json(chapters.map(formatted));
  }));
  app.post('/api/books/:id/views',rateLimit({windowMs:60000,limit:30,message:{error:'阅读上报过于频繁'}}),asyncRoute(async(req,res)=>{
    const chapter=await Chapter.findOne({_id:req.body.chapterId,bookId:req.params.id,deletedAt:null});
    if(!chapter)fail(404,'章节与作品不匹配');
    let visitor=req.cookies.visitor;
    if(typeof visitor!=='string'||!/^[a-f0-9]{64}$/.test(visitor)){visitor=crypto.randomBytes(32).toString('hex');res.cookie('visitor',visitor,{httpOnly:true,sameSite:'lax',secure:process.env.APP_ENV==='production',maxAge:31536000000,path:'/'});}
    const day=dayKey(),bookId=req.params.id;
    const userId=await auth.optionalUserId(req);
    const identity=userId ? `user:${userId}` : `visitor:${visitor}`;
    const id=crypto.createHash('sha256').update(`${identity}:${bookId}:${chapter._id}:${day}`).digest('hex');
    let counted=false;
    await mongoose.connection.transaction(async session=>{
      counted=false;
      if(await Receipt.exists({_id:id}).session(session))return;
      if(!await Book.findOneAndUpdate({_id:bookId,deletedAt:null},{$inc:{views:1},$set:{statisticsVersion:2}},{session}))fail(404,'作品不可用');
      await Receipt.create([{_id:id,bookId,chapterId:chapter._id,day,expiresAt:new Date(Date.now()+8*86400000)}],{session});
      await Daily.updateOne({_id:`${bookId}:${day}`},{$setOnInsert:{bookId,day,expiresAt:new Date(Date.now()+62*86400000)},$inc:{views:1}},{session,upsert:true});counted=true;
      if(userId)await UserDaily.updateOne({_id:`${userId}:${day}`},{$setOnInsert:{userId,day,expiresAt:new Date(Date.now()+62*86400000)},$inc:{views:1}},{session,upsert:true});
    });res.json({success:true,counted});
  }));
}
