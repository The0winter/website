import crypto from 'node:crypto';
import multer from 'multer';
import sharp from 'sharp';
import rateLimit from 'express-rate-limit';
import Media from '../models/Media.js';
import User from '../models/User.js';
import Book from '../models/Book.js';
import mongoose from 'mongoose';
import { asyncRoute, publicUser } from '../security.js';

const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:1572864,files:1,fields:0}});
export async function validAsset(url,owner) {
  if (url === '') return true;
  const match=typeof url==='string' && url.match(/^\/api\/media\/([a-f0-9]{24})$/);
  return !!match && !!await Media.exists({_id:match[1],owner,deleted:false});
}
export function mediaRoutes(app,auth) {
  let active = 0;
  app.post('/api/upload/cover',auth.authenticate,rateLimit({windowMs:60000,limit:10,message:{error:'上传过于频繁'}}),(req,res,next)=>{
    if (active >= 2) return res.status(503).json({error:'图片处理中，请稍后重试'});
    active++;let released=false;const release=()=>{if(!released){released=true;active--;}};res.once('finish',release);res.once('close',release);next();
  },upload.single('file'),asyncRoute(async(req,res)=>{
    if (!req.file) return res.status(400).json({error:'请选择图片'});
    let content;
    try {
      const input=sharp(req.file.buffer,{limitInputPixels:16000000,failOn:'error'}).timeout({seconds:5});
      const metadata=await input.metadata();
      if (!['jpeg','png','webp'].includes(metadata.format) || (metadata.pages || 1)>1 || !metadata.width || !metadata.height) return res.status(400).json({error:'仅支持静态 JPG、PNG、WebP 图片'});
      content=await input.rotate().resize({width:1400,height:1400,fit:'inside',withoutEnlargement:true}).webp({quality:85}).toBuffer();
    } catch { return res.status(400).json({error:'图片损坏、格式不符或尺寸过大'}); }
    const media=await Media.create({owner:req.user.id,content,mime:'image/webp',sha256:crypto.createHash('sha256').update(content).digest('hex')});
    res.status(201).json({url:`/api/media/${media._id}`});
  }));
  app.get('/api/media/:id',asyncRoute(async(req,res)=>{
    const media=await Media.findOne({_id:req.params.id,deleted:false}).select('+content');
    if (!media) return res.status(404).end();
    res.set('Cache-Control','public, max-age=3600').type(media.mime).send(media.content);
  }));
  app.delete('/api/upload/cover',auth.authenticate,asyncRoute(async(req,res)=>{
    const match=typeof req.body.url==='string' && req.body.url.match(/^\/api\/media\/([a-f0-9]{24})$/);
    if (!match) return res.status(403).json({error:'旧图片归属未确认，不能自动删除'});
    await mongoose.connection.transaction(async session=>{
      const media=await Media.findOneAndUpdate({_id:match[1],owner:req.user.id},{$inc:{referenceVersion:1}},{new:true,session});
      if (!media) throw Object.assign(new Error('无权删除'),{status:403});
      if (await Book.exists({cover_image:req.body.url}).session(session) || await User.exists({avatar:req.body.url}).session(session)) throw Object.assign(new Error('图片仍在使用'),{status:409});
      media.deleted=true;await media.save({session});
    });res.json({success:true});
  }));
  app.patch('/api/users/:userId',auth.authenticate,asyncRoute(async(req,res)=>{
    if (req.params.userId!==req.user.id) return res.status(403).json({error:'只能修改本人资料'});
    if (Object.keys(req.body).some(k=>!['avatar'].includes(k)) || typeof req.body.avatar!=='string' || (req.body.avatar!==''&&!/^\/api\/media\/[a-f0-9]{24}$/.test(req.body.avatar))) return res.status(400).json({error:'头像必须来自本人上传'});
    let user;
    await mongoose.connection.transaction(async session=>{
      if(req.body.avatar){const asset=await Media.findOneAndUpdate({_id:req.body.avatar.split('/').pop(),owner:req.user.id,deleted:false},{$inc:{referenceVersion:1}},{session});if(!asset)throw Object.assign(new Error('头像必须来自本人上传'),{status:400});}
      user=await User.findByIdAndUpdate(req.user.id,{$set:{avatar:req.body.avatar}},{new:true,runValidators:true,session});
    });
    res.json({success:true,user:publicUser(user)});
  }));
}
