import crypto from 'node:crypto';
import mongoose from 'mongoose';
import Reply from '../models/ForumReply.js';
import Post from '../models/ForumPost.js';
import Book from '../models/Book.js';
import User from '../models/User.js';
import AdminLog from '../models/AdminLog.js';
import {safeHtml} from '../security.js';
import {reviewContentProblems, reviewText} from '../../shared/review-quality.mjs';
import {visibleForumReplies} from './forum-curation.js';

export const reviewDigest = value => crypto.createHash('sha256').update(value).digest('hex');
const canonical = value => {
  if (value?.toJSON) return canonical(value.toJSON());
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,canonical(value[k])]));
  return value;
};
export const reviewFingerprint = row => reviewDigest(JSON.stringify(canonical({content:row.content,title:row.title||'',source:row.source||null,curation:row.curation||null})));
const id = value => /^[a-f\d]{24}$/.test(value || '');
const editorialFields = row => ({...(row.title===undefined?{}:{title:row.title}),content:row.content,source:row.source,curation:row.curation});

export function validateReviewCleanup(plan) {
  if(plan?.version!==1 || !/^[a-z\d-]{1,80}$/.test(plan.batch||'') || !Array.isArray(plan.changes) || !plan.changes.length || plan.changes.length>3000)throw Error('书评清理清单无效');
  const seen=new Set();
  for(const row of plan.changes){
    if(!id(row.id)||!id(row.bookId)||!id(row.postId)||seen.has(row.id)||!/^[a-f\d]{64}$/.test(row.expected)||typeof row.reason!=='string'||!row.reason.trim())throw Error('清理身份或核对指纹无效');
    seen.add(row.id);
    if(row.title!==undefined&&(typeof row.title!=='string'||!row.title.trim()||row.title.length>200))throw Error('清理标题无效');
    if(typeof row.content!=='string'||!row.content.trim()||row.content.length>200000||safeHtml(row.content)!==row.content)throw Error('清理正文无效');
    if(!['original','excerpt','guide'].includes(row.source?.kind)||!row.source?.author||!row.source?.title||!['active','withheld','duplicate'].includes(row.curation?.status)||row.curation.version!==plan.batch)throw Error('清理来源或分类无效');
    const url=new URL(row.source.url);if(url.protocol!=='https:'||url.username||url.password)throw Error('来源链接无效');
    if(row.source.alternates){if(!Array.isArray(row.source.alternates)||row.source.alternates.length>20)throw Error('其他收录来源无效');for(const other of row.source.alternates){const link=new URL(other.url);if(typeof other.author!=='string'||!other.author.trim()||link.protocol!=='https:'||link.username||link.password)throw Error('其他收录来源无效');}}
    if(row.curation.status==='duplicate'&&(!id(row.curation.duplicateOf)||row.curation.duplicateOf===row.id))throw Error('重复项需指定其他原记录');
    if(row.curation.status!=='duplicate'&&row.curation.duplicateOf)throw Error('非重复项不能指定主条目');
    if(row.curation.status!=='withheld'&&reviewContentProblems(row.content).length)throw Error('清理后仍有正文异常：'+row.id+' '+reviewContentProblems(row.content).join(','));
  }
}

