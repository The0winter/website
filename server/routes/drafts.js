import mongoose from 'mongoose';
import Book from '../models/Book.js';
import Chapter from '../models/Chapter.js';
import ChapterDraft from '../models/ChapterDraft.js';
import {asyncRoute} from '../security.js';
import {fail,validateChapter,lockBook,chargeQuota,jsonDoc,contentHash} from '../services/content.js';
const hash=chapter=>contentHash({title:chapter.title,content:chapter.content,number:chapter.chapter_number});
export function draftRoutes(app,auth){
  app.get('/api/books/:id/draft',auth.authenticate,asyncRoute(async(req,res)=>{
    if(!await Book.exists({_id:req.params.id,deletedAt:null,...(req.user.role==='admin'?{}:{author_id:req.user.id})}))fail(403,'无权读取此作品草稿');
    const draft=await ChapterDraft.findOne({bookId:req.params.id,owner:req.user.id,publishedChapterId:null});
    res.set('Cache-Control','private, no-store').json(draft?jsonDoc(draft):null);
  }));
  app.put('/api/books/:id/draft',auth.authenticate,asyncRoute(async(req,res)=>{
    if(Object.keys(req.body).some(k=>!['title','content','targetChapterId'].includes(k)))fail(400,'包含不可修改字段');
    const targetId=req.body.targetChapterId||null;
    if(targetId!==null&&(typeof targetId!=='string'||!/^[a-f0-9]{24}$/i.test(targetId)))fail(400,'章节ID无效');
    let result;
    await mongoose.connection.transaction(async session=>{
      await lockBook(req.params.id,req.user,session);
      let draft=await ChapterDraft.findOne({bookId:req.params.id,owner:req.user.id}).session(session);
      if(draft?.publishedChapterId){await draft.deleteOne({session});draft=null;}
      if(draft&&String(draft.targetChapterId||'')!==String(targetId||''))fail(409,'请先继续或放弃此作品已有草稿');
      const target=targetId?await Chapter.findOne({_id:targetId,bookId:req.params.id,deletedAt:null}).session(session):null;
      if(targetId&&!target)fail(404,'原章节不存在或已下架');
      const last=target?null:await Chapter.findOne({bookId:req.params.id}).sort({chapter_number:-1}).session(session);
      const data=validateChapter({...req.body,chapter_number:target?.chapter_number||draft?.chapter_number||(last?.chapter_number||0)+1});
      if(!draft)draft=new ChapterDraft({bookId:req.params.id,owner:req.user.id,targetChapterId:targetId,baseHash:target?hash(target):undefined});
      Object.assign(draft,data);result=await draft.save({session});
    });res.json(jsonDoc(result));
  }));
  app.post('/api/books/:id/draft/publish',auth.authenticate,asyncRoute(async(req,res)=>{
    if(typeof req.body.draftId!=='string'||!/^[a-f0-9]{24}$/i.test(req.body.draftId))fail(400,'草稿ID无效');
    let result;
    await mongoose.connection.transaction(async session=>{
      await lockBook(req.params.id,req.user,session);
      const draft=await ChapterDraft.findOne({_id:req.body.draftId,bookId:req.params.id,owner:req.user.id}).session(session);
      if(!draft)fail(404,'草稿不存在');
      if(draft.publishedChapterId){result=await Chapter.findById(draft.publishedChapterId).session(session);if(!result||result.deletedAt)fail(409,'已发布章节已下架');return;}
      const data=validateChapter(draft);
      if(draft.targetChapterId){
        const target=await Chapter.findOne({_id:draft.targetChapterId,bookId:req.params.id,deletedAt:null}).session(session);
        if(!target||hash(target)!==draft.baseHash)fail(409,'原章节已变化，请核对正文后重新建立草稿');
        if(data.content!==target.content)await chargeQuota(req.user,data.content.length,session);
        Object.assign(target,data);result=await target.save({session});
      }else{
        if(await Chapter.exists({bookId:req.params.id,chapter_number:data.chapter_number}).session(session))fail(409,'草稿章号已占用，请核对后重新建立草稿');
        await chargeQuota(req.user,data.content.length,session);
        [result]=await Chapter.create([{...data,bookId:req.params.id}],{session});
      }
      draft.publishedChapterId=result._id;await draft.save({session});
    });res.json(jsonDoc(result));
  }));
  app.delete('/api/books/:id/draft',auth.authenticate,asyncRoute(async(req,res)=>{
    await mongoose.connection.transaction(async session=>{await lockBook(req.params.id,req.user,session);await ChapterDraft.deleteOne({bookId:req.params.id,owner:req.user.id,publishedChapterId:null},{session});});
    res.json({success:true});
  }));
}
