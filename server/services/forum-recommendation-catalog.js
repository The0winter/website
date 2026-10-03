import mongoose from 'mongoose';
import Post from '../models/ForumPost.js';
import Reply from '../models/ForumReply.js';
import Book from '../models/Book.js';
import {RecommendationItem as Item, RecommendationCheckpoint as Checkpoint, recommendationModels} from '../models/ForumRecommendation.js';
import {makeRecommendationItem} from './forum-recommendation-ranking.js';

let initializing, initializedConnection, syncing;
export async function initializeRecommendations() {
  const connection = mongoose.connection._connectionString;
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
  for(const post of posts) {
    // Questions with answers are represented by their answers, not an extra card.
    if(!publicPost(post) || post.type==='question' && post.replyCount>0)actions.push(()=>Item.deleteOne({_id:String(post._id)}));
    else actions.push(()=>save(makeRecommendationItem(post,null,byBook.get(String(post.bookId)))));
  }
  for(const reply of replies) {
    const post=parents.get(String(reply.postId));
    if(!publicPost(post) || post.type!=='question' || ['withheld','duplicate'].includes(reply.curation?.status))
      actions.push(()=>Item.deleteOne({_id:String(reply._id)}));
    else actions.push(()=>save(makeRecommendationItem(post,reply,byBook.get(String(post.bookId)))));
  }
  for(let start=0;start<actions.length;start+=8)await Promise.all(actions.slice(start,start+8).map(run=>run()));
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

export async function syncForumCatalog({batches=4,batchSize=32}={}) {
  if(syncing)return syncing;
  syncing=(async()=>{
    await initializeRecommendations();
    let processed=0;
    for(const [key,Model] of [['posts',Post],['replies',Reply]]) {
      let checkpoint=await Checkpoint.findById(key).lean();
      // Periodically revisit metadata inherited from books and parent questions.
      if(checkpoint?.passAt && Date.now()-+checkpoint.passAt>6*3600000)checkpoint=null;
      for(let batch=0;batch<batches;batch++) {
        const filter=checkpoint?.at?{$or:[{updatedAt:{$gt:checkpoint.at}},
          {updatedAt:checkpoint.at,_id:{$gt:new mongoose.Types.ObjectId(checkpoint.key)}}]}:{};
        const rows=await Model.find(filter).sort({updatedAt:1,_id:1}).limit(batchSize)
          .populate('author','username avatar').maxTimeMS(5000).lean();
        if(!rows.length)break;
        await indexRows(key==='posts'?rows:[],key==='replies'?rows:[]);
        processed+=rows.length;
        const last=rows.at(-1);
        checkpoint={at:last.updatedAt || last.createdAt || new Date(0),key:String(last._id),passAt:checkpoint?.passAt || new Date()};
        await Checkpoint.updateOne({_id:key},{$set:checkpoint},{upsert:true});
        if(rows.length<batchSize)break;
      }
    }
    return {processed,items:await Item.countDocuments()};
  })().finally(()=>{syncing=null;});
  return syncing;
}

// A cached candidate can never override current visibility or curation. These
// bounded metadata reads also repair edited/deleted entries before returning them.
export async function publicRecommendationItems(ids) {
  if(!ids.length)return [];
  let rows=await Item.find({_id:{$in:ids}}).lean();
  const missing=ids.filter(id=>!rows.some(row=>row._id===id));
  if(missing.length){await indexForumEntries(missing);rows=await Item.find({_id:{$in:ids}}).lean();}
  const [posts,replies]=await Promise.all([
    Post.find({_id:{$in:[...new Set(rows.map(row=>row.post))]}}).select('bookId type replyCount updatedAt likes views').lean(),
    Reply.find({_id:{$in:rows.filter(row=>row.kind==='answer').map(row=>row._id)}}).select('postId curation updatedAt likes comments').lean(),
  ]);
  const byPost=new Map(posts.map(row=>[String(row._id),row])),byReply=new Map(replies.map(row=>[String(row._id),row]));
  const books=await Book.find({_id:{$in:[...new Set(posts.map(row=>row.bookId).filter(Boolean))]},deletedAt:null,visibility:{$ne:'private'}}).select('_id updatedAt').lean();
  const byBook=new Map(books.map(row=>[String(row._id),row]));
  const valid=rows.filter(row=>{
    const post=byPost.get(row.post),reply=byReply.get(row._id);
    return post && (!post.bookId || byBook.has(String(post.bookId))) && (row.kind==='answer'?
      reply && String(reply.postId)===row.post && post.type==='question' && !['withheld','duplicate'].includes(reply.curation?.status):
      post.type==='article' || post.type==='question' && !post.replyCount);
  });
  const stale=valid.filter(row=>+new Date(row.indexedAt)<Math.max(+byPost.get(row.post).updatedAt||0,
    +byReply.get(row._id)?.updatedAt||0,+byBook.get(String(byPost.get(row.post).bookId))?.updatedAt||0));
  if(stale.length){await indexForumEntries(stale.map(row=>row._id));const fresh=await Item.find({_id:{$in:stale.map(row=>row._id)}}).lean();const map=new Map(fresh.map(row=>[row._id,row]));
    for(let i=0;i<valid.length;i++)valid[i]=map.get(valid[i]._id)||valid[i];}
  return valid.map(row=>{const post=byPost.get(row.post),reply=byReply.get(row._id);return {...row,item:{...row.item,
    votes:post.likes||0,views:post.views||0,comments:post.replyCount||0,
    ...(row.item.topReply?{topReply:{...row.item.topReply,votes:reply?.likes||0,comments:reply?.comments||0}}:{})}};});
}

export function startForumCatalog() {
  let stopped=false;
  const tick=()=>{if(!stopped)void syncForumCatalog().catch(()=>console.error('Forum recommendation catalog refresh unavailable'));};
  tick();const timer=setInterval(tick,60000);timer.unref();
  return ()=>{stopped=true;clearInterval(timer);};
}
