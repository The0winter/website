import mongoose from 'mongoose';
import Media from '../models/Media.js';
import {hasMediaReferences} from './media-reference.js';

export const coverRetentionMs=7*24*60*60*1000;

// A committed tombstone locks out every supported writer before any R2 deletion.
// If R2 fails or the process exits, the next run retries the same immutable keys.
export async function cleanUnusedCovers({storage,bucket,apply=false,now=new Date(),limit=500}) {
  if(!bucket || !Number.isInteger(limit) || limit<1 || limit>10000 || !Number.isFinite(+now))throw Error('Invalid cover cleanup options');
  const cutoff=new Date(+now-coverRetentionMs);
  const filter={storage:'r2',bucket,purgedAt:null,$or:[{unreferencedSince:{$exists:false}},{unreferencedSince:{$lte:cutoff}},{purgeStartedAt:{$ne:null}}]};
  const candidates=await Media.find(filter).select('_id').sort({_id:1}).limit(limit).lean();
  const last=candidates.at(-1);
  const hasMore=!!last && !!await Media.exists({...filter,_id:{$gt:last._id}});
  const report={apply,checkedAt:now.toISOString(),retentionDays:7,examined:candidates.length,hasMore,results:[]};
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
      if(!media.unreferencedSince){
        if(apply)await Media.updateOne({_id:media._id},{$set:{unreferencedSince:now}},{session});
        decision={status:apply?'scheduled':'wouldSchedule',eligibleAt:new Date(+now+coverRetentionMs).toISOString()};return;
      }
      if(+media.unreferencedSince>+cutoff){decision={status:'waiting',eligibleAt:new Date(+media.unreferencedSince+coverRetentionMs).toISOString()};return;}
      if(apply)await Media.updateOne({_id:media._id},{$set:{deleted:true,purgeStartedAt:media.purgeStartedAt||now}},{session});
      decision={status:apply?'claimed':'wouldDelete',media};
    };
    try {
      if(apply)await mongoose.connection.transaction(inspect);else await inspect();
      if(decision?.status==='claimed'){
        const removed=await storage.remove(decision.media);
        const saved=await Media.updateOne({_id:candidate._id,deleted:true,purgeStartedAt:{$ne:null},purgedAt:null},{$set:{purgedAt:now}});
        if(saved.matchedCount!==1)throw Error('Cover deletion result could not be recorded');
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
