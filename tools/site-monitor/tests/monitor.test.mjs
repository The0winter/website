import '../../test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {MonitorSession} from '../session.mjs';
import {validateConfig,defaults} from '../collectors.mjs';
import {createMonitor} from '../server.mjs';
import retention from '../../storage-maintenance.cjs';
import storage from '../storage-policy.cjs';
import {workspace,removeWorkspace,fixtureCollectors} from './fixture.mjs';

test('同模块刷新合并；关闭中止采集并不记录迟到结果',async()=>{
  let resolve,calls=0,signal;const session=new MonitorSession({site:s=>{calls++;signal=s;return new Promise(r=>resolve=r);}});
  const a=session.refresh('site'),b=session.refresh('site');assert.equal(a,b);await Promise.resolve();assert.equal(calls,1);
  const closing=session.close();assert.equal(signal.aborted,true);resolve({latencyMs:1});await closing;assert.equal(session.modules.site.data,null);await session.refresh();assert.equal(calls,1);
});
test('失败保留旧值并标记断点；历史内存有上限',async()=>{
  let now=100000,fail=false;const s=new MonitorSession({site:async()=>{if(fail)throw Error('offline');return {latencyMs:12};}},{clock:()=>now,maxPoints:3});
  for(let i=0;i<7;i++){now+=60000;await s.refresh('site');}assert.equal(s.modules.site.history.length,3);
  fail=true;await s.refresh('site');assert.equal(s.modules.site.data.latencyMs,12);assert.equal(s.modules.site.status,'error');assert.equal(s.modules.site.history.at(-1).gap,true);
  now+=120001;assert.equal(s.snapshot().modules.site.stale,true);await s.close();
});
test('暂停仅停止定时刷新，手动刷新仍可执行',async()=>{let count=0;const s=new MonitorSession({site:async()=>{count++;return {latencyMs:1};}});s.paused=true;s.tick();assert.equal(count,0);await s.refresh('site');assert.equal(count,1);await s.close();});
test('CPU 与网络使用差值；计数重置不显示负流量',async()=>{
  const collect=fixtureCollectors(),s=new MonitorSession(collect);await s.refresh('server');assert.equal(s.modules.server.data.cpuPercent,null);await s.refresh('server');assert.equal(Math.round(s.modules.server.data.cpuPercent),70);assert.ok(s.modules.server.data.rxPerSecond>0);
  const previous=structuredClone(s.modules.server.data);s.collect.server=async()=>({...previous,sampledAt:new Date(Date.parse(previous.sampledAt)+15000).toISOString(),cpu:{idle:0,total:0},network:{rx:0,tx:0}});await s.refresh('server');assert.equal(s.modules.server.data.cpuPercent,null);assert.equal(s.modules.server.data.rxPerSecond,null);await s.close();
});
test('连接配置拒绝命令参数注入和无效网址',()=>{for(const value of [{host:'-oProxyCommand=evil'},{host:'x@host\nwhoami'},{identity:'relative.key'},{site:'http://example.test'},{site:'https://user:pass@example.test'},{atlasLimitMiB:-1}])assert.throws(()=>validateConfig(value));assert.equal(validateConfig({...defaults,untrusted:'value'}).untrusted,undefined);});

