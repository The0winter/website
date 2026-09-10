import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import {MongoMemoryReplSet} from 'mongodb-memory-server';
import {createApp} from '../app.js';
import {readConfig} from '../config.js';
import Book from '../models/Book.js';
import Chapter from '../models/Chapter.js';
import User from '../models/User.js';
import ParagraphComment from '../models/ParagraphComment.js';
import {readerParagraphs} from '../../shared/reader-paragraphs.mjs';

test('paragraph identities preserve prose and survive unrelated insertion',()=>{
  const body='第1章 山间来信\r\n\r\n信中写着作者：小林。\r\n他打开 www.example.test 看信。\n相同的话。\n相同的话。';
  const rows=readerParagraphs(body,'山间来信',1);
  assert.equal(rows.length,4);assert.notEqual(rows[2].key,rows[3].key);
  assert.deepEqual(readerParagraphs('新的一段。\n'+body,'山间来信',1).slice(1),rows);
  assert.notEqual(readerParagraphs('改过的话。')[0].key,rows[2].key);
});

test('real MongoDB paragraph comments: authentication, persistence, idempotency, pagination and ownership',async t=>{
  const repl=await MongoMemoryReplSet.create({binary:{version:'7.0.40'},replSet:{count:1,storageEngine:'wiredTiger'}});
  const config=readConfig({APP_ENV:'test',MONGO_URI:repl.getUri('test1_test'),JWT_SECRET:crypto.randomBytes(48).toString('hex')});
  await mongoose.connect(config.uri,{autoIndex:false});
  for(const model of Object.values(mongoose.models))await model.createIndexes();
  const server=createApp(config).listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  function client(){
    const jar=new Map();
    async function request(path,method='GET',body,extra={}){
      const response=await fetch(base+path,{method,headers:{cookie:[...jar].map(([key,value])=>`${key}=${value}`).join('; '),...(body===undefined?{}:{'content-type':'application/json'}),...extra},body:body===undefined?undefined:JSON.stringify(body)});
      for(const cookie of response.headers.getSetCookie()){const [key,...value]=cookie.split(';')[0].split('=');jar.set(key,value.join('='));}
      return {status:response.status,data:await response.json()};
    }
    async function write(path,method,body){const csrf=await request('/api/auth/csrf');return request(path,method,body,{origin:'http://127.0.0.1:3000','x-csrf-token':csrf.data.csrfToken});}
    return {request,write};
  }
  try{
    const password=await bcrypt.hash('Local-test-password',10);
    const [a,b,admin]=await User.create([{username:'one',email:'one@example.test',password},{username:'two',email:'two@example.test',password},{username:'admin',email:'admin@example.test',password,role:'admin'}]);
    const book=await Book.create({title:'段评测试',author_id:a._id});
    const chapter=await Chapter.create({bookId:book._id,title:'山间来信',chapter_number:1,content:'第一段，清晨的风穿过山林。\n第二段，远方传来了钟声。'});
    const paragraphs=readerParagraphs(chapter.content,chapter.title,1);
    const endpoint=`/api/chapters/${chapter.id}/paragraph-comments`,url=endpoint+'/'+paragraphs[0].key;
    const owner=client(),other=client(),administrator=client(),guest=client();
    for(const [c,u] of [[owner,a],[other,b],[administrator,admin]])assert.equal((await c.write('/api/auth/signin','POST',{email:u.email,password:'Local-test-password'})).status,200);
    const body={content:'这段写得很有画面感。',requestId:crypto.randomUUID()};
    assert.equal((await guest.request(url,'POST',body)).status,403);
    assert.equal((await guest.write(url,'POST',body)).status,401);
    let id;
    await t.test('concurrent retries persist once and do not expose account secrets',async()=>{
      const requests=await Promise.all(Array.from({length:3},()=>owner.write(url,'POST',body)));
      for(const response of requests)assert.equal(response.status,201);
      id=requests[0].data.id;assert(requests.every(response=>response.data.id===id));assert.equal(await ParagraphComment.countDocuments(),1);
      const fetched=await guest.request(url);assert.equal(fetched.data.items[0].content,body.content);
      assert.deepEqual(Object.keys(fetched.data.items[0].user).sort(),['avatar','id','username']);
      assert.equal((await guest.request(endpoint)).data.counts[paragraphs[0].key],1);
      assert.equal((await owner.write(url,'POST',{...body,content:'不同请求'})).status,409);
    });
    await t.test('unrelated edits retain annotations; edited text does not inherit them',async()=>{
      await Chapter.updateOne({_id:chapter._id},{$set:{content:'新增段落。\n'+chapter.content}});
      assert.equal((await guest.request(url)).data.items[0].id,id);
      await Chapter.updateOne({_id:chapter._id},{$set:{content:'完全修改后的文字。'}});
      assert.equal((await guest.request(url)).status,409);
      assert.equal((await owner.write(url,'POST',{...body,requestId:crypto.randomUUID()})).status,409);
      await Chapter.updateOne({_id:chapter._id},{$set:{content:chapter.content}});
    });
    await t.test('body, paragraph and pagination validation reject invalid requests',async()=>{
      assert.equal((await owner.write(url,'POST',{...body,content:' '})).status,400);
      assert.equal((await owner.write(url,'POST',{...body,content:'长'.repeat(1001)})).status,400);
      assert.equal((await owner.write(url,'POST',{...body,user:String(b._id)})).status,400);
      assert.equal((await guest.request(endpoint+'/invalid')).status,400);
      assert.equal((await guest.request(url+'?page=-1')).status,400);
      assert.equal((await guest.request('/api/chapters/not-an-id/paragraph-comments')).status,400);
    });
    await t.test('counts and bounded pagination reflect every saved comment',async()=>{
      await ParagraphComment.insertMany(Array.from({length:21},(_,index)=>({book:book._id,chapter:chapter._id,paragraphKey:paragraphs[0].key,paragraphText:paragraphs[0].text,user:b._id,content:`评论${index}`,requestId:crypto.randomUUID()})));
      const first=await guest.request(url),second=await guest.request(url+'?page=2');
      assert.equal(first.data.total,22);assert.equal(first.data.items.length,20);assert.equal(second.data.items.length,2);
      assert.equal((await guest.request(endpoint)).data.counts[paragraphs[0].key],22);
    });
    await t.test('only author or administrator can delete; deleted books hide comments',async()=>{
      assert.equal((await other.write(url+'/'+id,'DELETE')).status,403);
      assert.equal((await owner.write(url+'/'+id,'DELETE')).status,200);
      const another=(await guest.request(url)).data.items[0].id;
      assert.equal((await administrator.write(url+'/'+another,'DELETE')).status,200);
      assert.equal((await guest.request(endpoint)).data.counts[paragraphs[0].key],20);
      await Book.updateOne({_id:book._id},{$set:{deletedAt:new Date()}});
      assert.equal((await guest.request(url)).status,404);
      assert.equal((await guest.request(endpoint)).status,404);
    });
  }finally{await new Promise(resolve=>server.close(resolve));await mongoose.disconnect();await repl.stop();}
});
