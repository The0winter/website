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

test('explicit administrator catalog scope protects private works and stays uncached',async t=>{
  const db=await TestDatabase.create();
  const config=readConfig({APP_ENV:'test',DATABASE_URL:db.getUri(),JWT_SECRET:crypto.randomBytes(48).toString('hex')});
  await mongoose.connect(config.uri,{autoIndex:false});
  for(const model of Object.values(mongoose.models))await model.createIndexes();
  const password='Native-admin-books-123',hash=await bcrypt.hash(password,4);
  const [admin,author]=await User.create([{username:'catalog-admin',email:'catalog-admin@example.test',password:hash,role:'admin'},{username:'catalog-author',email:'catalog-author@example.test',password:hash}]);
  const [published,privateBook]=await Book.create([{title:'原生公开书',author:'同一作者',author_id:author._id,views:5},{title:'原生私密书',author:'同一作者',author_id:author._id,visibility:'private',views:10},{title:'原生已删书',author:'同一作者',author_id:author._id,deletedAt:new Date(),views:20}]);
  const app=createApp(config),server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{app.locals.stopWritingCleanup?.();await new Promise(resolve=>server.close(resolve));await mongoose.disconnect();await db.stop()});
  const base=`http://127.0.0.1:${server.address().port}`;
  async function get(path,token){const response=await fetch(base+path,{headers:token?{Authorization:`Bearer ${token}`}:{}});return {status:response.status,body:await response.json(),headers:response.headers}}
  async function login(user){const response=await fetch(base+'/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:user.email,password,deviceName:'Admin catalog contract'})});assert.equal(response.status,200);return (await response.json()).accessToken}
  const adminToken=await login(admin),authorToken=await login(author);
  await t.test('anonymous, invalid credentials and nonadmin author cannot request private scope',async()=>{
    for(const [token,status] of [[undefined,401],['invalid',401],[authorToken,403]]){const r=await get('/api/books?scope=admin',token);assert.equal(r.status,status);assert.match(r.headers.get('cache-control'),/private.*no-store/)}
    assert.equal((await get('/api/books?scope=other',adminToken)).status,400);
    assert.equal((await get('/api/books?scope=admin&scope=admin',adminToken)).status,400);
  });
  await t.test('ordinary GET remains public for guests and administrators',async()=>{
    for(const token of [undefined,adminToken,authorToken]){const r=await get('/api/books',token);assert.equal(r.status,200);assert.deepEqual(r.body.map(b=>b.id),[String(published._id)]);assert.equal(r.headers.get('x-total-count'),'1')}
  });
  await t.test('admin scope returns private/public only, total and stable paginated search',async()=>{
    const r=await get('/api/books?scope=admin&orderBy=views&limit=1&page=1',adminToken);assert.equal(r.status,200);assert.equal(r.headers.get('x-total-count'),'2');assert.equal(r.body[0].id,String(privateBook._id));assert.equal(r.body[0].visibility,'private');
    assert.match(r.headers.get('cache-control'),/private.*no-store/);assert.match(r.headers.get('vary'),/Authorization/);assert.match(r.headers.get('vary'),/Cookie/);
    const searched=await get('/api/books?scope=admin&q='+encodeURIComponent('私密'),adminToken);assert.equal(searched.body.length,1);assert.equal(searched.headers.get('x-total-count'),'1');
    const page=await get('/api/books?scope=admin&orderBy=views&limit=1&page=2',adminToken);assert.equal(page.body[0].id,String(published._id));
  });
  await t.test('changing public book to private keeps admin discovery and hides public lists',async()=>{
    const response=await fetch(base+`/api/books/${published._id}`,{method:'PATCH',headers:{Authorization:`Bearer ${adminToken}`,'Content-Type':'application/json'},body:JSON.stringify({visibility:'private'})});assert.equal(response.status,200);
    assert.equal((await get('/api/books')).body.length,0);assert.equal((await get('/api/books?scope=admin',adminToken)).body.length,2);
    assert.equal(String((await Book.findById(published._id)).author_id),String(author._id));
    assert.equal((await get(`/api/books/${published._id}`,authorToken)).status,200);assert.equal((await get(`/api/books/${published._id}`)).status,404);
  });
  await t.test('role demotion immediately denies existing native token',async()=>{
    await User.updateOne({_id:admin._id},{$set:{role:'reader'}});assert.equal((await get('/api/books?scope=admin',adminToken)).status,403);
  });
});
