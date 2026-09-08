import crypto from 'node:crypto';
import mongoose from 'mongoose';
import Book from '../models/Book.js';
import Chapter from '../models/Chapter.js';
import User from '../models/User.js';
import UserDaily from '../models/UserDaily.js';

export function fail(status,message) { throw Object.assign(new Error(message),{status}); }
export const jsonDoc = doc => ({...doc.toObject(),id:String(doc._id)});
export const dayKey = (date=new Date()) => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
export const contentHash = data => crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
export function validateChapter(body) {
  const number=body.chapter_number ?? body.chapterNumber;
  if (typeof body.title!=='string' || !body.title.trim() || body.title.length>100 || typeof body.content!=='string' || !body.content.trim() || body.content.length>60000 || !Number.isSafeInteger(number) || number<1) fail(400,'章节标题、正文或编号无效');
  return {title:body.title.trim(),content:body.content,chapter_number:number,word_count:body.content.length};
}
export async function lockBook(bookId,actor,session,{includeDeleted=false}={}) {
  const filter={_id:bookId};
  if (!includeDeleted) filter.deletedAt=null;
  if (actor.role!=='admin' && actor.role!=='import') filter.author_id=actor.id;
  const book=await Book.findOneAndUpdate(filter,{$inc:{writeVersion:1}},{new:true,session});
  if (!book) {
    const exists=await Book.exists({_id:bookId}).session(session);
    fail(exists?403:404,'作品不存在、已下架或无权修改');
  }
  return book;
}
export async function chargeQuota(actor,words,session) {
  if (actor.role==='import') return;
  const today=dayKey();
  await UserDaily.updateOne({_id:`${actor.id}:${today}`},{$setOnInsert:{userId:actor.id,day:today,expiresAt:new Date(Date.now()+62*86400000)},$inc:{uploads:1}},{session,upsert:true});
  if (actor.role==='admin') return;
  const user=await User.findById(actor.id).session(session);
  if (!user || user.isBanned) fail(403,'账户不可用');
  const used=user.uploadDay===today?user.daily_upload_words:0;
  if (used+words>100000) fail(429,'今日上传额度已用完');
  user.uploadDay=today;user.daily_upload_words=used+words;user.last_upload_date=new Date();
  user.stats.today_uploads=(user.stats.today_uploads||0)+1;
  await user.save({session});
}
export async function createChapter(actor,bookId,body) {
  const data=validateChapter(body);
  let result;
  await mongoose.connection.transaction(async session=>{
    await lockBook(bookId,actor,session);
    const existing=await Chapter.findOne({bookId,chapter_number:data.chapter_number}).session(session);
    if(existing) {
      if(existing.deletedAt) fail(409,'同一编号的章节已下架，请先恢复原章节');
      if(existing.title!==data.title || existing.content!==data.content) fail(409,'同一编号已存在不同内容');
      result=existing;return;
    }
    await chargeQuota(actor,data.content.length,session);
    [result]=await Chapter.create([{...data,bookId}],{session});
  });
  return result;
}
