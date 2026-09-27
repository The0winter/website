import '../../test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {cloudCollectors,summarizeR2,integrateNetwork} from '../cloud-usage.mjs';
import {assessUsage,cloudStorage} from '../usage.mjs';
import {createMonitor} from '../server.mjs';
import {workspace,removeWorkspace,fixtureCollectors} from './fixture.mjs';

const start='2026-09-20T00:00:00Z',end='2026-09-27T00:00:00Z';
const row=(actionType,requests,extra={})=>({dimensions:{actionType,actionStatus:'success',responseStatusCode:200,...extra},sum:{requests}});
const bucket=(name,at,bytes)=>({dimensions:{bucketName:name,datetime:at},max:{payloadSize:bytes,metadataSize:2,objectCount:4}});
const account={r2OperationsAdaptiveGroups:[row('PutObject',900000),row('GetObject',8000000),row('ListObjects',1),row('DeleteObjects',5),row('NewAction',3),row('GetObject',100,{responseStatusCode:401,actionStatus:'userError'})],r2StorageAdaptiveGroups:[bucket('chapters',end,100),bucket('covers',end,20),bucket('chapters',start,90)]};
const metrics=values=>['NETWORK_BYTES_IN','NETWORK_BYTES_OUT'].map(name=>({name,units:'BYTES_PER_SECOND',dataPoints:values.map((value,i)=>({timestamp:new Date(Date.parse(start)+(i+1)*3600000).toISOString(),value}))}));
const credentials={cloudflare:{accountId:'a'.repeat(32),token:'secret-cf'},atlas:{projectId:'b'.repeat(24),clusterName:'Target',clientId:'secret-id',clientSecret:'secret-key'}};
const response=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});

test('R2 separates free, unauthorized and unknown operations and keeps latest bucket samples',()=>{
  const d=summarizeR2(account,{start,end});
  assert.equal(d.operations.classA,900001);assert.equal(d.operations.classB,8000000);assert.equal(d.operations.free,5);assert.equal(d.operations.unknown,3);assert.equal(d.operations.unauthorized,100);
  assert.equal(d.storage.buckets.length,2);assert.equal(d.storage.buckets[0].bytes,100);
  assert.equal(summarizeR2({...account,r2OperationsAdaptiveGroups:Array(1000).fill(row('GetObject',1))}).operations.complete,false);
  assert.throws(()=>summarizeR2({...account,r2OperationsAdaptiveGroups:[row('GetObject',null)]}),/格式/);
});

test('Atlas rate integration clips boundaries, deduplicates timestamps and preserves gaps',()=>{
  const d=integrateNetwork(metrics([2,null,3]),start,new Date(Date.parse(start)+3*3600000).toISOString());
  assert.equal(d.inbound.bytes,5*3600);assert.equal(d.outbound.coverage,2/3);
  const m=metrics([2,4]);m[0].dataPoints.push({...m[0].dataPoints[0]});
  assert.equal(integrateNetwork(m,new Date(Date.parse(start)+1800000).toISOString(),new Date(Date.parse(start)+5400000).toISOString()).inbound.bytes,10800);
  assert.equal(integrateNetwork(metrics([null]),start,end).inbound.bytes,null);
  assert.throws(()=>integrateNetwork([{name:'NETWORK_BYTES_IN',units:'BYTES',dataPoints:[]}],start,end),/网络速率/);
});