// Applies an already-reviewed local edition; never performs remote cleaning.
// Compare-and-set of editorial fields retains concurrent votes/comments.
export async function applyReviewCleanup(plan,{apply=false,writeAudit,admin,batchSize=40}={}){
  validateReviewCleanup(plan);
  const admins=await User.find({role:'admin',isBanned:{$ne:true},isTestAccount:{$ne:true},...(admin?{username:admin}:{})}).select('_id username').limit(2).lean();
  if(admins.length!==1)throw Error('需指定唯一现有管理员');
  const actor=admins[0],byId=new Map(plan.changes.map(r=>[r.id,r]));
  const unchanged=[],pending=[];
  async function inspect(changes,session){
    const stored=await Reply.find({_id:{$in:changes.map(r=>r.id)}}).session(session).lean();
    const posts=await Post.find({_id:{$in:[...new Set(changes.map(r=>r.postId))]}}).session(session).lean();
    const books=await Book.find({_id:{$in:[...new Set(changes.map(r=>r.bookId))]},deletedAt:null,visibility:{$ne:'private'}}).select('_id').session(session).lean();
    const active=[];
    for(const change of changes){
      const before=stored.find(r=>String(r._id)===change.id),post=posts.find(r=>String(r._id)===change.postId);
      if(!before?.source||String(before.postId)!==change.postId||String(post?.bookId)!==change.bookId||post?.type!=='question'||!books.some(b=>String(b._id)===change.bookId))throw Error('线上书评归属已变化：'+change.id);
      const after={...before,...editorialFields(change)};
      if(reviewFingerprint(before)===reviewFingerprint(after))continue;
      if(reviewFingerprint(before)!==change.expected)throw Error('线上书评已变化，保留新内容：'+change.id);
      if(change.curation.status==='duplicate'){
        const target=byId.get(change.curation.duplicateOf);
        const live=target||await Reply.findById(change.curation.duplicateOf).session(session).lean();
        if(!live||String(live.postId)!==change.postId||live.curation?.status==='duplicate'||live.curation?.status==='withheld'||reviewText(live.content).replace(/\s/g,'')!==reviewText(change.content).replace(/\s/g,''))throw Error('重复项主条目或正文不符：'+change.id);
      }
      active.push({change,before});
    }
    return active;
  }
  // Full preflight before the first write. Recheck each transaction for races.
  for(let start=0;start<plan.changes.length;start+=100){
    const batch=plan.changes.slice(start,start+100),active=await inspect(batch,null),ids=new Set(active.map(r=>r.change.id));
    pending.push(...active);unchanged.push(...batch.filter(r=>!ids.has(r.id)).map(r=>r.id));
  }
  if(!apply)return {batch:plan.batch,pending:pending.length,alreadyApplied:unchanged.length};
  if(typeof writeAudit!=='function')throw Error('应用前必须提供原文审计备份');
  await writeAudit({version:1,batch:plan.batch,createdAt:new Date().toISOString(),rows:pending.map(({change,before})=>({id:change.id,before,after:editorialFields(change)}))});
  const changed=[];
  for(let start=0;start<pending.length;start+=batchSize){
    const batch=pending.slice(start,start+batchSize).map(r=>r.change);
    await mongoose.connection.transaction(async session=>{
      const active=await inspect(batch,session);
      for(const {change,before}of active){
        const update=await Reply.updateOne({_id:before._id,content:before.content,source:before.source},{$set:editorialFields(change)},{session,runValidators:true,timestamps:false});
        if(update.matchedCount!==1)throw Error('书评发生并发修改：'+change.id);
      }
      for(const postId of new Set(active.map(r=>r.change.postId))){
        const total=await Reply.countDocuments({postId,...visibleForumReplies}).session(session);
        await Post.updateOne({_id:postId},{$set:{replyCount:total}},{session,timestamps:false});
      }
      if(active.length)await AdminLog.create([{admin_id:actor._id,action:'cleanup_collected_forum_reviews',details:JSON.stringify({batch:plan.batch,ids:active.map(r=>r.change.id)})}],{session});
    });
    changed.push(...batch.map(r=>r.id));
  }
  const verified=[];
  for(let start=0;start<plan.changes.length;start+=100){
    const batch=plan.changes.slice(start,start+100),stored=await Reply.find({_id:{$in:batch.map(r=>r.id)}}).lean();
    for(const change of batch){const live=stored.find(r=>String(r._id)===change.id);if(!live||reviewFingerprint(live)!==reviewFingerprint({...live,...editorialFields(change)}))throw Error('写入后核验失败：'+change.id);verified.push(change.id);}
  }
  return {batch:plan.batch,changed:changed.length,alreadyApplied:unchanged.length,verified:verified.length};
}
