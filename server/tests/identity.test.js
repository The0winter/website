import '../../tools/test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import {TestDatabase} from '../database/testing.js';
import {createApp} from '../app.js';
import Author from '../models/Author.js';
import Book from '../models/Book.js';
import User from '../models/User.js';
import VerificationCode from '../models/VerificationCode.js';
import UsernameReservation from '../models/UsernameReservation.js';
import {migrateIdentities} from '../services/identity-migration.js';
import {usernameKey} from '../services/username-identity.js';

test('author consolidation and permanent username reservations',async t=>{
  const db=await TestDatabase.create();
  const secret='x'.repeat(40),oldImportSecret=process.env.IMPORT_SECRET;
  process.env.IMPORT_SECRET='i'.repeat(40);
  let server;
  try{
    await mongoose.connect(db.getUri(),{autoIndex:false,autoCreate:false});
    for(const model of Object.values(mongoose.models))await model.createIndexes();
    const owner=await User.create({username:'合并作者',email:'owner@example.test',password:'unused'});
    await User.create([{username:'Existing',email:'old@example.test',password:'unused'},{username:'Ｅxisting',email:'variant@example.test',password:'unused'}]);
    const [first,second,unknown1,unknown2]=await Author.create([
      {name:'合并作者',sourceKey:'one'},{name:' 合并作者　',sourceKey:'two'},
      {name:'未知',sourceKey:'unknown-one'},{name:'未知',sourceKey:'unknown-two'},
    ]);
    const works=await Book.create(Array.from({length:23},(_,i)=>({title:`作品${i}`,author:'合并作者',author_profile_id:i%2?second._id:first._id,sourceUrl:`https://example.test/${i}`,importManaged:true,category:'测试',views:i})));
    await Book.create([
      {title:'私密',author:'合并作者',author_profile_id:second._id,visibility:'private'},
      {title:'已删',author:'合并作者',author_profile_id:second._id,deletedAt:new Date()},
      {title:'本人创作',author:owner.username,author_id:owner._id},
      {title:'未知一',author:'未知',author_profile_id:unknown1._id},
      {title:'未知二',author:'未知',author_profile_id:unknown2._id},
    ]);
    const preview=await migrateIdentities();assert.equal(preview.bookUpdates,13);assert.equal(preview.usernameReservations,2);
    assert.equal((await Author.findById(second._id)).mergedInto,undefined);
    await migrateIdentities({apply:true});
    const repeat=await migrateIdentities();assert.equal(repeat.authorUpdates+repeat.bookUpdates+repeat.usernameReservations,0);
    assert.equal(await Book.countDocuments(),28);assert.equal(await User.countDocuments(),3);
    server=createApp({mode:'test',jwtSecret:secret,origins:['http://127.0.0.1:3000'],trustProxy:'none',writeMode:'readwrite'}).listen(0,'127.0.0.1');
    await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
    const read=async path=>{const r=await fetch(base+path);return {status:r.status,data:await r.json(),total:Number(r.headers.get('x-total-count'))};};
    const client=()=>{const jar=new Map();return async(path,body)=>{
      const csrf=await fetch(base+'/api/auth/csrf',{headers:{cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; ')}});
      for(const c of csrf.headers.getSetCookie()){const [key,...value]=c.split(';')[0].split('=');jar.set(key,value.join('='));}
      const r=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json',origin:'http://127.0.0.1:3000',cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; '),'x-csrf-token':(await csrf.json()).csrfToken},body:JSON.stringify(body)});
      return {status:r.status,data:await r.json()};
    };};
    await t.test('every old author link lists all public works with correct filtering and pagination',async()=>{
      for(const profile of [first,second]){
        const p=await read('/api/authors/'+profile._id);assert.equal(p.data.id,String(profile._id));assert.equal(p.data.username,'合并作者');
        const page1=await read(`/api/books?author_id=${profile._id}&limit=20`),page2=await read(`/api/books?author_id=${profile._id}&limit=20&page=2`);
        assert.equal(page1.total,23);assert.equal(page1.data.length,20);assert.equal(page2.data.length,3);
        assert.equal(new Set([...page1.data,...page2.data].map(b=>b.id)).size,23);
        assert.equal((await read(`/api/books?author_id=${profile._id}&q=作品22&category=测试`)).data.length,1);
      }
      assert.equal((await read('/api/books?author_id='+owner._id)).data.length,1);
      for(const profile of [unknown1,unknown2])assert.equal((await read('/api/books?author_id='+profile._id)).data.length,1);
    });
    await t.test('both import paths keep the merged identity and still reject author changes',async()=>{
      for(const missingOnly of [false,true]){
        const payload={title:works[1].title,author:'合并作者',sourceUrl:works[1].sourceUrl,authorSourceUrl:'https://another.test/writer/1',chapters:[],missingOnly};
        const send=body=>fetch(base+'/api/admin/upload-book',{method:'POST',headers:{'content-type':'application/json','x-import-secret':process.env.IMPORT_SECRET},body:JSON.stringify(body)});
        assert.equal((await send(payload)).status,200);
        assert.equal(String((await Book.findById(works[1]._id)).author_profile_id),String(first._id));
        assert.equal((await send({...payload,author:'其他人'})).status,409);
      }
    });
    const payload=async(username,email)=>{
      const code='123456';
      await VerificationCode.create({email,code:crypto.createHmac('sha256',secret).update(email+'\0signup\0'+code).digest('hex'),expiresAt:new Date(Date.now()+300000),attempts:0,consumed:false});
      return {username,email,password:'Test-password-123',code};
    };
    await t.test('legacy usernames and their variants stay reserved without modifying existing accounts',async()=>{
      const body=await payload(' existing ','reuse@example.test');
      for(const name of ['Existing','existing',' ＥＸＩＳＴＩＮＧ ']){
        const result=await client()('/api/auth/signup',{...body,username:name});assert.equal(result.status,409);assert.match(result.data.error,/用户名已被使用/);
      }
      assert.equal((await VerificationCode.findOne({email:body.email})).consumed,false);
      await User.deleteMany({email:{$in:['old@example.test','variant@example.test']}});
      assert.equal((await client()('/api/auth/signup',body)).status,409);
    });
    await t.test('concurrent registrations cannot claim the same normalized username; loser can retry',async()=>{
      const bodies=await Promise.all([payload(' NewName ','new-one@example.test'),payload('ＮｅｗＮａｍｅ','new-two@example.test')]);
      const responses=await Promise.all(bodies.map(body=>client()('/api/auth/signup',body)));
      assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);
      const winner=responses.findIndex(r=>r.status===201),loser=1-winner;
      assert.equal(await User.countDocuments({username:'NewName'}),1);
      assert.equal((await VerificationCode.findOne({email:bodies[loser].email})).consumed,false);
      assert.equal((await client()('/api/auth/signup',{...bodies[loser],username:'AvailableName'})).status,201);
      await User.deleteOne({email:bodies[winner].email});
      assert.equal((await client()('/api/auth/signup',await payload('newname','deleted@example.test'))).status,409);
      assert.ok(await UsernameReservation.exists({_id:usernameKey('NewName')}));
    });
    await t.test('invalid verification cannot reserve a name',async()=>{
      const body=await payload('NotReserved','invalid@example.test');
      assert.equal((await client()('/api/auth/signup',{...body,code:'000000'})).status,400);
      assert.equal(await UsernameReservation.exists({_id:usernameKey(body.username)}),null);
      assert.equal((await client()('/api/auth/signup',body)).status,201);
    });
    await t.test('duplicate email rollback does not reserve the losing username',async()=>{
      const body=await payload('EmailWinner','same-email@example.test');
      const bodies=[body,{...body,username:'EmailLoser'}];
      const results=await Promise.all(bodies.map(value=>client()('/api/auth/signup',value)));
      assert.equal(results.filter(r=>r.status===201).length,1);
      const losing=bodies[results.findIndex(r=>r.status!==201)];
      assert.equal(await UsernameReservation.exists({_id:usernameKey(losing.username)}),null);
    });
  }finally{
    if(server)await new Promise(r=>server.close(r));await mongoose.disconnect();await db.stop();
    if(oldImportSecret===undefined)delete process.env.IMPORT_SECRET;else process.env.IMPORT_SECRET=oldImportSecret;
  }
});
