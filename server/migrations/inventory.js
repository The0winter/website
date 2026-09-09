import crypto from 'node:crypto';
export async function inventory(connection,models){
  const db=connection.db,collections=await db.listCollections().toArray(),present=new Set(collections.map(c=>c.name));
  const issues=[],indexes={},indexChanges={};
  for(const name of present)indexes[name]=await db.collection(name).indexes();
  async function duplicates(collection,fields){
    if(!present.has(collection))return;
    const rows=await db.collection(collection).aggregate([{$group:{_id:Object.fromEntries(fields.map(f=>[f,'$'+f])),count:{$sum:1}}},{$match:{count:{$gt:1}}},{$count:'groups'}],{maxTimeMS:10000}).toArray();
    if(rows[0]?.groups)issues.push({type:'duplicates',collection,fields,count:rows[0].groups});
  }
  async function orphan(collection,field,target){
    if(!present.has(collection))return;
    const rows=await db.collection(collection).aggregate([{$lookup:{from:target,localField:field,foreignField:'_id',as:'relation'}},{$match:{'relation.0':{$exists:false}}},{$count:'rows'}],{maxTimeMS:10000}).toArray();
    if(rows[0]?.rows)issues.push({type:'missing-reference',collection,field,target,count:rows[0].rows});
  }
  for(const [collection,fields] of [['chapters',['bookId','chapter_number']],['users',['email']],['users',['username']],['reviews',['book','user']],['bookmarks',['bookId','user_id']]])await duplicates(collection,fields);
  for(const relation of [['chapters','bookId','books'],['reviews','book','books'],['reviews','user','users'],['bookmarks','bookId','books'],['bookmarks','user_id','users'],['forumreplies','postId','forumposts'],['forumreplycomments','replyId','forumreplies']])await orphan(...relation);
  if(present.has('chapters')){
    const count=await db.collection('chapters').countDocuments({$or:[{chapter_number:{$not:{$type:'number'}}},{chapter_number:{$lte:0}},{title:{$not:{$type:'string'}}},{content:{$not:{$type:'string'}}}]},{maxTimeMS:10000});
    if(count)issues.push({type:'invalid-chapter-fields',count});
  }
  for(const model of Object.values(models)){
    const changes=await model.diffIndexes();indexChanges[model.collection.name]=changes;
    if(changes.toDrop.length)issues.push({type:'index-review',collection:model.collection.name,names:changes.toDrop});
  }
  const plan={version:'r3-v2',database:db.databaseName,issues,indexChanges};
  return {...plan,indexes,fingerprint:crypto.createHash('sha256').update(JSON.stringify(plan)).digest('hex')};
}
