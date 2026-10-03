import mongoose from 'mongoose';
import Post from '../models/ForumPost.js';
import Reply from '../models/ForumReply.js';
import Book from '../models/Book.js';
import {RecommendationItem as Item, RecommendationCheckpoint as Checkpoint, recommendationModels} from '../models/ForumRecommendation.js';
import {makeRecommendationItem} from './forum-recommendation-ranking.js';
import {inspectRecommendationItems,inspectCatalogBatch,recommendationVersions} from './forum-recommendation-metadata.js';
import {clearForumRecommendationCache} from './forum-recommendation-cache.js';

let initializing, initializedConnection, syncing;
export async function initializeRecommendations() {
  const connection = mongoose.connection.db;
  if(initializedConnection!==connection){initializing=null;initializedConnection=connection;}
  initializing ||= (async()=>{
    for(const model of recommendationModels)await model.createIndexes();
    // Additive indexes; no content migration or alteration of existing records.
    await Post.collection.createIndex({updatedAt:1,_id:1});
    await Reply.collection.createIndex({updatedAt:1,_id:1});
  })().catch(error=>{initializing=null;throw error;});
  await initializing;
}

async function indexRows(posts, replies) {
  const save=(value)=>{const {_id,...fields}=value;return Item.updateOne({_id},{$set:fields},{upsert:true});};
  const missing=[...new Set(replies.map(row=>String(row.postId)))].filter(id=>!posts.some(row=>String(row._id)===id));
  if(missing.length)posts=[...posts,...await Post.find({_id:{$in:missing}}).populate('author','username avatar').lean()];
  const parents=new Map(posts.map(row=>[String(row._id),row]));
  const ids=[...new Set(posts.map(row=>String(row.bookId||'')).filter(Boolean))];
  const books=ids.length?await Book.find({_id:{$in:ids},deletedAt:null,visibility:{$ne:'private'}})
    .select('title author category description').lean():[];
  const byBook=new Map(books.map(row=>[String(row._id),row]));
  const publicPost=post=>post && (!post.bookId || byBook.has(String(post.bookId)));
  const actions=[];
  const derived=(post,reply)=>{const book=byBook.get(String(post.bookId));return {
    ...makeRecommendationItem(post,reply,book),...recommendationVersions(post,reply,book),
  };};
  for(const post of posts) {
    // Questions with answers are represented by their answers, not an extra card.
    if(!publicPost(post) || post.type==='question' && post.replyCount>0)actions.push(()=>Item.deleteOne({_id:String(post._id)}));
    else actions.push(()=>save(derived(post,null)));
  }
  for(const reply of replies) {
    const post=parents.get(String(reply.postId));
    if(!publicPost(post) || post.type!=='question' || ['withheld','duplicate'].includes(reply.curation?.status))
      actions.push(()=>Item.deleteOne({_id:String(reply._id)}));
    else actions.push(()=>save(derived(post,reply)));
  }
  for(let start=0;start<actions.length;start+=8)await Promise.all(actions.slice(start,start+8).map(run=>run()));
  if(actions.length)clearForumRecommendationCache();
}

export async function indexForumEntries(entries) {
  const ids=[...new Set(entries)].filter(id=>/^[a-f0-9]{24}$/.test(id)).slice(0,100);
  if(!ids.length)return;
  const [posts,replies]=await Promise.all([
    Post.find({_id:{$in:ids}}).populate('author','username avatar').lean(),
    Reply.find({_id:{$in:ids}}).populate('author','username avatar').lean(),
  ]);
  await indexRows(posts,replies);
}

export async function syncForumCatalog({batches=4,batchSize=32,reconcile=false}={}) {
  if(syncing)return syncing;
  syncing=(async()=>{
    await initializeRecommendations();
    let processed=0,reindexed=0,removed=0;
    for(const key of ['posts','replies']) {
      let checkpoint=await Checkpoint.findById(key).lean();
      // Periodically revisit metadata inherited from books and parent questions.
      if(reconcile || checkpoint?.passAt && Date.now()-+checkpoint.passAt>6*3600000)checkpoint=null;
      for(let batch=0;batch<batches;batch++) {
        const filter=checkpoint?.at?{$or:[{updatedAt:{$gt:checkpoint.at}},
          {updatedAt:checkpoint.at,_id:{$gt:new mongoose.Types.ObjectId(checkpoint.key)}}]}:{};
        const rows=await inspectCatalogBatch(key,filter,batchSize);
        if(!rows.length)break;
        const changed=rows.filter(row=>row.valid&&row.stale).map(row=>row._id);
        for(let start=0;start<changed.length;start+=100)await indexForumEntries(changed.slice(start,start+100));
        const invalid=rows.filter(row=>!row.valid&&row.exists).map(row=>row._id);
        if(invalid.length){await Item.deleteMany({_id:{$in:invalid}});clearForumRecommendationCache();}
        reindexed+=changed.length;removed+=invalid.length;
        processed+=rows.length;
        const last=rows.at(-1);
        checkpoint={at:last.updatedAt || last.createdAt || new Date(0),key:String(last._id),passAt:checkpoint?.passAt || new Date()};
        await Checkpoint.updateOne({_id:key},{$set:checkpoint},{upsert:true});
        if(rows.length<batchSize)break;
      }
    }
    return {processed,reindexed,removed,items:await Item.countDocuments()};
  })().finally(()=>{syncing=null;});
  return syncing;
}

// A cached candidate can never override current visibility or curation. This
// bounded metadata join also repairs edited/deleted entries before returning them.
export async function publicRecommendationItems(ids) {
  if(!ids.length)return [];
  let rows=await inspectRecommendationItems(ids);
  const missing=ids.filter(id=>!rows.some(row=>row._id===id));
  const repair=[...missing,...rows.filter(row=>row.valid&&row.stale).map(row=>row._id)];
  if(repair.length){await indexForumEntries(repair);rows=await inspectRecommendationItems(ids);}
  return rows.filter(entry=>entry.valid).map(({row,counts})=>({...row,item:{...row.item,
    votes:counts.votes||0,views:counts.views||0,comments:counts.comments||0,
    ...(row.item.topReply?{topReply:{...row.item.topReply,votes:counts.replyVotes||0,comments:counts.replyComments||0}}:{}),
  }}));
}

export function startForumCatalog() {
  let stopped=false;
  const tick=()=>{if(!stopped)void syncForumCatalog().catch(()=>console.error('Forum recommendation catalog refresh unavailable'));};
  tick();const timer=setInterval(tick,60000);timer.unref();
  return ()=>{stopped=true;clearInterval(timer);};
}
