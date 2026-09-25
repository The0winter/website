import '../../test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createDesktop} from '../desktop/server.mjs';
import {focusExistingDesktop} from '../desktop/instance.mjs';

async function desktop(t, options={}) {
  const stateDir=fs.mkdtempSync(path.join(os.tmpdir(),'crawler-instance-'));
  const app=await createDesktop({stateDir,outputDir:path.join(stateDir,'downloads'),...options});
  t.after(async()=>{await app.close();assert.equal(path.dirname(stateDir),os.tmpdir());fs.rmSync(stateDir,{recursive:true,force:true});});
  return {app,record:{port:app.server.address().port,token:app.token}};
}

test('a reachable background service is not mistaken for a visible desktop',async t=>{
  const {app,record}=await desktop(t);
  const response=await fetch(app.baseUrl+'/api/focus',{method:'POST',headers:{'x-desktop-token':app.token,'content-type':'application/json'},body:'{}'});
  assert.deepEqual(await response.json(),{ok:true,focused:false});
  assert.equal(await focusExistingDesktop(record),false);
  assert.equal((await fetch(app.baseUrl)).status,200);
});

test('only an existing open window acknowledges focus; a closed window allows recovery',async t=>{
  let open=true,calls=0;
  const {record}=await desktop(t,{onFocus:()=>{calls++;return open;}});
  assert.equal(await focusExistingDesktop(record),true);assert.equal(calls,1);
  open=false;
  assert.equal(await focusExistingDesktop(record),false);assert.equal(calls,2);
});

test('legacy supervision records are recovered only after active work is saved',async()=>{
  const previous={port:12345,token:'test',backgroundSupervision:true};
  let busy=false,queue={paused:true,items:[{state:'queued'}]},requests=[];
  const fetcher=async url=>{requests.push(url);return new Response(JSON.stringify(url.endsWith('/focus')?{ok:true}:{task:{busy},queue}));};
  assert.equal(await focusExistingDesktop(previous,{fetcher}),false);assert.equal(requests.length,2);
  busy=true;await assert.rejects(focusExistingDesktop(previous,{fetcher}),/正在后台采集/);
  busy=false;queue.paused=false;await assert.rejects(focusExistingDesktop(previous,{fetcher}),/正在后台采集/);
  requests=[];
  assert.equal(await focusExistingDesktop({...previous,backgroundSupervision:false},{fetcher}),true);assert.equal(requests.length,1);
});

test('a stale endpoint or invalid saved port allows a fresh launch',async()=>{
  assert.equal(await focusExistingDesktop({port:12345,token:'test'},{fetcher:async()=>{throw Error('closed');}}),false);
  assert.equal(await focusExistingDesktop({port:'12345',token:'test'},{fetcher:async()=>{throw Error('must not fetch');}}),false);
});
