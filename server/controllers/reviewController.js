import mongoose from 'mongoose';
import Review from '../models/Review.js';
import Book from '../models/Book.js';
import {pagination} from '../services/pagination.js';
import {asyncRoute} from '../security.js';
import {fail} from '../services/content.js';

export const getReviews=asyncRoute(async(req,res)=>{
  const bookId=req.params.id,{limit,skip}=pagination(req.query);
  if(!await Book.exists({_id:bookId,deletedAt:null}))fail(404,'作品不可用');
  const [rows,distribution]=await Promise.all([
    Review.find({book:bookId}).sort({createdAt:-1,_id:1}).skip(skip).limit(limit).populate('user','username avatar').maxTimeMS(3000).lean(),
    Review.aggregate([{$match:{book:new mongoose.Types.ObjectId(bookId)}},{$group:{_id:'$rating',count:{$sum:1}}}]).option({maxTimeMS:3000}),
  ]);
  res.set('X-Total-Count',String(distribution.reduce((sum,row)=>sum+row.count,0)));
  res.set('X-Review-Distribution',JSON.stringify(Object.fromEntries(distribution.map(row=>[row._id,row.count]))));
  res.json(rows.map(row=>({...row,user:row.user||{_id:'',username:'已注销用户',avatar:''}})));
});
