import mongoose from 'mongoose';
import Media from '../models/Media.js';
import {hasMediaReferences} from './media-reference.js';
import {getCoverStorage} from './cover-storage.js';

// A committed tombstone locks out every supported writer before any R2 deletion.
// If R2 fails or the process exits, the next run retries the same immutable keys.
export async function cleanUnusedCovers({storage,bucket,apply=false,now=new Date(),limit=500,mediaIds}) {
  if(!bucket || !Number.isInteger(limit) || limit<1 || limit>10000 || !Number.isFinite(+now))throw Error('Invalid cover cleanup options');
  if(mediaIds && (!Array.isArray(mediaIds) || mediaIds.some(id=>!/^[a-f0-9]{24}$/.test(String(id)))))throw Error('Invalid cover IDs');
  const filter={storage:'r2',bucket,purgedAt:null,$or:[{unreferencedSince:{$exists:false}},{unreferencedSince:{$type:'date'}},{deleted:true},{purgeStartedAt:{$ne:null}}],...(mediaIds?{_id:{$in:mediaIds}}:{})};
  const candidates=await Media.find(filter).select('_id').sort({_id:1}).limit(limit).lean();
  const last=candidates.at(-1);
  const hasMore=!!last && !!await Media.exists({...filter,_id:{...(filter._id||{}),$gt:last._id}});
  const report={apply,checkedAt:now.toISOString(),retentionDays:0,examined:candidates.length,hasMore,results:[]};
  for(const candidate of candidates){
    let decision;
    const inspect=async session=>{
      decision=undefined; // MongoDB may retry the transaction.
      const match={_id:candidate._id,storage:'r2',bucket,purgedAt:null};
      const media=apply
        ? await Media.findOneAndUpdate(match,{$inc:{referenceVersion:1}},{new:true,session}).lean()
        : await Media.findOne(match).lean();
      if(!media)return;
      if(await hasMediaReferences(media,session)){
        if(media.purgeStartedAt)throw Error('Referenced cover has a deletion tombstone');
        if(apply)await Media.updateOne({_id:media._id},{$set:{unreferencedSince:null}},{session});
        decision={status:'referenced'};return;
      }
      // A claim may have cleared the retirement marker while this run was waiting.
      if(media.unreferencedSince===null && !media.deleted && !media.purgeStartedAt){decision={status:'pendingUpload'};return;}
      if(apply)await Media.updateOne({_id:media._id},{$set:{deleted:true,unreferencedSince:media.unreferencedSince||now,purgeStartedAt:media.purgeStartedAt||now}},{session});
      decision={status:apply?'claimed':'wouldDelete',media};
    };
    try {
      if(apply)await mongoose.connection.transaction(inspect);else await inspect();
      if(decision?.status==='claimed'){
        const removed=await storage.remove(decision.media);
        const saved=await Media.updateOne({_id:candidate._id,deleted:true,purgeStartedAt:{$ne:null},purgedAt:null},{$set:{purgedAt:now}});
        if(saved.matchedCount!==1 && !await Media.exists({_id:candidate._id,purgedAt:{$ne:null}}))throw Error('Cover deletion result could not be recorded');
        report.results.push({id:String(candidate._id),status:'deleted',keys:removed.keys});
      }else if(decision){const {media,...result}=decision;report.results.push({id:String(candidate._id),...result});}
    }catch(error){
      // Do not print SDK diagnostics: endpoints, credentials, or connection strings may be present.
      report.results.push({id:String(candidate._id),status:'failed',errorType:error.name||'Error'});
    }
  }
  report.failed=report.results.filter(r=>r.status==='failed').length;
  return report;
}

// Await this after the book/media transaction commits, never inside a transaction.
// Return a retry state instead of undoing a successfully saved book on an R2 outage.
export async function finishCoverRetirement(mediaId,{storage}={}) {
  if(!mediaId)return {status:'notRequired'};
  try {
    const media=await Media.findById(mediaId).select('storage bucket purgedAt').lean();
    if(!media || media.storage!=='r2')return {status:'notRequired'};
    if(media.purgedAt)return {status:'deleted'};
    storage ||= getCoverStorage();
    if(!storage || !media.bucket)return {status:'retrying'};
    const result=await cleanUnusedCovers({storage,bucket:media.bucket,apply:true,mediaIds:[String(mediaId)]});
    if(result.failed)return {status:'retrying'};
    const row=result.results[0];
    if(!row && await Media.exists({_id:mediaId,purgedAt:{$ne:null}}))return {status:'deleted'};
    return {status:row?.status==='deleted'?'deleted':row?.status==='referenced'?'referenced':'notRequired'};
  }catch(error){
    console.warn('Cover deletion queued for retry',{mediaId:String(mediaId),errorType:error.name});
    return {status:'retrying'};
  }
}
