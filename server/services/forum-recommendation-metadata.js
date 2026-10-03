import mongoose from 'mongoose';
import Post from '../models/ForumPost.js';
import Reply from '../models/ForumReply.js';
import Book from '../models/Book.js';
import {RecommendationItem as Item} from '../models/ForumRecommendation.js';

const postFields='bookId type replyCount updatedAt likes views';
const replyFields='postId curation updatedAt likes comments';
const bookFields='title author category description visibility deletedAt';
const versions='postUpdatedAt replyUpdatedAt bookMetadata';
const projection=fields=>Object.fromEntries(fields.split(' ').map(field=>[field,1]));
export const bookMetadata=book=>book?['title','author','category','description'].map(key=>String(book[key]||'')):[];
export const recommendationVersions=(post,reply,book)=>({
  postUpdatedAt:post.updatedAt||null,replyUpdatedAt:reply?.updatedAt||null,bookMetadata:bookMetadata(book),
});

// Lookups use existing primary-key indexes. Only booleans, version markers and
// the requested cards leave MongoDB; source bodies and book descriptions stay
// inside the database. No shared cache contains a user's permissions.
function metadataPipeline(source,filter,limit) {
  const answer=source==='replies'?true:source==='posts'?false:{$eq:['$_entry.kind','answer']};
  const fields=source==='posts'?postFields:replyFields;
  const stages=[{$match:filter}];
  if(source!=='items')stages.push({$sort:{updatedAt:1,_id:1}},{$limit:limit});
  stages.push({$project:source==='items'?{
    _id:1,_entry:'$$ROOT',_postId:{$convert:{input:'$post',to:'objectId',onError:null,onNull:null}},
    _replyId:{$cond:[{$eq:['$kind','answer']},{$convert:{input:'$_id',to:'objectId',onError:null,onNull:null}},null]},
  }:{_id:{$toString:'$_id'},updatedAt:1,_postId:source==='posts'?'$_id':'$postId',
    _replyId:source==='replies'?'$_id':{$literal:null},
    [source==='posts'?'_post':'_reply']:Object.fromEntries(['_id',...fields.split(' ')].map(key=>[key,'$'+key])),
  }});
  const join=(Model,local,as,select)=>stages.push({$lookup:{from:Model.collection.name,localField:local,foreignField:'_id',
    pipeline:[{$project:projection(select)}],as}},{$set:{[as]:{$arrayElemAt:['$'+as,0]}}});
  if(source!=='posts')join(Post,'_postId','_post',postFields);
  if(source==='items')join(Reply,'_replyId','_reply',replyFields);
  else join(Item,'_id','_entry',versions);
  join(Book,'_post.bookId','_book',bookFields);
  const exists=field=>({$ne:[{$ifNull:[field,null]},null]});
  const equalDate=(a,b)=>({$eq:[{$ifNull:[a,null]},{$ifNull:[b,null]}]});
  const metadata={$cond:[exists('$_book._id'),['title','author','category','description'].map(key=>({$ifNull:['$_book.'+key,'']})),[]]};
  const publicBook={$or:[{$not:[exists('$_post.bookId')]},{$and:[exists('$_book._id'),
    {$eq:[{$ifNull:['$_book.deletedAt',null]},null]},{$ne:['$_book.visibility','private']},
  ]}]};
  const validAnswer={$and:[exists('$_reply._id'),{$eq:['$_reply.postId','$_post._id']},
    {$eq:['$_post.type','question']},{$not:[{$in:[{$ifNull:['$_reply.curation.status','active']},['withheld','duplicate']]}]},
  ]};
  const validPost={$or:[{$eq:['$_post.type','article']},{$and:[{$eq:['$_post.type','question']},
    {$eq:[{$ifNull:['$_post.replyCount',0]},0]},
  ]}]};
  stages.push({$set:{
    exists:exists('$_entry._id'),
    valid:{$and:[exists('$_post._id'),publicBook,{$cond:[answer,validAnswer,validPost]}]},
    stale:{$not:[{$and:[exists('$_entry.postUpdatedAt'),equalDate('$_entry.postUpdatedAt','$_post.updatedAt'),
      equalDate('$_entry.replyUpdatedAt','$_reply.updatedAt'),{$eq:['$_entry.bookMetadata',metadata]}]}]},
  }});
  stages.push({$project:source==='items'?{_id:1,valid:1,stale:1,exists:1,row:'$_entry',
    counts:{votes:'$_post.likes',views:'$_post.views',comments:'$_post.replyCount',replyVotes:'$_reply.likes',replyComments:'$_reply.comments'},
  }:{_id:1,valid:1,stale:1,exists:1,updatedAt:1}});
  if(source==='items')stages.push({$unset:'row.bookMetadata'});
  return stages;
}

