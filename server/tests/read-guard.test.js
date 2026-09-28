import '../../tools/test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import express from 'express';
import {createReadGuard, installReadGuard, readTarget} from '../services/read-guard.js';

const config = {mode:'test', readGuardMode:'enforce', jwtSecret:crypto.randomBytes(40).toString('hex')};
const id = n => n.toString(16).padStart(24,'0');
const chapter = n => '/api/chapters/' + id(n);
const input = (n, cookie='', extra={}) => ({path:chapter(n), method:'GET', cookie, ip:'203.0.113.10', userAgent:'Mozilla/5.0', ...extra});
const cookieOf = r => r.setCookie.split(';')[0];
const start = Date.UTC(2026,8,28);

test('normal fast navigation, prefetch duplicates and readers sharing one IP keep independent budgets', () => {
  let now=start;const guard=createReadGuard(config,{clock:()=>now});
  const cookies=Array.from({length:30},(_,i)=>cookieOf(guard.check(input(1000+i))));
  for(let turn=0;turn<180;turn++) {
    now=start+turn*20000;
    for(let visitor=0;visitor<cookies.length;visitor++) {
      const data=input(turn+1,cookies[visitor]);
      assert.equal(guard.check(data).status,200);
      assert.equal(guard.check({...data,path:`/book/${id(999)}/${id(turn+1)}`}).status,200);
    }
  }
  const cookie=cookies[0];
  for(let i=500;i<520;i++)assert.equal(guard.check(input(i,cookie)).status,200,'short preview burst');
  assert.equal(guard.snapshot().blocked,0);
  assert.doesNotMatch(JSON.stringify(guard.snapshot()),/203\.0|Mozilla|reader-access/);
});

test('sustained and hourly chapter scans cool down, including RSC/HEAD and signed-in accounts', () => {
  let now=start;const guard=createReadGuard(config,{clock:()=>now});
  const cookie=cookieOf(guard.check(input(1)));
  for(let n=1;n<=120;n++){now=start+n*500;assert.equal(guard.check(input(n,cookie)).status,200);}
  const denied=guard.check(input(121,cookie,{method:'HEAD'}));assert.equal(denied.status,429);assert.ok(denied.retryAfter>0);assert.equal(denied.setCookie,undefined);
  now+=121000;assert.equal(guard.check(input(121,cookie)).status,200);
  let later=start;const hourly=createReadGuard(config,{clock:()=>later});
  const token=jwt.sign({id:id(444),sid:'f'.repeat(64),exp:start/1000+7200},config.jwtSecret,{algorithm:'HS256'});
  for(let n=1;n<=600;n++){later=start+n*5000;assert.equal(hourly.check(input(n,'session='+token)).status,200);}
  assert.equal(hourly.check(input(601,'session='+token)).status,429);
  later=start+3606000;assert.equal(hourly.check(input(601,'session='+token)).status,200);
});

test('declared training crawlers are stopped, search crawlers paced and missing/forged cookies do not create fresh identities', () => {
  let now=start;const guard=createReadGuard(config,{clock:()=>now});
  for(const userAgent of ['ClaudeBot/1.0','GPTBot/1.0','CCBot/2.0','Bytespider'])assert.equal(guard.check(input(1,'',{userAgent})).status,403);
  assert.equal(guard.check(input(1,'',{userAgent:'Claude-User'})).status,200);
  assert.equal(guard.check(input(1,'',{path:`/book/${id(3)}/${id(1)}`,method:'POST',userAgent:'ClaudeBot'})).status,403);
  for(let n=1;n<=30;n++){now=start+n*1200;assert.equal(guard.check(input(n,'',{userAgent:'Googlebot/2.1'})).status,200);}
  assert.equal(guard.check(input(31,'',{userAgent:'Googlebot/2.1'})).status,429);
  const raw=createReadGuard(config,{clock:()=>now});let denied=0;
  for(let n=1;n<=200;n++)if(raw.check(input(n,`reader-access=forged-${n}`)).status===429)denied++;
  assert.ok(denied>100);assert.equal(raw.snapshot().actors,1);
  assert.equal(readTarget('/_next/static/app.js'),null);
  assert.equal(guard.check(input(1,'',{path:'/API/chapters/%30'.repeat(1)+'0'.repeat(23),userAgent:'ClaudeBot'})).status,403,'encoded IDs and case variants cannot bypass the guard');
  assert.equal(readTarget('/api/chapters/'+id(1)+'/paragraph-comments'),null);
});

test('observation is reversible, memory stays bounded, local development stays unrestricted', () => {
  let now=start;
  const guard=createReadGuard({...config,readGuardMode:'observe'},{clock:()=>now,maxActors:3,maxChapters:5});
  assert.equal(guard.check(input(1,'',{userAgent:'ClaudeBot'})).status,200);assert.equal(guard.snapshot().observed,1);
  for(let n=1;n<30;n++) {now+=500;guard.check(input(n,'',{ip:`203.0.113.${n}`}));}
  assert.ok(guard.snapshot().actors<=3);assert.ok(guard.snapshot().rememberedChapters<=5);assert.ok(guard.snapshot().evictions>0);
  const off=createReadGuard({...config,readGuardMode:'off'});assert.equal(off.check(input(1,'',{userAgent:'ClaudeBot'})).status,200);
});

test('HTML delegation and direct API share counters; forged bypass headers cannot reach downstream work', async () => {
  const saved=process.env.INTERNAL_API_SECRET;process.env.INTERNAL_API_SECRET='s'.repeat(48);
  const app=express();app.set('trust proxy','loopback');const {delegated}=installReadGuard(app,config);
  app.post('/internal/reader-guard',express.json(),delegated);
  let downstream=0;app.get('/api/chapters/:id',(_req,res)=>{downstream++;res.json({ok:true});});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  try {
    const denied=await fetch(base+chapter(1),{headers:{'user-agent':'ClaudeBot','x-internal-api-secret':'wrong','x-forwarded-for':'127.0.0.1'}});
    assert.equal(denied.status,403);assert.equal(downstream,0);
    assert.equal((await fetch(base+'/internal/reader-guard',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,404);
    const delegatedCheck=async(cookie,path=chapter(2))=>fetch(base+'/internal/reader-guard',{method:'POST',headers:{'Content-Type':'application/json','x-internal-api-secret':process.env.INTERNAL_API_SECRET},body:JSON.stringify(input(2,cookie,{path}))});
    const initial=await delegatedCheck('');const cookie=initial.headers.get('set-cookie').split(';')[0];
    let limited=false;
    for(let n=0;n<95;n++) {
      const r=n%2 ? await delegatedCheck(cookie) : await fetch(base+chapter(2),{headers:{cookie}});
      const status=n%2 ? (await r.json()).status : r.status;if(status===429)limited=true;
    }
    assert.equal(limited,true,'a caller cannot double the budget by switching HTML and API');
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));if(saved===undefined)delete process.env.INTERNAL_API_SECRET;else process.env.INTERNAL_API_SECRET=saved;}
});
