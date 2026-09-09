import crypto from 'node:crypto';
import mongoose from 'mongoose';
import rateLimit from 'express-rate-limit';
import ForumPost from '../models/ForumPost.js';
import {asyncRoute} from '../security.js';
import {dayKey,fail} from '../services/content.js';
const schema=new mongoose.Schema({_id:String,postId:mongoose.Schema.Types.ObjectId,expiresAt:{type:Date,expires:0}});
const Receipt=mongoose.models.ForumViewReceipt||mongoose.model('ForumViewReceipt',schema);
export function forumViewRoutes(app,auth){
  app.post('/api/forum/posts/:id/views',rateLimit({windowMs:60000,limit:30}),asyncRoute(async(req,res)=>{
    let visitor=req.cookies.visitor;
    if(typeof visitor!=='string'||!/^[a-f0-9]{64}$/.test(visitor)){visitor=crypto.randomBytes(32).toString('hex');res.cookie('visitor',visitor,{httpOnly:true,sameSite:'lax',secure:process.env.APP_ENV==='production',maxAge:31536000000,path:'/'});}
    const userId=await auth.optionalUserId(req);
    const id=crypto.createHash('sha256').update(`${userId?'user:'+userId:'visitor:'+visitor}:${req.params.id}:${dayKey()}`).digest('hex');
    let counted=false;
    await mongoose.connection.transaction(async session=>{
      counted=false;
      if(await Receipt.exists({_id:id}).session(session))return;
      if(!await ForumPost.findOneAndUpdate({_id:req.params.id},{$inc:{views:1}},{session}))fail(404,'帖子不存在');
      await Receipt.create([{_id:id,postId:req.params.id,expiresAt:new Date(Date.now()+8*86400000)}],{session});counted=true;
    });res.json({counted});
  }));
}
