import crypto from 'node:crypto';
import mongoose from 'mongoose';
import Book from '../models/Book.js';
import {dayKey} from '../services/content.js';
const Job=mongoose.models.Job||mongoose.model('Job',new mongoose.Schema({_id:String,owner:String,leaseUntil:Date,status:String,lastError:String,finishedAt:Date,expiresAt:{type:Date,expires:0}}));
export async function updateStatistics(now=new Date()) {
  const id='statistics:'+Math.floor(+now/60000),owner=crypto.randomUUID();
  let lease;
  try {lease=await Job.findOneAndUpdate({_id:id,status:{$ne:'done'},$or:[{leaseUntil:{$lt:now}},{leaseUntil:{$exists:false}}]},{$set:{owner,status:'running',leaseUntil:new Date(+now+120000),expiresAt:new Date(+now+30*86400000)}},{new:true,upsert:true});}
  catch(e){if(e.code===11000)return {claimed:false};throw e;}
  if(!lease)return {claimed:false};
  try {
    const day=dayKey(now),calendar=new Date(day+'T00:00:00Z');calendar.setUTCDate(calendar.getUTCDate()-((calendar.getUTCDay()+6)%7));
    const week=calendar.toISOString().slice(0,10),month=day.slice(0,7)+'-01',start=week<month?week:month;
    const totals=await mongoose.connection.collection('readdailies').aggregate([{$match:{day:{$gte:start,$lte:day}}},{$group:{_id:'$bookId',daily:{$sum:{$cond:[{$eq:['$day',day]},'$views',0]}},weekly:{$sum:{$cond:[{$gte:['$day',week]},'$views',0]}},monthly:{$sum:{$cond:[{$gte:['$day',month]},'$views',0]}}}}]).toArray();
    const byBook=new Map(totals.map(t=>[String(t._id),t]));let count=0;
    for await(const book of Book.find({deletedAt:null}).select('_id').cursor()) {
      const current=await Job.exists({_id:id,owner,status:'running',leaseUntil:{$gt:new Date()}});if(!current)throw new Error('Statistics lease expired');
      const t=byBook.get(String(book._id));
      await Book.updateOne({_id:book._id},[{$set:{statisticsLegacy:{$ifNull:['$statisticsLegacy',{daily:'$daily_views',weekly:'$weekly_views',monthly:'$monthly_views',switchedAt:now}]},daily_views:t?.daily||0,weekly_views:t?.weekly||0,monthly_views:t?.monthly||0,statisticsVersion:2}}]);count++;
      if(count%100===0)await Job.updateOne({_id:id,owner},{$set:{leaseUntil:new Date(Date.now()+120000)}});
    }
    await Job.updateOne({_id:id,owner},{$set:{status:'done',finishedAt:new Date()}});return {claimed:true,count};
  } catch(e){await Job.updateOne({_id:id,owner},{$set:{status:'failed',lastError:e.name,leaseUntil:new Date(0)}});throw e;}
}
