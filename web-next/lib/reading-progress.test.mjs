import test from 'node:test';
import assert from 'node:assert/strict';
import {ReadingProgress,accountBoundProgressRequest} from './reading-progress.ts';
const position=(offset=0,chapter='chapter')=>({chapterId:chapter,chapterNumber:1,contentVersion:'a'.repeat(64),paragraphKey:'0123456789abcdef-1',paragraphIndex:0,charOffset:offset});
const storage=()=>{const rows=new Map();return {getItem:key=>rows.get(key)??null,setItem:(key,value)=>rows.set(key,value)}};
const response=(body,status=200)=>new Response(JSON.stringify(body),{status});
function server(){let current={revision:0,position:null},offline=false,lose=false;const operations=new Map(),calls=[];return {
  get current(){return current;},set current(v){current=v;},set offline(v){offline=v;},set lose(v){lose=v;},calls,
  fetch:async(_url,options={})=>{calls.push(options.method||'GET');if(offline)throw Error('offline');if(!options.method)return response(current);
    const op=JSON.parse(options.body);if(operations.has(op.operationId))return response(operations.get(op.operationId));
    if(op.baseRevision!==current.revision)return response({code:'PROGRESS_CONFLICT',current},409);
    current={revision:current.revision+1,position:op.position};operations.set(op.operationId,current);if(lose){lose=false;throw Error('response lost');}return response(current);
  }};}
const engine=(disk,api,account='a')=>new ReadingProgress(account,'book',disk,api.fetch,()=>{});
test('GET and restored cloud anchor precede any write, and reflow does not advance revisions',async()=>{
 const api=server();api.current={revision:4,position:position(500)};const reader=engine(storage(),api);
 reader.record(position(0));await reader.flush();assert.deepEqual(api.calls,[]);
 await reader.open();assert.deepEqual(reader.state.local,position(500));reader.record(position(500));await reader.flush();assert.deepEqual(api.calls,['GET']);
 reader.record(position(700));await reader.flush();assert.equal(api.current.revision,5);assert.equal(api.current.position.charOffset,700);
});
test('offline queue survives process restart and lost acknowledgements reuse immutable operation IDs',async()=>{
 const api=server(),disk=storage();let reader=engine(disk,api);await reader.open();reader.record(position(300));const id=reader.state.pending.operationId;
 api.lose=true;await reader.flush();assert.equal(api.current.revision,1);assert.equal(reader.state.pending.operationId,id);reader.close();
 reader=engine(disk,api);await reader.open();assert.equal(api.current.revision,1);assert.equal(reader.state.pending,null);assert.equal(reader.state.local.charOffset,300);
 api.offline=true;reader.record(position(450));await reader.flush();reader.close();api.offline=false;reader=engine(disk,api);await reader.open();assert.equal(api.current.position.charOffset,450);
});
test('another device and a deletion tombstone require explicit conflict resolution; accounts never share queues',async()=>{
 const api=server(),disk=storage(),reader=engine(disk,api);await reader.open();reader.record(position(400));api.current={revision:2,position:null,deleted:true};await reader.flush();
 assert.equal(reader.state.conflict,'PROGRESS_CONFLICT');assert.equal(reader.state.local.charOffset,400);assert.equal(api.current.deleted,true);
 const other=engine(disk,api,'other');assert.equal(other.state.pending,null);assert.equal(other.state.local,null);
 await reader.chooseLocal();assert.equal(api.current.revision,3);assert.equal(api.current.position.charOffset,400);
 reader.record(position(600));api.current={revision:4,position:position(2,'earlier')};await reader.flush();reader.chooseCloud();assert.equal(reader.state.local.chapterId,'earlier');assert.equal(reader.state.pending,null);
});
test('movement during a pending network write becomes a distinct operation based on its receipt revision',async()=>{
 const api=server();let unblock;const real=api.fetch;api.fetch=async(url,options)=>{if(options?.method)await new Promise(resolve=>{unblock=resolve});return real(url,options)};
 const reader=engine(storage(),api);await reader.open();reader.record(position(10));const pending=reader.flush();await Promise.resolve();reader.record(position(90));unblock();
 await new Promise(resolve=>setTimeout(resolve,0));unblock();await pending;assert.equal(api.current.revision,2);assert.equal(api.current.position.charOffset,90);
});
test('content change retains local location and blocks silent retries',async()=>{
 const api=server(),reader=engine(storage(),api);await reader.open();reader.record(position(70));reader.contentChanged(position(60));await reader.flush();assert.equal(api.current.revision,0);assert.equal(reader.state.conflict,'CONTENT_CHANGED');
 await reader.chooseLocal({...position(60),contentVersion:'b'.repeat(64)});assert.equal(api.current.position.contentVersion,'b'.repeat(64));
});
test('accepting a cloud deletion never silently resurrects it on layout callbacks',async()=>{
 const api=server(),reader=engine(storage(),api);await reader.open();reader.record(position(33));api.current={revision:5,position:null,deleted:true};await reader.flush();reader.chooseCloud();
 reader.record(position(0));await reader.flush();assert.equal(api.current.revision,5);assert.equal(reader.state.pending,null);
 reader.record(position(40),true);await reader.flush();assert.equal(api.current.revision,6);assert.equal(api.current.position.charOffset,40);
});
test('an old idempotency receipt cannot hide a newer device revision fetched on reconnect',async()=>{
 const api=server(),disk=storage();let reader=engine(disk,api);await reader.open();reader.record(position(300));api.lose=true;await reader.flush();reader.close();
 api.current={revision:2,position:position(800)};reader=engine(disk,api);await reader.open();
 assert.equal(reader.state.remote.revision,2);assert.equal(reader.state.local.charOffset,300);assert.equal(reader.state.conflict,'PROGRESS_CONFLICT');
});
test('atomic account assertion closes cookie switch after session preflight without writing account B',async()=>{
 let cookie='a',switchAfterCheck=false,writesB=0;const api=server(),disk=storage();
 const transport=accountBoundProgressRequest('a',async(url,init)=>{
   if(url==='/api/auth/session'){const checked=cookie;if(switchAfterCheck)cookie='b';return response({user:{id:checked}});}
   assert.equal(new Headers(init.headers).get('X-Reading-Account'),'a');
   if(new Headers(init.headers).get('X-Reading-Account')!==cookie)return response({code:'ACCOUNT_CHANGED'},409);
   if(cookie==='b'&&init.method==='PUT')writesB++;
   return api.fetch(url,init);
 });
 const reader=new ReadingProgress('a','book',disk,transport,()=>{});await reader.open();reader.record(position(77));
 const operation=reader.state.pending.operationId;switchAfterCheck=true;await reader.flush();
 assert.equal(writesB,0);assert.equal(api.current.revision,0);assert.equal(reader.state.pending.operationId,operation);
 assert.equal(reader.state.local.charOffset,77);assert.equal(reader.state.conflict,null);assert.match(reader.state.error,/登录账户已变化/);
 await reader.flush();assert.equal(api.current.revision,0);assert.equal(JSON.parse(disk.getItem(reader.key)).pending.operationId,operation);
});
