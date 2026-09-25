import '../../tools/test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {TestDatabase} from '../database/testing.js';
import User from '../models/User.js';
import Session from '../models/Session.js';
import {security, SESSION_IDLE_MS, SESSION_REFRESH_MS} from '../security.js';
import {authRoutes} from '../routes/auth.js';
import {createApp} from '../app.js';

test('three-day idle sessions, renewal budget and revocation', async t => {
  const db = await TestDatabase.create();
  await mongoose.connect(db.getUri(), {autoIndex:false});
  let now = Math.floor(Date.now()/1000)*1000;
  t.mock.method(Date, 'now', () => now);
  const secret = crypto.randomBytes(48).toString('hex');
  const config = {mode:'test',jwtSecret:secret,origins:['http://127.0.0.1:3000']};
  const app = express(); app.use(express.json());
  const auth = security(app, config); authRoutes(app, auth, config);
  app.use((error,req,res,next) => res.status(error.status || 500).json({error:error.message}));
  const server = app.listen(0,'127.0.0.1');
  await new Promise(resolve => server.once('listening',resolve));
  t.after(async () => {await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); await db.stop();});
  const base = `http://127.0.0.1:${server.address().port}`, password = 'Idle-test-password-123';
  const hash = await bcrypt.hash(password,4);
  const [reader,admin] = await User.create(['reader','admin'].map(role => ({username:role,email:`${role}@example.test`,password:hash,role})));
  function client(origin=base) {
    const jar = new Map();
    const request = async (path, method='GET', body, csrf) => {
      const response = await fetch(origin+path,{method,headers:{cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; '),
        origin:config.origins[0],'content-type':'application/json',...(csrf?{'x-csrf-token':csrf}:{})},body:body===undefined?undefined:JSON.stringify(body)});
      for (const cookie of response.headers.getSetCookie()) {const [key,...value]=cookie.split(';')[0].split('=');jar.set(key,value.join('='));}
      return {status:response.status,data:await response.json(),headers:response.headers};
    };
    const csrf = async () => (await request('/api/auth/csrf')).data.csrfToken;
    const write = async (path,body={}) => request(path,'POST',body,await csrf());
    return {jar,request,write,csrf,login: user => write('/api/auth/signin',{email:user.email,password}),sid:()=>jwt.decode(jar.get('session')).sid};
  }
  await t.test('reader and administrator both receive 72 hours',async () => {
    for (const user of [reader,admin]) {
      const c=client(), result=await c.login(user);
      assert.equal(result.status,200);
      assert.match(result.headers.getSetCookie().find(row=>row.startsWith('session=')),/Max-Age=259200/);
      assert.equal(jwt.decode(c.jar.get('session')).exp*1000,now+SESSION_IDLE_MS);
      const session=await Session.findById(c.sid());
      assert.equal(+session.lastActiveAt,now);assert.equal(+session.expiresAt,now+SESSION_IDLE_MS);
    }
  });
  await t.test('GET checks never renew; early activity has two auth reads and zero writes',async st => {
    const c=client();await c.login(reader);const initial=now;
    now+=SESSION_REFRESH_MS-1000;
    const original=Session.updateOne, writes=st.mock.method(Session,'updateOne',function(...args){return original.apply(this,args);});
    const find=Session.findOne, reads=st.mock.method(Session,'findOne',function(...args){return find.apply(this,args);});
    const userFind=User.findById, users=st.mock.method(User,'findById',function(...args){return userFind.apply(this,args);});
    for(let i=0;i<6;i++)assert.equal((await c.write('/api/auth/activity')).status,200);
    assert.equal(writes.mock.callCount(),0);assert.equal(reads.mock.callCount(),6);assert.equal(users.mock.callCount(),6);
    assert.equal((await c.request('/api/auth/session')).status,200);
    assert.equal(+(await Session.findById(c.sid())).expiresAt,initial+SESSION_IDLE_MS);
  });
  await t.test('activity resets expiry and old CSRF token survives JWT rotation',async () => {
    const c=client();await c.login(admin);const oldToken=c.jar.get('session'), csrf=await c.csrf();
    now+=SESSION_REFRESH_MS;
    assert.equal((await c.request('/api/auth/activity','POST',{},csrf)).status,200);
    assert.notEqual(c.jar.get('session'),oldToken);
    assert.equal(jwt.decode(c.jar.get('session')).exp*1000,now+SESSION_IDLE_MS);
    assert.equal(+(await Session.findById(c.sid())).expiresAt,now+SESSION_IDLE_MS);
    assert.equal((await c.request('/api/auth/activity','POST',{},csrf)).status,200);
    assert.equal((await c.request('/api/auth/activity','POST',{})).status,403);
  });
  await t.test('concurrent activity shares one renewal and later bursts do not write',async st => {
    const c=client();await c.login(reader);now+=SESSION_REFRESH_MS;
    const session=await Session.findById(c.sid());
    const original=Session.updateOne, writes=st.mock.method(Session,'updateOne',function(...args){return original.apply(this,args);});
    const cookies=[];const response={cookie:(...args)=>cookies.push(args)};
    await Promise.all(Array.from({length:30},()=>auth.renew({authSession:session},response)));
    assert.equal(writes.mock.callCount(),1);
    const current=await Session.findById(c.sid());
    await Promise.all(Array.from({length:30},()=>auth.renew({authSession:current},response)));
    assert.equal(writes.mock.callCount(),1);assert.equal(+current.expiresAt,now+SESSION_IDLE_MS);
  });
  await t.test('active use continues beyond original lifetime and expires exactly when idle',async () => {
    const c=client();await c.login(reader);
    for(let i=0;i<8;i++){now+=2*86400000;assert.equal((await c.write('/api/auth/activity')).status,200);}
    now+=SESSION_IDLE_MS-1000;assert.equal((await c.request('/api/auth/session')).status,200);
    now+=1000;assert.equal((await c.write('/api/auth/activity')).status,401);
  });
  await t.test('database expiry is enforced even with an unexpired JWT',async () => {
    const c=client();await c.login(admin);
    await Session.updateOne({_id:c.sid()},{$set:{expiresAt:new Date(now)}});
    assert.equal((await c.write('/api/auth/activity')).status,401);
  });
  await t.test('valid old sessions upgrade on activity without logging out',async () => {
    const c=client(), sid=crypto.randomBytes(32).toString('hex');
    await Session.create({_id:sid,userId:admin._id,authVersion:0,expiresAt:new Date(now+43200000)});
    c.jar.set('session',jwt.sign({id:String(admin._id),sid},secret,{expiresIn:43200}));
    assert.equal((await c.write('/api/auth/activity')).status,200);
    assert.equal(jwt.decode(c.jar.get('session')).exp*1000,now+SESSION_IDLE_MS);
    assert.equal(+(await Session.findById(sid)).lastActiveAt,now);
  });
  await t.test('logout and a racing renewal never recreate a deleted session',async () => {
    const c=client();await c.login(reader);const sid=c.sid(), stale=await Session.findById(sid);
    now+=SESSION_REFRESH_MS;assert.equal((await c.write('/api/auth/logout')).status,200);
    await auth.renew({authSession:stale},{cookie:()=>assert.fail('revoked session must not set a cookie')});
    assert.equal(await Session.findById(sid),null);
    assert.equal((await c.write('/api/auth/activity')).status,401);
  });
  await t.test('ban and auth version changes remain immediate',async () => {
    const c=client();await c.login(reader);
    await User.updateOne({_id:reader._id},{$set:{isBanned:true}});
    assert.equal((await c.write('/api/auth/activity')).status,401);
    await User.updateOne({_id:reader._id},{$set:{isBanned:false},$inc:{authVersion:1}});
    assert.equal((await c.write('/api/auth/activity')).status,401);
  });
  await t.test('activity cannot exhaust the shared-network login attempt budget',async () => {
    const fullServer=createApp(config).listen(0,'127.0.0.1');
    await new Promise(resolve=>fullServer.once('listening',resolve));
    try {
      const guest=client(`http://127.0.0.1:${fullServer.address().port}`);
      for(let i=0;i<25;i++)assert.equal((await guest.write('/api/auth/activity')).status,401);
      assert.equal((await guest.login(admin)).status,200);
    } finally {await new Promise(resolve=>fullServer.close(resolve));}
  });
});
