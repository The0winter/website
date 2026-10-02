import '../../tools/test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import {TestDatabase} from '../database/testing.js';
import {createApp} from '../app.js';
import {readConfig} from '../config.js';
import User from '../models/User.js';
import Book from '../models/Book.js';
import Chapter from '../models/Chapter.js';
import Manuscript from '../models/Manuscript.js';
import Submission from '../models/TransferSubmission.js';
import Capacity from '../models/TransferCapacity.js';
import {prepareTransfer,parseTransfer,transferStoredLimit} from '../services/transfer-text.js';
import {createTransferStorage} from '../services/transfer-storage.js';

test('TXT decoding preserves content, bounds chapters and refuses binary/invalid inputs',async()=>{
  const text='序言\r\n第一章开端\r\n<script>alert(1)</script>\r\n第二章 继续\r\n尾声';
  const parsed=await parseTransfer(Buffer.from(text),'story.TXT');
  assert.equal(parsed.chapters.length,3);assert.equal(parsed.text,text.replace(/\r\n/g,'\n'));
  assert.equal(parsed.chapters.map(c=>c.content).join('\n'),parsed.text);
  assert.equal(prepareTransfer(Buffer.from([0xd6,0xd0,0xce,0xc4]),'gb.txt').text,'中文');
  assert.equal(prepareTransfer(Buffer.concat([Buffer.from([255,254]),Buffer.from('中文','utf16le')]),'u.txt').text,'中文');
  const long='长'.repeat(380000),parts=prepareTransfer(Buffer.from(long),'long.txt');
  assert.equal(parts.chapters.map(c=>c.content).join(''),long);assert.equal(parts.chapters.length,3);
  for(const [bytes,name] of [[Buffer.from('safe'),'x.zip'],[Buffer.from('safe'),'../x.txt'],[Buffer.from([0,1,2]),'x.txt'],[Buffer.alloc(0),'x.txt'],[Buffer.from([0xff]),'x.txt']])assert.throws(()=>prepareTransfer(bytes,name));
});
test('private storage checks readback and prevents arbitrary object keys',async()=>{
  const objects=new Map(),id='a'.repeat(24),text='安全文本',sha=crypto.createHash('sha256').update(text).digest('hex');
  const storage=createTransferStorage({bucket:'test-submissions'},{async send(command){const {Key,Body}=command.input;if(command.constructor.name==='PutObjectCommand'){objects.set(Key,Buffer.from(Body));return {};}if(command.constructor.name==='DeleteObjectCommand'){objects.delete(Key);return {};}return {ContentLength:objects.get(Key).length,Body:(async function*(){yield objects.get(Key);})()};}});
  await storage.write(id,text,sha);assert.equal((await storage.read(id,sha)).toString(),text);
  await assert.rejects(storage.read(id,'bad'),/integrity/);await assert.rejects(storage.remove('../other'));
  await storage.remove(id);assert.equal(objects.size,0);
});
test('submission security, quotas, review, resumable import and per-work statistics',async t=>{
  const db=await TestDatabase.create(),config=readConfig({APP_ENV:'test',DATABASE_URL:db.getUri(),JWT_SECRET:crypto.randomBytes(48).toString('hex')});
  await mongoose.connect(config.uri,{autoIndex:false});
  for(const model of Object.values(mongoose.models)){await model.createCollection();await model.createIndexes();}
  const app=createApp(config),objects=new Map();
  app.locals.transferStorage={async write(id,text){objects.set(id,Buffer.from(text));},async read(id){return objects.get(id);},async remove(id){objects.delete(id);}};
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  const password='Transfer-test-123',hash=await bcrypt.hash(password,4);
  const [owner,other,admin]=await User.create(['owner','other','admin'].map(name=>({username:name,email:`${name}@example.test`,password:hash,role:name==='admin'?'admin':'reader'})));
  function client(){
    const jar=new Map();
    async function request(path,method='GET',body,headers={}){
      const raw=Buffer.isBuffer(body);
      const response=await fetch(base+path,{method,headers:{cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; '),...(body!==undefined?{'content-type':raw?'application/octet-stream':'application/json'}:{}),...headers},body:body===undefined?undefined:raw?body:JSON.stringify(body)});
      for(const c of response.headers.getSetCookie()){const [k,...v]=c.split(';')[0].split('=');jar.set(k,v.join('='));}
      return {status:response.status,data:await response.json()};
    }
    return {request,async write(path,method,body,headers={}){const csrf=await request('/api/auth/csrf');return request(path,method,body,{origin:'http://127.0.0.1:3000','x-csrf-token':csrf.data.csrfToken,...headers});}};
  }
  const a=client(),b=client(),c=client(),guest=client();
  const text=Array.from({length:23},(_,i)=>`第${i+1}章 开始\n这一章的正文，保留全部内容。`).join('\n'),bytes=Buffer.from(text);
  async function reserve(client,title='搬运测试',size=bytes.length,id=crypto.randomBytes(12).toString('hex')){return client.write('/api/transfers','POST',{title,author:'原作者',filename:'book.txt',size},{'idempotency-key':id});}
  let submission;
  try{
    for(const [client,user] of [[a,owner],[b,other],[c,admin]])assert.equal((await client.write('/api/auth/signin','POST',{email:user.email,password})).status,200);
    await t.test('authentication and CSRF precede uploads; metadata cannot grant ownership',async()=>{
      assert.equal((await guest.request('/api/transfers')).status,401);
      assert.equal((await a.request('/api/transfers','POST',{})).status,403);
      assert.equal((await guest.write('/api/transfers','POST',{})).status,401);
      const saved=await reserve(a);assert.equal(saved.status,201,JSON.stringify(saved));submission=saved.data;
      assert.equal((await reserve(a,'搬运测试',bytes.length,submission.id)).data.id,submission.id);
      assert.equal((await b.write(`/api/transfers/${submission.id}/file`,'PUT',bytes)).status,404);
      assert.equal((await a.request(`/api/transfers/${submission.id}/preview`)).status,403);
      assert.equal((await a.request('/api/transfers?review=true')).status,403);
    });
    await t.test('exact byte length, text decoding, private preview and no book before review',async()=>{
      assert.equal((await a.write(`/api/transfers/${submission.id}/file`,'PUT',Buffer.from('short'))).status,413);
      const uploaded=await a.write(`/api/transfers/${submission.id}/file`,'PUT',bytes);assert.equal(uploaded.status,200,JSON.stringify(uploaded));assert.equal(uploaded.data.chapterCount,23);
      assert.equal(await Book.countDocuments({title:'搬运测试'}),0);
      const preview=await c.request(`/api/transfers/${submission.id}/preview`);assert.equal(preview.data.text,text);
      assert.equal((await b.request('/api/transfers')).data.items.length,0);
    });
    await t.test('approval stages private chapters, resumes without duplicates, publishes complete book',async()=>{
      assert.equal((await a.write(`/api/transfers/${submission.id}/approve`,'POST',{})).status,403);
      const first=await c.write(`/api/transfers/${submission.id}/approve`,'POST',{});assert.equal(first.status,200,JSON.stringify(first));assert.equal(first.data.status,'importing');
      const staged=await Book.findOne({title:'搬运测试'});assert.equal(staged.visibility,'private');assert.equal(staged.author_id,undefined);
      assert.equal((await guest.request(`/api/books/${staged._id}`)).status,404);
      const second=await c.write(`/api/transfers/${submission.id}/approve`,'POST',{});assert.equal(second.data.status,'accepted',JSON.stringify(second));
      assert.equal((await Book.findById(staged._id)).visibility,'public');assert.equal(await Chapter.countDocuments({bookId:staged._id}),23);
      const chapters=await Chapter.find({bookId:staged._id}).sort({chapter_number:1});assert.equal(chapters.map(c=>c.content).join('\n'),text);
      assert.equal((await c.write(`/api/transfers/${submission.id}/approve`,'POST',{})).data.status,'accepted');
      assert.equal(await Book.countDocuments({title:'搬运测试'}),1);
    });
    await t.test('duplicate works cannot overwrite; rejected originals release reserved capacity',async()=>{
      const dup=(await reserve(b)).data;await b.write(`/api/transfers/${dup.id}/file`,'PUT',bytes);
      assert.equal((await c.write(`/api/transfers/${dup.id}/approve`,'POST',{})).status,409);
      assert.equal((await c.write(`/api/transfers/${dup.id}/reject`,'POST',{reason:'已有作品'})).status,200);
      assert.equal(objects.has(dup.id),false);assert.equal((await Submission.findById(dup.id)).released,true);
      assert.equal((await Capacity.findById('global')).reserved,transferStoredLimit);
    });
    await t.test('daily quota persists and malformed types cannot bypass metadata validation',async()=>{
      assert.equal((await reserve(a,'第二本')).status,201);assert.equal((await reserve(a,'第三本')).status,201);assert.equal((await reserve(a,'第四本')).status,429);
      assert.equal(await Submission.countDocuments({owner:owner._id}),3);
    });
    await t.test('statistics are scoped to the selected owned book or private draft',async()=>{
      const [one,two]=await Book.create([{title:'甲',author_id:owner._id,views:11},{title:'乙',author_id:owner._id,views:22}]);
      const result=await a.request(`/api/writer/statistics?work=b_${one._id}`);assert.equal(result.data.totalViews,11);assert.equal(result.data.workTitle,'甲');
      assert.equal((await b.request(`/api/writer/statistics?work=b_${one._id}`)).status,404);
      const key=crypto.randomUUID();await Manuscript.create({_id:`${owner._id}:${key}`,owner:owner._id,title:'私密草稿'});
      const draft=await a.request(`/api/writer/statistics?work=m_${key}`);assert.equal(draft.data.workTitle,'私密草稿');assert.equal(draft.data.totalViews,0);
      assert.equal((await a.request('/api/writer/statistics')).data.totalViews,33);assert.ok(two);
    });
  }finally{await new Promise(r=>server.close(r));await mongoose.disconnect();await db.stop();}
});
