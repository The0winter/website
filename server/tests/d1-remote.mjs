// Explicit, server-side migration rehearsal. Uses only its own unique probe
// table for writes; application endpoints are exercised in readonly mode.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import mongoose from 'mongoose';
import {connectDatabase} from '../database/index.js';
import {identifier,literal} from '../database/codec.js';
import {createApp} from '../app.js';
import {readConfig} from '../config.js';
import Book from '../models/Book.js';
import Chapter from '../models/Chapter.js';
import User from '../models/User.js';
import WriterDraft from '../models/WriterDraft.js';
import bcrypt from 'bcryptjs';
import {createWritingStorage} from '../services/writing-storage.js';
import {r2Client,bodyHash} from '../services/r2.js';
import {DeleteObjectCommand} from '@aws-sdk/client-s3';

const database=process.env.CLOUDFLARE_D1_DATABASE_ID;
if(process.env.WRITE_MODE!=='readonly'||process.argv[2]!==database)throw new Error('Exact readonly rehearsal target required');
const uri=`d1://${process.env.CLOUDFLARE_ACCOUNT_ID}/${database}`;
await connectDatabase(uri);
const connection=mongoose.connection,name='migrationprobe_'+randomBytes(8).toString('hex'),probe=connection.collection(name);
let server;
let fixtureUser,fixtureBook,publishedKey,legacyKey;
try {
  await probe.createIndex({key:1},{unique:true});
  await probe.insertOne({_id:'a',key:'a',count:0,when:new Date('2026-09-15T00:00:00Z'),body:'完整中文正文。'.repeat(20000)});
  await probe.insertOne({_id:'b',key:'b',count:0});
  await Promise.all(Array.from({length:4},()=>probe.updateOne({_id:'a'},{$inc:{count:1}})));
  assert.equal((await probe.findOne({_id:'a'})).count,4);
  await assert.rejects(connection.transaction(async session=>{
    await probe.updateOne({_id:'a'},{$inc:{count:100}},{session});
    await probe.updateOne({_id:'b'},{$set:{key:'a'}},{session});
  }),error=>error.code===11000);
  const preserved=await probe.findOne({_id:'a'});
  assert.equal(preserved.count,4);assert.equal(preserved.body,'完整中文正文。'.repeat(20000));
  assert.equal(preserved.when.toISOString(),'2026-09-15T00:00:00.000Z');
  assert.equal((await probe.findOne({_id:'b'})).key,'b');
  server=createApp(readConfig({...process.env,DATABASE_URL:uri,PORT:'0',WRITE_MODE:'readonly'})).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`,book=await Book.findOne({deletedAt:null}).lean();
  const chapter=await Chapter.findOne({bookId:book._id,deletedAt:null}).sort({chapter_number:1}).lean();
  const results=[];
  for(const endpoint of ['/health/ready','/api/books','/api/books?orderBy=rank_total',`/api/books/${book._id}`,`/api/books/${book._id}/catalog?limit=200`,`/api/books/${book._id}/statistics`,`/api/chapters/${chapter._id}`,`/api/chapters/${chapter._id}/paragraph-comments`]) {
    const start=performance.now(),response=await fetch(base+endpoint,{signal:AbortSignal.timeout(30000)});
    assert.equal(response.status,200,endpoint);const data=await response.json();
    if(endpoint===`/api/chapters/${chapter._id}`)assert.ok(data.content.length>100);
    results.push({endpoint,status:response.status,ms:Math.round(performance.now()-start)});
  }
  await new Promise(resolve=>server.close(resolve));server=null;
  const password=randomBytes(24).toString('hex'),suffix=randomBytes(6).toString('hex');
  fixtureUser=await User.create({username:'迁移验证'+suffix,email:`migration-${suffix}@example.invalid`,password:await bcrypt.hash(password,10)});
  fixtureBook=await Book.create({title:'迁移验证 '+suffix,author_id:fixtureUser._id,visibility:'private'});
  const app=createApp(readConfig({...process.env,DATABASE_URL:uri,PORT:'0',WRITE_MODE:'readwrite'}));
  app.locals.writingCleanupEnabled=false;
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const writable=`http://127.0.0.1:${server.address().port}`,jar=new Map();
  async function request(endpoint,method='GET',body) {
    const headers={};
    if(method!=='GET'){headers.origin=process.env.ALLOWED_ORIGINS.split(',')[0];headers['x-csrf-token']=(await request('/api/auth/csrf')).data.csrfToken;headers['content-type']='application/json';}
    headers.cookie=[...jar].map(([k,v])=>`${k}=${v}`).join('; ');
    const response=await fetch(writable+endpoint,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
    for(const cookie of response.headers.getSetCookie()){const [k,...v]=cookie.split(';')[0].split('=');jar.set(k,v.join('='));}
    return {status:response.status,data:await response.json()};
  }
  assert.equal((await request('/api/auth/signin','POST',{email:fixtureUser.email,password})).status,200);
  assert.equal((await request('/api/auth/session')).status,200);
  assert.equal((await request(`/api/users/${fixtureUser.id}/history`,'POST',{bookId:String(book._id),chapterId:String(chapter._id)})).status,200);
  assert.equal((await request(`/api/users/${fixtureUser.id}/bookmarks`,'POST',{bookId:String(book._id)})).status,200);
  assert.equal((await request(`/api/users/${fixtureUser.id}/library`)).status,200);
  const endpoint=`/api/writer/workspace/b_${fixtureBook.id}`,content='迁移时的独立验证正文。'+suffix;
  const data={id:'migration-draft',title:'验证章节',content,number:1,revision:0};
  assert.equal((await request(endpoint+'/drafts/migration-draft','PUT',data)).status,200);
  assert.equal((await request(endpoint+'/drafts/migration-draft')).data.content,content);
  publishedKey=`chapters/sha256/${bodyHash(content)}.txt`;
  const published=await request(endpoint+'/publish','POST',{id:data.id,title:data.title,content,number:1,cloudRevision:1});
  assert.equal(published.status,200);
  assert.equal((await request('/api/chapters/'+published.data.chapterId)).data.content,content);
  const legacyBody='旧编辑入口的验证正文。'+suffix;legacyKey=`chapters/sha256/${bodyHash(legacyBody)}.txt`;
  const legacy=await request('/api/chapters','POST',{bookId:fixtureBook.id,title:'旧入口',chapter_number:2,content:legacyBody});
  assert.equal(legacy.status,201);
  const storedLegacy=await Chapter.findById(legacy.data.id).lean();
  assert.equal(storedLegacy.content,undefined);assert.equal(storedLegacy.contentKey,legacyKey);
  const beforeBatch=connection.transport.metrics.requests;
  await connection.transaction(async session=>{
    await session.prefetch('chapters',{bookId:fixtureBook._id});
    for(let i=0;i<50;i++)await Chapter.updateOne({_id:storedLegacy._id},{$inc:{word_count:1}},{session});
  });
  assert.ok(connection.transport.metrics.requests-beforeBatch<=3,'batch edit must not issue per-chapter requests');
  console.log(JSON.stringify({transactions:true,rollback:true,largeDraft:true,typedRoundTrip:true,signin:true,readingHistory:true,r2Draft:true,publication:true,results,metrics:connection.transport.metrics}));
} finally {
  if(server)await new Promise(resolve=>server.close(resolve));
  if(fixtureUser) {
    const storage=createWritingStorage(),client=r2Client();
    try {
      const blobs=await connection.collection('writerblobs').find({_id:{$regex:`^drafts/${fixtureUser.id}/`}}).toArray();
      for(const blob of blobs){await storage.remove(blob._id);await connection.collection('writerblobs').deleteOne({_id:blob._id});}
      for(const Key of [publishedKey,legacyKey].filter(Boolean))await client.send(new DeleteObjectCommand({Bucket:process.env.R2_BUCKET,Key}));
      for(const [collection,field] of [['sessions','userId'],['readinghistories','userId'],['bookmarks','user_id'],['userdailies','userId'],['writerdrafts','owner'],['writerpublications','owner'],['writerdiscards','owner']])await connection.collection(collection).deleteMany({[field]:fixtureUser.id});
      if(fixtureBook){await Chapter.deleteMany({bookId:fixtureBook._id});await Book.deleteOne({_id:fixtureBook._id});}
      await User.deleteOne({_id:fixtureUser._id});
      assert.equal(await WriterDraft.countDocuments({owner:fixtureUser._id}),0);
    } finally {client.destroy();}
  }
  await connection.transport.batch([`DROP TABLE IF EXISTS ${identifier(name)}`,`DELETE FROM _d1_indexes WHERE collection_name=${literal(name)}`]);
  await mongoose.disconnect();
}
