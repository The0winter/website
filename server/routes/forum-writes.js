import mongoose from 'mongoose';
import rateLimit from 'express-rate-limit';
import {asyncRoute,safeHtml} from '../security.js';
import {fail} from '../services/content.js';
import User from '../models/User.js';
import Post from '../models/ForumPost.js';
import Reply from '../models/ForumReply.js';
import Comment from '../models/ForumReplyComment.js';

const plain=value=>safeHtml(value).replace(/<[^>]*>/g,'').trim();
function fields(body,allowed){if(!body||Object.keys(body).some(k=>!allowed.includes(k)))fail(400,'包含不可修改字段');}
function content(value,max){if(typeof value!=='string'||value.length>max*4)fail(400,'内容长度无效');const html=safeHtml(value),text=plain(html);if(!text||text.length>max)fail(400,'内容长度无效');return html;}
const recent=()=>({$gte:new Date(Date.now()-60000)});
async function lockActor(req,session){if(!(await User.updateOne({_id:req.user.id,isBanned:{$ne:true}},{$inc:{contentVersion:1}},{session})).matchedCount)fail(403,'账户不可用');}
export function forumWrites(app,auth){
  const limiter=n=>rateLimit({windowMs:3600000,limit:n,message:{error:'提交过于频繁，请稍后重试'}});
  app.post('/api/forum/posts',auth.authenticate,limiter(20),asyncRoute(async(req,res)=>{
    fields(req.body,['title','content','type','tags']);
    const title=plain(req.body.title),html=content(req.body.content,30000),type=req.body.type||'question';
    if(!title||title.length>120||!['question','article'].includes(type)||(type==='question'&&!/[?？]\s*$/.test(title)))fail(400,'提问标题须以问号结尾，标题最多120字');
    const tags=Array.isArray(req.body.tags)?[...new Set(req.body.tags.map(t=>plain(t).slice(0,20)).filter(Boolean))].slice(0,8):[];
    let post;
    await mongoose.connection.transaction(async session=>{
      await lockActor(req,session);
      if(await Post.exists({author:req.user.id,title,type,createdAt:recent()}).session(session))fail(429,'请勿重复发布');
      [post]=await Post.create([{title,content:html,type,tags,summary:plain(html).slice(0,100),author:req.user.id}],{session});
    });res.status(201).json({...post.toObject(),id:String(post._id)});
  }));
  app.post('/api/forum/posts/:id/replies',auth.authenticate,limiter(40),asyncRoute(async(req,res)=>{
    fields(req.body,['content']);const html=content(req.body.content,12000);let reply;
    await mongoose.connection.transaction(async session=>{
      await lockActor(req,session);
      if(!await Post.findByIdAndUpdate(req.params.id,{$inc:{replyCount:1},$set:{lastReplyAt:new Date()}},{session}))fail(404,'帖子不存在');
      if(await Reply.exists({postId:req.params.id,author:req.user.id,content:html,createdAt:recent()}).session(session))fail(429,'请勿重复回答');
      [reply]=await Reply.create([{postId:req.params.id,author:req.user.id,content:html}],{session});
    });res.status(201).json({...reply.toObject(),id:String(reply._id)});
  }));
  app.post('/api/forum/replies/:id/comments',auth.authenticate,limiter(80),asyncRoute(async(req,res)=>{
    fields(req.body,['content','parentCommentId']);const html=content(req.body.content,2000);let comment;
    const parentId=req.body.parentCommentId;
    if(parentId&&!(typeof parentId==='string'&&/^[a-f0-9]{24}$/i.test(parentId)))fail(400,'父评论ID无效');
    await mongoose.connection.transaction(async session=>{
      await lockActor(req,session);
      const reply=await Reply.findByIdAndUpdate(req.params.id,{$inc:{comments:1}},{session});if(!reply)fail(404,'回答不存在');
      if(parentId){
        const parent=await Comment.findOne({_id:parentId,replyId:reply._id}).session(session);
        if(!parent)fail(404,'父评论不存在');if(parent.parentCommentId)fail(400,'仅支持二级评论');
        await Comment.updateOne({_id:parentId},{$inc:{replyCount:1}},{session});
      }
      if(await Comment.exists({replyId:reply._id,author:req.user.id,content:html,createdAt:recent()}).session(session))fail(429,'请勿重复评论');
      [comment]=await Comment.create([{postId:reply.postId,replyId:reply._id,parentCommentId:parentId||null,author:req.user.id,content:html}],{session});
    });res.status(201).json({...comment.toObject(),id:String(comment._id)});
  }));
  for(const [path,Model] of [['posts',Post],['replies',Reply],['comments',Comment]]){
    app.post(`/api/forum/${path}/:id/like`,auth.authenticate,asyncRoute(async(req,res)=>{
      fields(req.body||{},['liked']);if(req.body?.liked!==undefined&&typeof req.body.liked!=='boolean')fail(400,'点赞状态无效');
      const actor=new mongoose.Types.ObjectId(req.user.id),list={$ifNull:['$likedBy',[]]},contains={$in:[actor,list]};
      const remove=req.body?.liked===undefined?contains:!req.body.liked;
      const doc=await Model.findByIdAndUpdate(req.params.id,[{$set:{likedBy:{$cond:[remove,{$setDifference:[list,[actor]]},{$setUnion:[list,[actor]]}]}}},{$set:{likes:{$size:'$likedBy'}}}],{new:true});
      if(!doc)fail(404,'内容不存在');res.json({liked:doc.likedBy.some(id=>String(id)===req.user.id),votes:doc.likes,postId:doc.postId});
    }));
  }
}