// The SQLite/D1 compatibility adapter cannot execute indexed server-side joins.
// Use bounded projections there instead of its generic full-collection lookup.
async function inspectFallback(source,filter,limit) {
  const Model=source==='items'?Item:source==='posts'?Post:Reply;
  let query=Model.find(filter);
  if(source!=='items')query=query.select(source==='posts'?postFields:replyFields).sort({updatedAt:1,_id:1}).limit(limit);
  const rows=await query.lean(),ids=rows.map(row=>String(row._id));
  if(!rows.length)return [];
  const items=source==='items'?rows:await Item.find({_id:{$in:ids}}).select(versions).lean();
  const posts=source==='posts'?rows:await Post.find({_id:{$in:[...new Set(rows.map(row=>source==='items'?row.post:row.postId))]}}).select(postFields).lean();
  const replies=source==='replies'?rows:source==='items'?await Reply.find({_id:{$in:rows.filter(row=>row.kind==='answer').map(row=>row._id)}}).select(replyFields).lean():[];
  const books=await Book.find({_id:{$in:[...new Set(posts.map(row=>row.bookId).filter(Boolean))]}}).select(bookFields).lean();
  const map=values=>new Map(values.map(row=>[String(row._id),row]));
  const byPost=map(posts),byReply=map(replies),byBook=map(books),byItem=map(items);
  return rows.map(row=>{
    const id=String(row._id),entry=byItem.get(id),post=byPost.get(source==='items'?row.post:source==='posts'?id:String(row.postId)),reply=byReply.get(id);
    const book=byBook.get(String(post?.bookId)),answer=source==='replies'||source==='items'&&row.kind==='answer';
    const valid=!!(post&&(!post.bookId||book&&!book.deletedAt&&book.visibility!=='private')&&(answer?
      reply&&String(reply.postId)===String(post._id)&&post.type==='question'&&!['withheld','duplicate'].includes(reply.curation?.status):
      post.type==='article'||post.type==='question'&&!post.replyCount));
    const stale=!entry?.postUpdatedAt||['postUpdatedAt','replyUpdatedAt'].some(key=>+(entry?.[key]||0)!==+(recommendationVersions(post||{},reply,book)[key]||0))||
      JSON.stringify(entry.bookMetadata)!==JSON.stringify(bookMetadata(book));
    return {_id:id,valid,stale,exists:!!entry,updatedAt:row.updatedAt,...(source==='items'?{row:entry,counts:{
      votes:post?.likes,views:post?.views,comments:post?.replyCount,replyVotes:reply?.likes,replyComments:reply?.comments,
    }}:{})};
  });
}
async function inspect(source,filter,limit) {
  if(mongoose.connection.transport)return inspectFallback(source,filter,limit);
  const Model=source==='items'?Item:source==='posts'?Post:Reply;
  return Model.aggregate(metadataPipeline(source,filter,limit)).option({maxTimeMS:5000});
}
export const inspectRecommendationItems=ids=>inspect('items',{_id:{$in:ids}});
export const inspectCatalogBatch=(source,filter,limit)=>inspect(source,filter,limit);
