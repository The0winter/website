import fs from 'node:fs/promises';
import mongoose from 'mongoose';
const state=JSON.parse(await fs.readFile('.runtime/staging.json','utf8'));
if(state.env.APP_ENV!=='test'||!/^mongodb:\/\/127\.0\.0\.1:\d+\/test1_test\?/.test(state.uri))throw new Error('Synthetic staging required');
await mongoose.connect(state.uri,{autoIndex:false,autoCreate:false,serverSelectionTimeoutMS:5000,maxPoolSize:2});
try{
  const plans={};
  const chapterId=new mongoose.Types.ObjectId(state.chapterId),bookId=new mongoose.Types.ObjectId(state.bookId);
  const queries={body:()=>mongoose.connection.collection('chapters').find({_id:chapterId,deletedAt:null}).limit(1),catalog:()=>mongoose.connection.collection('chapters').find({bookId,deletedAt:null}).project({title:1,chapter_number:1}).sort({chapter_number:1}).limit(100),rank:()=>mongoose.connection.collection('books').find({deletedAt:null}).sort({views:-1,_id:1}).limit(20),search:()=>mongoose.connection.collection('books').find({deletedAt:null,title:/合成/i}).sort({views:-1,_id:1}).limit(20)};
  for(const [name,query]of Object.entries(queries)){
    const plan=await query().maxTimeMS(5000).explain('executionStats');
    plans[name]={returned:plan.executionStats.nReturned,keysExamined:plan.executionStats.totalKeysExamined,documentsExamined:plan.executionStats.totalDocsExamined,executionMs:plan.executionStats.executionTimeMillis,winningPlan:plan.queryPlanner.winningPlan};
  }
  const status=await mongoose.connection.db.admin().serverStatus();
  await fs.writeFile('artifacts/query-plans.json',JSON.stringify({at:new Date().toISOString(),plans,mongodb:{connections:status.connections,memory:status.mem,cacheBytes:status.wiredTiger?.cache?.['bytes currently in the cache']},limitations:'Single sample during synthetic mixed load; substring search is not a text index'},null,2));
  console.log(JSON.stringify(Object.fromEntries(Object.entries(plans).map(([key,value])=>[key,{returned:value.returned,keys:value.keysExamined,docs:value.documentsExamined,ms:value.executionMs}]))));
}finally{await mongoose.disconnect();}
