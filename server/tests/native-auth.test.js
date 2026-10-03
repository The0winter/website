import '../../tools/test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {TestDatabase} from '../database/testing.js';
import {createApp} from '../app.js';
import {readConfig} from '../config.js';
import User from '../models/User.js';
import NativeSession from '../models/NativeSession.js';
import {capturedMail} from '../utils/sendEmail.js';

test('native authentication with real database and unchanged browser protection', async t => {
  const database = await TestDatabase.create();
  const config = readConfig({APP_ENV:'test', DATABASE_URL:database.getUri(), JWT_SECRET:crypto.randomBytes(48).toString('hex')});
  await mongoose.connect(config.uri, {autoIndex:false});
  for (const model of Object.values(mongoose.models)) await model.createIndexes();
  t.after(async () => {await mongoose.disconnect(); await database.stop();});
  const password = 'Native-password-123', hash = await bcrypt.hash(password, 10);
  let sequence = 0;
  async function setup(st) {
    const index = ++sequence;
    const [user, other, admin] = await User.create([
      {username:`native${index}`,email:`native${index}@example.test`,password:hash},
      {username:`other${index}`,email:`other${index}@example.test`,password:hash},
      {username:`admin${index}`,email:`admin${index}@example.test`,password:hash,role:'admin'},
    ]);
    const server = createApp(config).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening',resolve));
    st.after(() => new Promise(resolve => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function request(path, method='GET', body, token, extra={}) {
      const response = await fetch(base+path, {method, headers:{...(body === undefined ? {} : {'content-type':'application/json'}), ...(token ? {authorization:`Bearer ${token}`} : {}), ...extra}, body:body === undefined ? undefined : JSON.stringify(body)});
      return {status:response.status, data:await response.json(), headers:response.headers};
    }
    const login = async (account=user) => {
      const response = await request('/api/v1/auth/login','POST',{email:account.email,password,deviceName:'Pixel test'});
      assert.equal(response.status,200,JSON.stringify(response.data));
      return response.data;
    };
    return {user,other,admin,request,login};
  }
  await t.test('login returns usable scoped tokens and only a refresh digest is stored', async st => {
    const {user,request,login} = await setup(st), tokens = await login();
    assert.equal(tokens.tokenType,'Bearer'); assert.equal(tokens.expiresIn,600);
    const record = await NativeSession.findById(tokens.sessionId).select('+refreshDigest').lean();
    assert.equal(record.refreshDigest,crypto.createHash('sha256').update(tokens.refreshToken).digest('hex'));
    assert.ok(!JSON.stringify(record).includes(tokens.refreshToken));
    const me = await request('/api/v1/auth/me','GET',undefined,tokens.accessToken);
    assert.equal(me.status,200); assert.equal(me.data.user.id,String(user._id));
    assert.equal(me.headers.getSetCookie().length,0);
    assert.equal((await request(`/api/users/${user._id}`,'PATCH',{profileTheme:'sage'},tokens.accessToken)).status,200);
    assert.equal((await User.findById(user._id)).profileTheme,'sage');
  });
  await t.test('wrong, expired and browser JWTs cannot authenticate or bypass CSRF', async st => {
    const {user,request,login} = await setup(st), tokens = await login();
    const claims = jwt.decode(tokens.accessToken); delete claims.iat;
    const expired = jwt.sign({...claims,exp:Math.floor(Date.now()/1000)-1},config.jwtSecret);
    assert.equal((await request('/api/v1/auth/me','GET',undefined,expired)).data.code,'ACCESS_EXPIRED');
    assert.equal((await request('/api/v1/auth/me','GET',undefined,'forged')).data.code,'ACCESS_INVALID');
    const browser = jwt.sign({id:String(user._id),sid:tokens.sessionId},config.jwtSecret);
    assert.equal((await request('/api/v1/auth/me','GET',undefined,browser)).status,401);
    assert.equal((await request(`/api/users/${user._id}`,'PATCH',{profileTheme:'rose'},'forged')).status,401);
    assert.equal((await request('/api/v1/auth/me')).status,401);
  });
  await t.test('refresh rotates, rejects random tampering, then revokes family on reuse', async st => {
    const {request,login} = await setup(st), initial = await login();
    const tampered = initial.refreshToken.slice(0,-1)+(initial.refreshToken.endsWith('a')?'b':'a');
    assert.equal((await request('/api/v1/auth/refresh','POST',{refreshToken:tampered})).data.code,'REFRESH_INVALID');
    const rotated = await request('/api/v1/auth/refresh','POST',{refreshToken:initial.refreshToken});
    assert.equal(rotated.status,200); assert.notEqual(rotated.data.refreshToken,initial.refreshToken);
    assert.equal((await request('/api/v1/auth/me','GET',undefined,rotated.data.accessToken)).status,200);
    assert.equal((await request('/api/v1/auth/refresh','POST',{refreshToken:initial.refreshToken})).data.code,'REFRESH_REUSED');
    assert.equal((await request('/api/v1/auth/me','GET',undefined,rotated.data.accessToken)).status,401);
    assert.equal((await request('/api/v1/auth/refresh','POST',{refreshToken:rotated.data.refreshToken})).status,401);
  });
  await t.test('concurrent refresh is strict single use; its winning token is also revoked', async st => {
    const {request,login} = await setup(st), initial = await login();
    const results = await Promise.all([1,2].map(() => request('/api/v1/auth/refresh','POST',{refreshToken:initial.refreshToken})));
    assert.deepEqual(results.map(result=>result.status).sort(),[200,401]);
    assert.equal((await request('/api/v1/auth/me','GET',undefined,results.find(result=>result.status===200).data.accessToken)).status,401);
  });
  await t.test('device listing, ownership, targeted revoke and logout', async st => {
    const {other,request,login} = await setup(st), first = await login(), second = await login(), foreign = await login(other);
    const listed = await request('/api/v1/auth/sessions','GET',undefined,first.accessToken);
    assert.equal(listed.data.sessions.length,2); assert.ok(listed.data.sessions.find(row=>row.current).id===first.sessionId);
    assert.ok(!JSON.stringify(listed.data).includes('Digest'));
    assert.equal((await request(`/api/v1/auth/sessions/${foreign.sessionId}`,'DELETE',undefined,first.accessToken)).status,404);
    assert.equal((await request(`/api/v1/auth/sessions/${second.sessionId}`,'DELETE',undefined,first.accessToken)).status,200);
    assert.equal((await request('/api/v1/auth/me','GET',undefined,second.accessToken)).status,401);
    assert.equal((await request('/api/v1/auth/logout','POST',{},first.accessToken)).status,200);
    assert.equal((await request('/api/v1/auth/refresh','POST',{refreshToken:first.refreshToken})).status,401);
  });
  await t.test('admin permissions, bans and unbans never restore old sessions', async st => {
    const {user,admin,request,login} = await setup(st), reader = await login(), administrator = await login(admin);
    assert.equal((await request('/api/admin/users','GET',undefined,reader.accessToken)).status,403);
    assert.equal((await request(`/api/admin/users/${user._id}/ban`,'PATCH',{isBanned:true},reader.accessToken)).status,403);
    assert.equal((await request(`/api/admin/users/${user._id}/ban`,'PATCH',{isBanned:true},administrator.accessToken)).status,200);
    assert.equal((await request('/api/v1/auth/me','GET',undefined,reader.accessToken)).status,401);
    assert.equal((await request(`/api/admin/users/${user._id}/ban`,'PATCH',{isBanned:false},administrator.accessToken)).status,200);
    assert.equal((await request('/api/v1/auth/refresh','POST',{refreshToken:reader.refreshToken})).status,401);
  });
  await t.test('password changes revoke every device and existing web sessions', async st => {
    const {user,request,login} = await setup(st), first = await login(), second = await login();
    const csrf = await request('/api/auth/csrf');
    const cookie = csrf.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
    const browser = await request('/api/auth/signin','POST',{email:user.email,password},undefined,{cookie,origin:config.origins[0],'x-csrf-token':csrf.data.csrfToken});
    assert.equal(browser.status,200);
    const webCookie = browser.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
    assert.equal((await request('/api/auth/session','GET',undefined,undefined,{cookie:webCookie})).status,200);
    assert.equal((await request('/api/v1/auth/change-password','POST',{oldPassword:password,newPassword:'Changed-password-123'},first.accessToken)).status,200);
    assert.equal((await request('/api/v1/auth/me','GET',undefined,second.accessToken)).status,401);
    assert.equal((await request('/api/v1/auth/refresh','POST',{refreshToken:first.refreshToken})).status,401);
    assert.equal((await request('/api/auth/session','GET',undefined,undefined,{cookie:webCookie})).status,401);
  });
  await t.test('browser credentials and origin cannot use native auth; website still needs CSRF', async st => {
    const {user,request,login} = await setup(st), tokens = await login();
    const payload = {email:user.email,password};
    for (const headers of [{origin:config.origins[0]},{cookie:'session=anything'},{'sec-fetch-site':'same-origin'}]) {
      assert.equal((await request('/api/v1/auth/login','POST',payload,undefined,headers)).status,403);
      assert.equal((await request(`/api/users/${user._id}`,'PATCH',{profileTheme:'rose'},tokens.accessToken,headers)).status,403);
    }
    assert.equal((await request('/api/auth/signin','POST',payload)).status,403);
    assert.equal((await request('/api/auth/signin','POST',payload,undefined,{origin:config.origins[0]})).status,403);
    assert.equal((await request('/api/auth/signin','POST',payload,tokens.accessToken)).status,403);
    assert.equal((await request('/api/v1/auth/login','POST',payload,undefined,{'content-type':'text/plain'})).status,415);
  });
  await t.test('website password change invalidates native tokens; expired sessions cannot refresh', async st => {
    const {user,request,login} = await setup(st), first = await login(), expired = await login();
    await NativeSession.updateOne({_id:expired.sessionId},{$set:{expiresAt:new Date(0)}});
    assert.equal((await request('/api/v1/auth/refresh','POST',{refreshToken:expired.refreshToken})).status,401);
    assert.equal((await request('/api/v1/auth/me','GET',undefined,expired.accessToken)).status,401);
    const jar = new Map();
    const capture = response => {for (const value of response.headers.getSetCookie()) {const [key,...parts]=value.split(';')[0].split('=');jar.set(key,parts.join('='));} return response;};
    const cookies = () => [...jar].map(([key,value])=>`${key}=${value}`).join('; ');
    let csrf = capture(await request('/api/auth/csrf'));
    capture(await request('/api/auth/signin','POST',{email:user.email,password},undefined,{cookie:cookies(),origin:config.origins[0],'x-csrf-token':csrf.data.csrfToken}));
    csrf = capture(await request('/api/auth/csrf','GET',undefined,undefined,{cookie:cookies()}));
    assert.equal((await request('/api/auth/change-password','POST',{oldPassword:password,newPassword:'Web-changed-password'},undefined,{cookie:cookies(),origin:config.origins[0],'x-csrf-token':csrf.data.csrfToken})).status,200);
    assert.equal((await request('/api/v1/auth/me','GET',undefined,first.accessToken)).status,401);
    assert.equal((await request('/api/v1/auth/refresh','POST',{refreshToken:first.refreshToken})).status,401);
  });
  await t.test('shared signup verification code is single use and sends no browser cookie', async st => {
    const {request} = await setup(st), email = 'native-signup@example.test';
    assert.equal((await request('/api/v1/auth/send-code','POST',{email})).status,200);
    const code = capturedMail.at(-1).code;
    const response = await request('/api/v1/auth/signup','POST',{email,username:'新原生读者',password,code});
    assert.equal(response.status,201,JSON.stringify(response.data));
    assert.ok(response.data.accessToken); assert.equal(response.headers.getSetCookie().length,0);
    assert.equal((await request('/api/v1/auth/signup','POST',{email,username:'不同用户名',password,code})).status,400);
    assert.equal((await request('/api/v1/auth/me','GET',undefined,response.data.accessToken)).data.user.email,email);
  });
  await t.test('shared account lock and test-account restriction cannot be bypassed', async st => {
    const {user,other,request} = await setup(st);
    await User.updateOne({_id:other._id},{$set:{isTestAccount:true}});
    assert.equal((await request('/api/v1/auth/login','POST',{email:other.email,password})).status,403);
    for (let index=0; index<5; index++) assert.equal((await request('/api/v1/auth/login','POST',{email:user.email,password:'incorrect'})).status,401);
    assert.equal((await request('/api/v1/auth/login','POST',{email:user.email,password})).status,403);
  });
  await t.test('native auth rate limiter bounds public endpoints', async st => {
    const {request} = await setup(st);
    let response;
    for (let index=0; index<21; index++) response=await request('/api/v1/auth/login','POST',{});
    assert.equal(response.status,429); assert.equal(response.data.code,'RATE_LIMITED');
  });
});
