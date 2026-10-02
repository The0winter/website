import mongoose from 'mongoose';
import rateLimit from 'express-rate-limit';
import Submission from '../models/TransferSubmission.js';
import Capacity from '../models/TransferCapacity.js';
import Book from '../models/Book.js';
import Chapter from '../models/Chapter.js';
import User from '../models/User.js';
import {asyncRoute} from '../security.js';
import {fail} from '../services/content.js';
import {parseTransfer,transferLimit,transferStoredLimit} from '../services/transfer-text.js';
import {getTransferStorage} from '../services/transfer-storage.js';
import {storeChapterBodies} from '../services/chapter-storage.js';
import {importedAuthor} from '../services/author-identity.js';
import {recordBookUpdate} from '../services/book-update-time.js';

const capacityLimit=5*1024*1024*1024;
const summary=row=>({id:String(row._id),title:row.title,author:row.author,filename:row.filename,
  status:row.status,bytes:row.bytes||row.declaredBytes,chapterCount:row.chapterCount,characters:row.characters,
  processed:row.processed,reason:row.reason,createdAt:row.createdAt,bookId:row.status==='accepted'?String(row.bookId):undefined});
const admin=(req,res,next)=>req.user.role==='admin'?next():res.status(403).json({error:'需要管理员权限'});
export function transferRoutes(app,auth){
  let ready,active=0;
  const busy=new Set();
  const storage=()=>app.locals.transferStorage||getTransferStorage();
  const init=asyncRoute(async(req,res,next)=>{
    if(!app.locals.writingCleanupEnabled)fail(503,'当前维护中，作品搬运暂不可用');
    ready ||= (async()=>{for(const model of [Submission,Capacity]){await model.createCollection();await model.createIndexes();}await Capacity.updateOne({_id:'global'},{$setOnInsert:{reserved:0,version:0}},{upsert:true});})().catch(e=>{ready=null;throw e;});
    await ready;res.set('Cache-Control','private, no-store');next();
  });
  const limited=rateLimit({windowMs:60000,limit:12,message:{error:'提交过于频繁，请稍后再试'}});
  const slot=handler=>asyncRoute(async(req,res)=>{
    const id=req.params.id||req.user.id;
    // Production API has a 768 MiB cgroup cap; admit one large text operation.
    if(active>=1||busy.has(id))fail(429,'文件正在处理中，请稍后重试');
    active++;busy.add(id);
    try{await handler(req,res);}finally{active--;busy.delete(id);}
  });
  app.get('/api/transfers',auth.authenticate,init,asyncRoute(async(req,res)=>{
    const review=req.query.review==='true';if(review&&req.user.role!=='admin')fail(403,'需要管理员权限');
    const page=Number(req.query.page||1);if(!Number.isSafeInteger(page)||page<1||page>1000)fail(400,'分页无效');
    const filter=review?{status:{$in:['pending','importing']}}:{owner:req.user.id};
    const rows=await Submission.find(filter).sort({createdAt:-1,_id:1}).skip((page-1)*20).limit(21).lean();
    const names=review?await User.find({_id:{$in:rows.map(r=>r.owner)}}).select('username').lean():[];
    res.json({items:rows.slice(0,20).map(row=>({...summary(row),...(review?{submitter:names.find(n=>String(n._id)===String(row.owner))?.username||'用户'}:{})})),hasNext:rows.length>20});
  }));
  app.post('/api/transfers',auth.authenticate,limited,init,asyncRoute(async(req,res)=>{
    storage();
    const {title,author,filename,size}=req.body;
    if(Object.keys(req.body).some(k=>!['title','author','filename','size'].includes(k)))fail(400,'提交字段无效');
    for(const value of [title,author])if(typeof value!=='string'||!value.trim()||value.length>200||/[\x00-\x1f]/.test(value))fail(400,'请填写 200 字以内的书名和原作者');
    if(typeof filename!=='string'||filename.length>200||!filename.toLowerCase().endsWith('.txt')||/[\x00-\x1f\\/:]/.test(filename))fail(400,'请选择 TXT 文件');
    if(!Number.isSafeInteger(size)||size<1||size>transferLimit)fail(400,'文件须为 30 MB 以内的非空 TXT');
    const idempotency=req.headers['idempotency-key'];
    if(typeof idempotency!=='string'||!/^[a-f0-9]{24}$/.test(idempotency))fail(400,'提交标识无效');
    let result;
    await mongoose.connection.transaction(async session=>{
      const cap=await Capacity.findByIdAndUpdate('global',{$inc:{version:1}},{new:true,session});
      const old=await Submission.findById(idempotency).session(session);
      if(old){if(String(old.owner)!==req.user.id||old.title!==title.trim()||old.author!==author.trim()||old.filename!==filename||old.declaredBytes!==size)fail(409,'提交标识已被使用');result=old;return;}
      if(await Submission.countDocuments({owner:req.user.id,createdAt:{$gt:new Date(Date.now()-86400000)}}).session(session)>=3)fail(429,'24 小时内最多提交 3 份作品');
      if(await Submission.countDocuments({owner:req.user.id,status:{$in:['uploading','pending','importing']}}).session(session)>=5)fail(429,'最多保留 5 份待审核作品，请等待处理');
      if(cap.reserved+transferStoredLimit>capacityLimit)fail(503,'投稿箱容量已满，请等待管理员处理');
      cap.reserved+=transferStoredLimit;await cap.save({session});
      [result]=await Submission.create([{_id:idempotency,owner:req.user.id,title:title.trim(),author:author.trim(),filename,declaredBytes:size}],{session});
    });
    res.status(201).json(summary(result));
  }));
  app.put('/api/transfers/:id/file',auth.authenticate,limited,init,slot(async(req,res)=>{
    const row=await Submission.findOne({_id:req.params.id,owner:req.user.id});
    if(!row)fail(404,'投稿不存在');
    if(row.status!=='uploading'){if(row.status==='pending')return res.json(summary(row));fail(409,'此投稿已不能上传');}
    if(req.headers['content-type']!=='application/octet-stream')fail(415,'上传格式无效');
    const declared=Number(req.headers['content-length']);
    if(declared>transferLimit||declared&&declared!==row.declaredBytes)fail(413,'文件大小不符或超过 30 MB');
    const chunks=[];let size=0;
    const timer=setTimeout(()=>req.destroy(),90000);
    let result;
    try{
      for await(const chunk of req){size+=chunk.length;if(size>transferLimit||size>row.declaredBytes)fail(413,'文件超过允许大小');chunks.push(chunk);}
      if(size!==row.declaredBytes)fail(400,'文件未完整上传，请重新提交');
      result=await parseTransfer(Buffer.concat(chunks),row.filename,false,'metadata');
    }finally{clearTimeout(timer);}
    // No executable source file is retained. Only the validated UTF-8 text is stored.
    await storage().write(String(row._id),result.text,result.sha256);
    const updated=await Submission.findOneAndUpdate({_id:row._id,status:'uploading'},{$set:{status:'pending',stored:true,bytes:Buffer.byteLength(result.text),sha256:result.sha256,characters:result.characters,chapterCount:result.chapterCount}},{new:true});
    if(!updated)fail(409,'投稿已过期，请重新提交');
    res.json(summary(updated));
  }));
  app.get('/api/transfers/:id/preview',auth.authenticate,admin,init,slot(async(req,res)=>{
    const row=await Submission.findById(req.params.id);
    if(!row||!['pending','importing','accepted'].includes(row.status)||!row.stored)fail(404,'文件不可用');
    const bytes=await storage().read(String(row._id),row.sha256);
    const text=bytes.toString('utf8'),offset=Number(req.query.offset||0);
    if(!Number.isSafeInteger(offset)||offset<0||offset>text.length)fail(400,'预览位置无效');
    const duplicates=await Book.find({title:row.title,author:row.author,deletedAt:null,_id:{$ne:row.bookId}}).select('_id title').limit(10).lean();
    res.json({...summary(row),text:text.slice(offset,offset+12000),nextOffset:offset+12000<text.length?offset+12000:null,duplicates:duplicates.map(b=>({id:String(b._id),title:b.title}))});
  }));
  app.post('/api/transfers/:id/reject',auth.authenticate,admin,limited,init,slot(async(req,res)=>{
    const reason=req.body.reason;
    if(typeof reason!=='string'||!reason.trim()||reason.length>500)fail(400,'请填写 500 字以内的原因');
    const row=await Submission.findOneAndUpdate({_id:req.params.id,status:'pending'},{$set:{status:'rejected',reason:reason.trim(),reviewer:req.user.id}},{new:true});
    if(!row)fail(409,'投稿状态已变化，请刷新');
    await cleanup(row);res.json(summary(row));
  }));
  app.post('/api/transfers/:id/approve',auth.authenticate,admin,rateLimit({windowMs:60000,limit:120,message:{error:'收录请求过于频繁，请稍后点击继续收录'}}),init,slot(async(req,res)=>{
    let row=await Submission.findById(req.params.id);
    if(!row||!['pending','importing','accepted'].includes(row.status))fail(409,'投稿状态已变化，请刷新');
    if(row.status==='accepted')return res.json(summary(row));
    const bytes=await storage().read(String(row._id),row.sha256);
    const parsed=await parseTransfer(bytes,'normalized.txt',true,row.processed);
    if(parsed.chapterCount!==row.chapterCount)fail(409,'章节校验失败');
    if(row.status==='pending'){
      await mongoose.connection.transaction(async session=>{
        await Capacity.updateOne({_id:'global'},{$inc:{version:1}},{session});
        row=await Submission.findById(req.params.id).session(session);
        if(row.status!=='pending')return;
        if(await Book.exists({title:row.title,author:row.author,deletedAt:null}).session(session))fail(409,'书库已存在同名同作者作品，请先核对，不能直接覆盖');
        const profile=await importedAuthor({name:row.author,sourceKey:`transfer:${row._id}`},session);
        const [book]=await Book.create([{title:row.title,author:row.author,author_profile_id:profile._id,visibility:'private',sourceUrl:`transfer:${row._id}`}],{session});
        row.status='importing';row.bookId=book._id;row.reviewer=req.user.id;await row.save({session});
      });
    }
    const batch=parsed.chapters.map(c=>({...c,word_count:c.content.length}));
    const prepared=process.env.CHAPTER_STORAGE==='r2'?await storeChapterBodies(batch):batch;
    await mongoose.connection.transaction(async session=>{
      const current=await Submission.findOneAndUpdate({_id:row._id,status:'importing',processed:row.processed},{$inc:{reviewVersion:1}},{new:true,session});
      if(!current)fail(409,'审核进度已变化，请刷新后继续');
      const book=await Book.findOne({_id:row.bookId,visibility:'private',deletedAt:null}).session(session);
      if(!book)fail(409,'待收录书籍状态已变化');
      if(prepared.length)await Chapter.insertMany(prepared.map(c=>({...c,bookId:row.bookId})),{session});
      current.processed+=prepared.length;
      if(current.processed===parsed.chapterCount){
        if(await Chapter.countDocuments({bookId:book._id}).session(session)!==parsed.chapterCount)fail(409,'章节完整性校验失败');
        book.visibility='public';await book.save({session});await recordBookUpdate(book._id,session);current.status='accepted';
      }
      await current.save({session});row=current;
    });
    res.json(summary(row));
  }));
  async function cleanup(row){
    if(row.released)return;
    // A timed-out upload may have reached R2 before its database acknowledgement.
    await storage().remove(String(row._id));
    await mongoose.connection.transaction(async session=>{
      const changed=await Submission.updateOne({_id:row._id,released:false,status:{$in:['rejected','expired','accepted']}},{$set:{released:true,stored:false}},{session});
      if(changed.modifiedCount)await Capacity.updateOne({_id:'global'},{$inc:{reserved:-transferStoredLimit}},{session});
    });
  }
  let cleaning=false;
  const sweep=async()=>{
    if(!ready||cleaning)return;cleaning=true;
    try{
      await Submission.updateMany({status:'uploading',updatedAt:{$lt:new Date(Date.now()-600000)}},{$set:{status:'expired',reason:'上传未完成'}});
      await Submission.updateMany({status:'pending',createdAt:{$lt:new Date(Date.now()-30*86400000)}},{$set:{status:'expired',reason:'超过 30 天未处理'}});
      const rows=await Submission.find({released:false,$or:[{status:{$in:['rejected','expired']}},{status:'accepted',updatedAt:{$lt:new Date(Date.now()-30*86400000)}}]}).limit(30);
      for(const row of rows)if(!busy.has(String(row._id)))await cleanup(row);
    }catch{console.error('Transfer cleanup will retry');}finally{cleaning=false;}
  };
  if(app.locals.writingCleanupEnabled){const timer=setInterval(sweep,15*60000);timer.unref();}
}
