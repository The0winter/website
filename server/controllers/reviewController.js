import mongoose from 'mongoose';
import Review from '../models/Review.js';
import {ratingSummary} from '../services/book-statistics.js';
import {readLiveBook} from '../services/book-version.js';
import {pagination} from '../services/pagination.js';
import {asyncRoute} from '../security.js';
import {fail} from '../services/content.js';

function readCursor(value,bookId) {
  if(value===undefined)return null;
  if(typeof value!=='string'||value.length>256||!/^[\w-]+$/.test(value))fail(400,'评论游标无效');
  try {
    const row=JSON.parse(Buffer.from(value,'base64url').toString('utf8'));
    if(row.book!==bookId || typeof row.time!=='string' || !Number.isFinite(Date.parse(row.time)) || !/^[a-f\d]{24}$/.test(row.id))throw Error();
    return {createdAt:new Date(row.time),id:new mongoose.Types.ObjectId(row.id)};
  }catch{fail(400,'评论游标无效');}
}

export const getReviews=asyncRoute(async(req,res)=>{
  const bookId=req.params.id,{limit,skip}=pagination(req.query);
  const book = await readLiveBook(bookId,res.locals.workAccess);
  const comments={book:bookId,content:/\S/};
  const cursor=readCursor(req.query.cursor,bookId);
  const filter=cursor?{...comments,$or:[{createdAt:{$lt:cursor.createdAt}},{createdAt:cursor.createdAt,_id:{$gt:cursor.id}}]}:comments;
  const [rows,distribution,commentCount]=await Promise.all([
    Review.find(filter).sort({createdAt:-1,_id:1}).skip(cursor?0:skip).limit(limit+1).populate('user','username avatar').maxTimeMS(3000).lean(),
    Review.aggregate([{$match:{book:new mongoose.Types.ObjectId(bookId),isTestData:{$ne:true}}},{$group:{_id:'$rating',count:{$sum:1}}}]).option({maxTimeMS:3000}),
    Review.countDocuments(comments).maxTimeMS(3000),
  ]);
  const total = distribution.reduce((sum,row)=>sum+row.count,0);
  const average = total ? distribution.reduce((sum,row)=>sum+row._id*row.count,0)/total : 0;
  const summary=ratingSummary(book,average,total);
  const page=rows.slice(0,limit),last=page.at(-1);
  res.set('X-Next-Cursor',rows.length>limit&&last?Buffer.from(JSON.stringify({book:bookId,time:last.createdAt.toISOString(),id:String(last._id)})).toString('base64url'):'');
  res.set('Cache-Control','private, no-store');
  res.set('X-Total-Count',String(commentCount));
  res.set('X-Book-Rating',String(summary.rating));
  res.set('X-Rating-Summary',JSON.stringify(summary));
  res.set('X-Review-Distribution',JSON.stringify(Object.fromEntries(distribution.map(row=>[row._id,row.count]))));
  res.json(page.map(row=>({...row,user:row.user||{_id:'',username:'已注销用户',avatar:''}})));
});
