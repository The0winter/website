import mongoose from 'mongoose';
import Review from '../models/Review.js';
import {combinedRating} from '../services/book-statistics.js';
import {readLiveBook} from '../services/book-version.js';
import {pagination} from '../services/pagination.js';
import {asyncRoute} from '../security.js';

export const getReviews=asyncRoute(async(req,res)=>{
  const bookId=req.params.id,{limit,skip}=pagination(req.query);
  const book = await readLiveBook(bookId,res.locals.workAccess);
  const [rows,distribution]=await Promise.all([
    Review.find({book:bookId}).sort({createdAt:-1,_id:1}).skip(skip).limit(limit).populate('user','username avatar').maxTimeMS(3000).lean(),
    Review.aggregate([{$match:{book:new mongoose.Types.ObjectId(bookId)}},{$group:{_id:'$rating',count:{$sum:1}}}]).option({maxTimeMS:3000}),
  ]);
  const total = distribution.reduce((sum,row)=>sum+row.count,0);
  const average = total ? distribution.reduce((sum,row)=>sum+row._id*row.count,0)/total : 0;
  res.set('X-Total-Count',String(total));
  res.set('X-Book-Rating',String(combinedRating(book,average,total)));
  res.set('X-Review-Distribution',JSON.stringify(Object.fromEntries(distribution.map(row=>[row._id,row.count]))));
  res.json(rows.map(row=>({...row,user:row.user||{_id:'',username:'已注销用户',avatar:''}})));
});
