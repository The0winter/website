import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {spawn} from 'node:child_process';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import {MongoMemoryReplSet} from 'mongodb-memory-server';
import {readConfig} from '../config.js';
import {createApp} from '../app.js';
import User from '../models/User.js';
import Book from '../models/Book.js';
import Operation from '../models/Operation.js';

test('isolated storage failure rolls back writes and database restart recovers without repair',async()=>{
  const repl=await MongoMemoryReplSet.create({binary:{version:'7.0.40'},replSet:{count:1},instanceOpts:[{args:['--setParameter','enableTestCommands=1']}]});
  const config=readConfig({APP_ENV:'test',MONGO_URI:repl.getUri('test1_test'),JWT_SECRET:crypto.randomBytes(48).toString('hex')});
  mongoose.set('bufferCommands',false);
  await mongoose.connect(config.uri,{autoIndex:false,serverSelectionTimeoutMS:2000,heartbeatFrequencyMS:500,connectTimeoutMS:2000,socketTimeoutMS:3000});
  for(const model of Object.values(mongoose.models))await model.createIndexes();
  const server=createApp(config).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${server.address().port}`,jar=new Map();
  async function request(path,method='GET',body,headers={}){
    const response=await fetch(base+path,{method,headers:{cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; '),'content-type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(6000)});
    for(const value of response.headers.getSetCookie()){const [key,...parts]=value.split(';')[0].split('=');jar.set(key,parts.join('='));}
    return {status:response.status,data:await response.json()};
  }
  async function write(path,body,headers={}){const csrf=await request('/api/auth/csrf');return request(path,'POST',body,{origin:'http://127.0.0.1:3000','x-csrf-token':csrf.data.csrfToken,...headers});}
  try{
    const user=await User.create({username:'fault-user',email:'fault@example.test',password:await bcrypt.hash('Fault-password-123',10)});
    assert.equal((await write('/api/auth/signin',{email:user.email,password:'Fault-password-123'})).status,200);
    const key=crypto.randomUUID(),data={title:'Durable controlled work'};
    await mongoose.connection.db.admin().command({configureFailPoint:'failCommand',mode:{times:1},data:{failCommands:['insert'],errorCode:8}});
    assert.equal((await write('/api/books',data,{'Idempotency-Key':key})).status,500);
    assert.equal(await Book.countDocuments(),0);assert.equal(await Operation.countDocuments(),0);assert.equal((await User.findById(user._id)).contentVersion,0);
    const retry=await write('/api/books',data,{'Idempotency-Key':key});assert.equal(retry.status,201);
    const id=retry.data.id;
    await repl.stop({doCleanup:false,force:false});
    const deadline=Date.now()+10000;while(mongoose.connection.readyState===1&&Date.now()<deadline)await delay(100);
    const began=performance.now();assert.equal((await request('/health/live')).status,200);assert.equal((await request('/health/ready')).status,503);assert.equal((await request('/api/books')).status,503);assert.ok(performance.now()-began<6000);
    await repl.start();
    const recoveryDeadline=Date.now()+15000;while(mongoose.connection.readyState!==1&&Date.now()<recoveryDeadline)await delay(100);
    assert.equal((await request('/health/ready')).status,200);
    assert.equal((await request('/api/books/'+id)).data.title,data.title);
    assert.equal((await request('/api/auth/session')).status,200);
    const readonly=createApp({...config,writeMode:'readonly'}).listen(0,'127.0.0.1');await new Promise(r=>readonly.once('listening',r));
    try{const url=`http://127.0.0.1:${readonly.address().port}`;assert.equal((await fetch(url+'/api/books')).status,200);assert.equal((await fetch(url+'/api/books',{method:'POST'})).status,503);assert.equal(await Book.countDocuments(),1);}
    finally{await new Promise(r=>readonly.close(r));}
  }finally{await new Promise(r=>server.close(r));await mongoose.disconnect();await repl.stop();}
});

test('standalone API exits on unavailable isolated DB before listening',async()=>{
  const child=spawn(process.execPath,['server/index.js'],{cwd:new URL('../../',import.meta.url),windowsHide:true,env:{...process.env,APP_ENV:'test',MONGO_URI:'mongodb://127.0.0.1:1/test1_test',JWT_SECRET:crypto.randomBytes(48).toString('hex'),PORT:'0',EXTERNAL_SERVICES:'disabled'},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',value=>output+=value);child.stderr.on('data',value=>output+=value);
  const began=Date.now(),code=await new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);});
  assert.equal(code,1);assert.ok(Date.now()-began<10000);assert.doesNotMatch(output,/API ready/);assert.match(output,/Database unavailable/);
});
