import crypto from 'node:crypto';
import mongoose from 'mongoose';
import Book from '../models/Book.js';
import Chapter from '../models/Chapter.js';
import {asyncRoute} from '../security.js';
import {fail,validateChapter,lockBook,contentHash} from '../services/content.js';

export function importRoutes(app) {
  const credential=(req,res,next)=>{
    const supplied=req.headers['x-import-secret'],expected=process.env.IMPORT_SECRET;
    if(typeof supplied!=='string'||!expected||expected.length<32||Buffer.byteLength(supplied)!==Buffer.byteLength(expected)||!crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(expected)))return res.status(403).json({error:'导入凭据无效'});
    next();
  };
  app.post('/api/admin/check-sync',credential,asyncRoute(async(req,res)=>{
    if(typeof req.body.sourceUrl!=='string')fail(400,'必须提供稳定 sourceUrl，不能按书名认领作品');
    const book=await Book.findOne({sourceUrl:req.body.sourceUrl,importManaged:true,deletedAt:null});
    if(!book)return res.json({needsFullUpload:true,bookId:null,chapters:[]});
    const offset=Number(req.body.offset||0);if(!Number.isSafeInteger(offset)||offset<0)fail(400,'offset无效');
    const chapters=await Chapter.find({bookId:book._id}).select('chapter_number title content').sort({chapter_number:1}).skip(offset).limit(200).lean();
    res.json({bookId:String(book._id),chapters:chapters.map(c=>({id:String(c._id),number:c.chapter_number,hash:contentHash({title:c.title,content:c.content})})),nextOffset:chapters.length===200?offset+200:null});
  }));
  app.post('/api/admin/upload-book',credential,asyncRoute(async(req,res)=>{
    const data=req.body;
    if(typeof data.sourceUrl!=='string'||!/^https?:\/\//.test(data.sourceUrl)||data.sourceUrl.length>2000||typeof data.title!=='string'||!data.title||data.title.length>200||!Array.isArray(data.chapters)||data.chapters.length>200)fail(400,'导入需稳定来源、书名及最多200章');
    const validated=data.chapters.map(chapter=>{
      const result=validateChapter(chapter),sourceUrl=chapter.link??chapter.sourceUrl;
      if(sourceUrl!==undefined){if(typeof sourceUrl!=='string'||sourceUrl.length>2000||!/^https?:\/\//.test(sourceUrl))fail(400,'章节来源链接无效');result.sourceUrl=sourceUrl;}
      return result;
    });
    if(new Set(validated.map(c=>c.chapter_number)).size!==validated.length)fail(409,'批次内存在重复章号');
    let result;
    await mongoose.connection.transaction(async session=>{
      let book=await Book.findOne({sourceUrl:data.sourceUrl,importManaged:true}).session(session);
      if(book?.deletedAt)fail(409,'来源对应作品已下架，须显式恢复');
      if(!book) {
        if(await Book.exists({sourceUrl:data.sourceUrl}).session(session))fail(409,'已有来源映射未经核实，需人工处理');
        if(data.dryRun){result={dryRun:true,newBook:true,insert:validated.length};return;}
        [book]=await Book.create([{title:data.title,author:typeof data.author==='string'?data.author:'未知',sourceUrl:data.sourceUrl,importManaged:true,category:data.category||'未分类'}],{session});
      } else if(!data.dryRun) await lockBook(book._id,{role:'import'},session);
      let inserted=0,unchanged=0,enriched=0;
      for(const chapter of validated){
        const existing=await Chapter.findOne({bookId:book._id,chapter_number:chapter.chapter_number}).session(session);
        if(existing){
          if(existing.deletedAt||existing.title!==chapter.title||existing.content!==chapter.content||(existing.sourceUrl&&chapter.sourceUrl&&existing.sourceUrl!==chapter.sourceUrl))fail(409,`章号 ${chapter.chapter_number} 已下架或内容冲突，需显式恢复/编辑原章节`);
          if(chapter.sourceUrl&&!existing.sourceUrl){enriched++;if(!data.dryRun){existing.sourceUrl=chapter.sourceUrl;await existing.save({session});}}else unchanged++;
        }
        else {inserted++;if(!data.dryRun)await Chapter.create([{...chapter,bookId:book._id}],{session});}
      }
      result={dryRun:!!data.dryRun,bookId:String(book._id),inserted,unchanged,enriched};
    });res.json(result);
  }));
}