test('Cloud APIs use scoped credentials, correct month range and cached OAuth; outputs omit secrets',async()=>{
  const requests=[];
  const fetchImpl=async(url,options)=>{requests.push({url,options});
    if(url.endsWith('/graphql'))return response({data:{viewer:{accounts:[account]}}});
    if(url.endsWith('/oauth/token'))return response({access_token:'secret-access',expires_in:3600});
    if(url.includes('/clusters/'))return response({providerSettings:{instanceSizeName:'M0'},connectionStrings:{standard:'mongodb://alias:27017/?ssl=true'}});
    if(url.includes('/processes?'))return response({totalCount:2,results:[{id:'node:27017',userAlias:'alias',port:27017},{id:'other:27017',userAlias:'unrelated',port:27017}]});
    assert.ok(url.includes('/processes/node%3A27017/measurements?'));return response({granularity:'PT1H',measurements:metrics(Array(168).fill(1))});
  };
  const collectors=cloudCollectors(null,{fetchImpl,readCredentials:()=>credentials,clock:()=>Date.parse(end)});
  const cf=await collectors.cloudflare(),atlas=await collectors.atlasCloud();await collectors.atlasCloud();
  assert.equal(requests.filter(r=>r.url.endsWith('/oauth/token')).length,1);
  assert.equal(JSON.parse(requests[0].options.body).variables.start,'2026-09-01T00:00:00.000Z');
  assert.equal(atlas.nodes,1);assert.equal(atlas.inbound.bytes,604800);assert.equal(atlas.inbound.coverage,1);
  assert.ok(requests.every(r=>r.options.redirect==='error'));
  assert.doesNotMatch(JSON.stringify({cf,atlas}),/secret-|Authorization|clientSecret/);
});

test('Permission and provider failures never expose credential or response contents',async()=>{
  for(const status of [401,403,429,500]){
    const c=cloudCollectors(null,{readCredentials:()=>credentials,fetchImpl:async()=>new Response('secret-token echo',{status})});
    await assert.rejects(c.cloudflare(),e=>e.message.includes(String(status))&&!e.message.includes('secret'));
  }
  const c=cloudCollectors(null,{readCredentials:()=>credentials,fetchImpl:async()=>response({errors:[{message:'secret-cf'}]})});
  await assert.rejects(c.cloudflare(),e=>!e.message.includes('secret'));
  const empty=cloudCollectors(null,{readCredentials:()=>({}),fetchImpl:()=>{throw Error('must not request');}});
  assert.equal((await empty.cloudflare()).status,'unconfigured');
});

test('Cloud warnings reject stale or previous-month totals and retain partial high-risk estimates',()=>{
  const cloud=summarizeR2(account,{start:'2026-09-01T00:00:00Z',end}),snapshot={now:Date.parse(end),modules:{cloudflare:{status:'ok',data:cloud},atlasCloud:{status:'ok',data:{status:'connected',referenceLimitBytes:10e9,inbound:{bytes:1e9,coverage:1},outbound:{bytes:9e9,coverage:.5}}},r2:{data:{buckets:[{id:'chapters',bucket:'chapters'},{id:'covers',bucket:'covers'}]}}}};
  const u=assessUsage(snapshot);assert.equal(u.r2ATone,'danger');assert.equal(u.r2BTone,'warning');assert.equal(u.transferTone,'danger');assert.equal(cloudStorage(snapshot).bytes,120);
  snapshot.modules.atlasCloud.data.outbound.bytes=1e9;assert.equal(assessUsage(snapshot).transferTone,'unknown');
  snapshot.modules.cloudflare.stale=true;assert.equal(assessUsage(snapshot).r2A,null);assert.equal(cloudStorage(snapshot),null);
  snapshot.modules.cloudflare.stale=false;snapshot.now=Date.parse('2026-10-01T00:00:00Z');assert.equal(assessUsage(snapshot).r2,null);
  snapshot.now=Date.parse(end);snapshot.modules.r2.data.buckets[0].bucket='missing';assert.equal(cloudStorage(snapshot),null);
});

test('Monitor reads credentials outside public config and disables automatic object listing when authorized',async t=>{
  const root=workspace();t.after(()=>removeWorkspace(root));const directory=path.join(root,'.runtime/site-monitor');fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'cloud-credentials.json'),JSON.stringify(credentials));
  let calls=0;const app=await createMonitor({root,collect:fixtureCollectors(),start:false,autoInventory:true,remote:async()=>{calls++;throw Error('unexpected listing');}});t.after(()=>app.close());
  assert.equal(calls,0);assert.equal(app.snapshot().inventory.running,false);assert.doesNotMatch(JSON.stringify(app.snapshot()),/secret-|clientSecret|cloud-credentials/);
  const r=await fetch(app.baseUrl+'/cloud-credentials.json');assert.equal(r.status,404);
});