function setup(t){const root=workspace();t.after(()=>removeWorkspace(root));return root;}
function file(root,relative,data='report'){const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,data);return target;}
function report(root,suffix,days){const relative=storage.BASE+`/reports/monitor-20260901T000000-${suffix}.json`;const p=file(root,relative);const at=new Date(Date.now()-days*86400000);fs.utimesSync(p,at,at);return relative;}
test('清理仅处理过期托管报告，未知文件、配置和外部文件保留',t=>{
  const root=setup(t),old=report(root,'aaaaaaaa',31),fresh=report(root,'bbbbbbbb',1);file(root,storage.BASE+'/reports/important.json');file(root,storage.BASE+'/config.json');file(root,'downloads/book.txt');
  const plan=retention.maintain({root,scope:'site-monitor',processes:[],tracked:[]});assert.deepEqual(plan.candidates.map(x=>x.path),[old]);
  const result=retention.maintain({root,scope:'site-monitor',apply:true,processes:[],tracked:[]});assert.equal(result.deleted.length,1);for(const relative of [fresh,storage.BASE+'/reports/important.json',storage.BASE+'/config.json','downloads/book.txt'])assert.ok(fs.existsSync(path.join(root,relative)));
});
test('保留标记和执行前变化阻止删除',t=>{
  const root=setup(t),old=report(root,'aaaaaaaa',31);const plan=retention.plan(root,{scope:'site-monitor',processes:[],tracked:[]});fs.appendFileSync(path.join(root,old),'new');const result=retention.execute(root,plan,{processes:[],tracked:[]});assert.equal(result.deleted.length,0);assert.equal(result.skipped.length,1);
  const age=new Date(Date.now()-31*86400000);fs.utimesSync(path.join(root,old),age,age);file(root,storage.BASE+'/reports/.storage-keep');const pinned=retention.plan(root,{scope:'site-monitor',processes:[],tracked:[]});assert.equal(pinned.candidates.length,0);assert.equal(pinned.protectedPaths.length,1);
});
test('浏览器活动租约受到保护，已关闭的专用目录可回收',t=>{
  const root=setup(t),base=storage.BASE+'/browser/session-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';file(root,base+'/owner.json',JSON.stringify({app:'site-monitor',pid:process.pid,closed:false}));file(root,base+'/profile/Cache/data');assert.deepEqual(storage.candidates(root),[]);fs.writeFileSync(path.join(root,base,'owner.json'),JSON.stringify({app:'site-monitor',pid:process.pid,closed:true}));assert.deepEqual(storage.candidates(root),[base]);
});
test('链接目录不能进入报告扫描或清理',t=>{
  const root=setup(t),outside=path.join(root,'keep');fs.mkdirSync(outside);fs.mkdirSync(path.join(root,storage.BASE),{recursive:true});fs.symlinkSync(outside,path.join(root,storage.BASE,'reports'),process.platform==='win32'?'junction':'dir');assert.deepEqual(storage.candidates(root),[]);assert.throws(()=>retention.inside(root,storage.BASE+'/reports/x.json'));
});
test('报告超预算时按最旧顺序选择，不依赖未知文件',t=>{
  const root=setup(t),old=report(root,'aaaaaaaa',2),fresh=report(root,'bbbbbbbb',1);const fd=fs.openSync(path.join(root,old),'r+');fs.ftruncateSync(fd,storage.POLICY.reportBytes);fs.closeSync(fd);const at=new Date(Date.now()-2*86400000);fs.utimesSync(path.join(root,old),at,at);assert.deepEqual(storage.candidates(root),[old]);assert.ok(fs.existsSync(path.join(root,fresh)));
});
test('保存前为新报告预留容量，避免目录接近上限后无法继续保存',t=>{
  const root=setup(t),old=report(root,'aaaaaaaa',2);const fd=fs.openSync(path.join(root,old),'r+');fs.ftruncateSync(fd,storage.POLICY.reportBytes-100);fs.closeSync(fd);
  assert.equal(storage.candidates(root).length,0);
  const result=retention.maintain({root,scope:'site-monitor',reserveBytes:200,apply:true,processes:[],tracked:[]});assert.equal(result.deleted.length,1);assert.equal(fs.existsSync(path.join(root,old)),false);
});

test('本地 API 校验令牌和来源；导出不改变连接；过期清理可预览',async t=>{
  const root=setup(t),app=await createMonitor({root,collect:fixtureCollectors(),start:false});t.after(()=>app.close());
  const call=(route,data,headers={})=>fetch(app.baseUrl+'/api/'+route,{method:data===undefined?'GET':'POST',headers:{'x-monitor-token':app.token,'Content-Type':'application/json',...headers},body:data===undefined?undefined:JSON.stringify(data)});
  assert.equal((await fetch(app.baseUrl+'/api/state')).status,403);assert.equal((await call('state',undefined,{Origin:'https://evil.test'})).status,403);
  const badHost=await new Promise((resolve,reject)=>{const req=http.get(app.baseUrl+'/api/state',{headers:{Host:'evil.test','x-monitor-token':app.token}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);});assert.equal(badHost,403);
  await app.session.refresh();const response=await call('export',{format:'json'});assert.equal(response.status,200);const saved=await response.json();const originalIdentity=app.config.identity;assert.ok(originalIdentity);
  const download=await call('report?name='+saved.name);const parsed=await download.json();assert.equal(parsed.config.identity,undefined);assert.equal(parsed.modules.atlas.data.database,'synthetic_test');assert.equal(parsed.inventory.cursor,undefined);assert.equal(app.config.identity,originalIdentity);
  assert.equal((await call('report?name=../../config.json')).status,400);assert.equal((await call('export',{format:'exe'})).status,400);assert.equal((await call('refresh',{module:'shell'})).status,400);
  const clean=await (await call('cleanup',{})).json();assert.equal(clean.candidates.length,0);assert.ok(fs.existsSync(path.join(root,storage.BASE,'reports',saved.name)));
});
test('R2 盘点受请求预算约束，部分数据绝不标记为完成',async t=>{
  const root=setup(t);let calls=0;const app=await createMonitor({root,collect:fixtureCollectors(),start:false,remote:async()=>{calls++;return {bytes:100,objects:2,pages:10,cursor:'next',complete:false,groups:{chapters:{bytes:100,objects:2}}};}});t.after(()=>app.close());
  await fetch(app.baseUrl+'/api/inventory',{method:'POST',headers:{'x-monitor-token':app.token},body:'{}'});
  for(let i=0;i<50&&app.snapshot().inventory.running;i++)await new Promise(r=>setTimeout(r,5));
  const state=app.snapshot();assert.equal(calls,40);assert.equal(state.inventory.buckets.length,2);assert.ok(state.inventory.buckets.every(b=>b.pages===200&&!b.complete&&!('cursor'in b)));assert.match(state.inventory.error,/上限/);
});
