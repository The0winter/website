import crypto from 'node:crypto';
import mongoose from 'mongoose';
import Book from '../models/Book.js';
import {dayKey} from '../services/content.js';
import Job from '../models/Job.js';
import User from '../models/User.js';
import UserDaily from '../models/UserDaily.js';
export async function updateStatistics(now=new Date(),shouldStop=()=>false) {
  const checkStop=()=>{if(shouldStop())throw Object.assign(new Error('Statistics paused'),{name:'AbortError'});};
  const id='statistics',slot=Math.floor(+now/60000),owner=crypto.randomUUID(),clock=new Date();
  let lease;
  try {lease=await Job.findOneAndUpdate({_id:id,$and:[{$or:[{slot:{$lt:slot}},{slot:{$exists:false}},{slot,status:{$ne:'done'}}]},{$or:[{leaseUntil:{$lt:clock}},{leaseUntil:{$exists:false}}]}]},{$set:{owner,slot,status:'running',leaseUntil:new Date(+clock+120000),expiresAt:new Date(+clock+30*86400000)}},{new:true,upsert:true});}
  catch(e){if(e.code===11000)return {claimed:false};throw e;}
  if(!lease)return {claimed:false};
  try {
    const day=dayKey(now),calendar=new Date(day+'T00:00:00Z');calendar.setUTCDate(calendar.getUTCDate()-((calendar.getUTCDay()+6)%7));
    const week=calendar.toISOString().slice(0,10),month=day.slice(0,7)+'-01',start=week<month?week:month;
    const totals=await mongoose.connection.collection('readdailies').aggregate([{$match:{day:{$gte:start,$lte:day}}},{$group:{_id:'$bookId',daily:{$sum:{$cond:[{$eq:['$day',day]},'$views',0]}},weekly:{$sum:{$cond:[{$gte:['$day',week]},'$views',0]}},monthly:{$sum:{$cond:[{$gte:['$day',month]},'$views',0]}}}}]).toArray();
    const byBook=new Map(totals.map(t=>[String(t._id),t]));let count=0;
    for await(const book of Book.find({deletedAt:null}).select('_id').cursor()) {
      checkStop();
      const t=byBook.get(String(book._id));
      await mongoose.connection.transaction(async session=>{
        // Updating the lease in the same transaction fences a worker whose lease was taken over.
        const current=await Job.updateOne({_id:id,owner,status:'running',leaseUntil:{$gt:new Date()}},{$set:{leaseUntil:new Date(Date.now()+120000)}},{session});
        if(!current.matchedCount)throw new Error('Statistics lease expired');
        await Book.updateOne({_id:book._id},[{$set:{statisticsLegacy:{$ifNull:['$statisticsLegacy',{daily:'$daily_views',weekly:'$weekly_views',monthly:'$monthly_views',switchedAt:now}]},daily_views:t?.daily||0,weekly_views:t?.weekly||0,monthly_views:t?.monthly||0,statisticsVersion:2}}],{session});
      });count++;
    }
    const startDate=new Date(day+'T00:00:00Z');startDate.setUTCDate(startDate.getUTCDate()-29);
    const historyStart=startDate.toISOString().slice(0,10);
    startDate.setUTCDate(startDate.getUTCDate()+23);const scoreStart=startDate.toISOString().slice(0,10);
    let users=0;
    for await(const user of User.find({}).select('_id').cursor()){
      checkStop();
      const rows=await UserDaily.find({userId:user._id,day:{$gte:historyStart,$lte:day}}).sort({day:1}).limit(30).lean();
      const today=rows.find(row=>row.day===day),score=rows.filter(row=>row.day>=scoreStart).reduce((sum,row)=>sum+(row.views||0)+(row.uploads||0)*50,0);
      await mongoose.connection.transaction(async session=>{
        const current=await Job.updateOne({_id:id,owner,status:'running',leaseUntil:{$gt:new Date()}},{$set:{leaseUntil:new Date(Date.now()+120000)}},{session});
        if(!current.matchedCount)throw new Error('Statistics lease expired');
        await User.updateOne({_id:user._id},[{$set:{statisticsLegacy:{$ifNull:['$statisticsLegacy',{stats:'$stats',weekly_score:'$weekly_score',switchedAt:now}]},'stats.today_views':today?.views||0,'stats.today_uploads':today?.uploads||0,'stats.history':rows.filter(row=>row.day<day).map(row=>({date:new Date(row.day+'T00:00:00+08:00'),views:row.views||0,uploads:row.uploads||0})),weekly_score:score,statisticsVersion:2}}],{session});
      });users++;
    }
    await Job.updateOne({_id:id,owner},{$set:{status:'done',finishedAt:new Date(),leaseUntil:new Date(0)}});return {claimed:true,count,users};
  } catch(e){await Job.updateOne({_id:id,owner},{$set:{status:e.name==='AbortError'?'paused':'failed',lastError:e.name,leaseUntil:new Date(0)}});throw e;}
}
