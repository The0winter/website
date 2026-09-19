import '../../tools/test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {backupAtlas} from '../../infra/atlas-backup.mjs';
import {unpackSnapshot,snapshotSummary} from '../database/snapshot.js';

async function temporary(t) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'atlas-stream-test-'));
  t.after(async()=>{assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));await fs.rm(directory,{recursive:true,force:true});});
  return directory;
}
function mongoFactory({retry=false}={}) {
  return () => ({
    async connect(){}, async close(){},
    db(){return {databaseName:'synthetic',listCollections:()=>({toArray:async()=>[{name:'chapters'}]}),collection:()=>({
      indexes:async()=>[{name:'_id_',key:{_id:1}}],
      find:()=>({async *[Symbol.asyncIterator](){yield {_id:'a',title:'完整章节',createdAt:new Date(0)};yield {_id:'b',value:42};},async close(){}})
    })};},
    startSession(){return {async withTransaction(callback){if(retry)await callback();await callback();},async endSession(){}};}
  });
}

test('streamed backup preserves restore format and retries, and publishes only verified snapshots',async t=>{
  const directory=await temporary(t);let uploaded,corrupt=false;
  const storageFactory=()=>({async send(command){
    if(command.constructor.name==='PutObjectCommand'){
      const chunks=[];for await(const chunk of command.input.Body)chunks.push(chunk);
      uploaded=Buffer.concat(chunks);assert.equal(uploaded.length,command.input.ContentLength);return {};
    }
    return {Body:Readable.from([corrupt?Buffer.from('corrupt'):uploaded])};
  },destroy(){}});
  const options={directory,keepLocal:true,env:{R2_BUCKET:'private',COVER_R2_BUCKET:'public'},mongoFactory:mongoFactory({retry:true}),storageFactory};
  const manifest=await backupAtlas('synthetic',options);
  const snapshot=unpackSnapshot(await fs.readFile(path.join(directory,manifest.archive)));
  assert.equal(snapshot.collections[0].documents.length,2,'transaction retries cannot append duplicate data');
  assert.match(snapshot.collections[0].documents[0].bson,/\$date/);
  assert.deepEqual(manifest.collections,snapshotSummary(snapshot).collections);
  const before=await fs.readFile(path.join(directory,'latest.json'),'utf8');
  corrupt=true;
  await assert.rejects(backupAtlas('synthetic',options),/readback mismatch/);
  assert.equal(await fs.readFile(path.join(directory,'latest.json'),'utf8'),before);
  assert.equal((await fs.readdir(directory)).some(name=>name.startsWith('.atlas-backup-')),false);
  await assert.rejects(backupAtlas('synthetic',{...options,env:{R2_BUCKET:'public',COVER_R2_BUCKET:'public'}}),/private chapter bucket/);
});

test('100,000 metadata records stream successfully with a 96 MiB JavaScript heap',async t=>{
  const directory=await temporary(t),file=path.join(directory,'stress.json.gz');
  const moduleUrl=new URL('../../infra/atlas-backup.mjs',import.meta.url).href;
  const script=`
    import {writeMongoArchive} from ${JSON.stringify(moduleUrl)};
    const client={db(){return {databaseName:'synthetic',listCollections:()=>({toArray:async()=>[{name:'chapters'}]}),collection:()=>({indexes:async()=>[],find:()=>({async *[Symbol.asyncIterator](){for(let i=0;i<100000;i++)yield {_id:String(i).padStart(8,'0'),title:'章节'+i,sourceUrl:'x'.repeat(1000)};},async close(){}})})};},startSession(){return {async withTransaction(cb){await cb();},async endSession(){}};}};
    const result=await writeMongoArchive(client,${JSON.stringify(file)});
    console.log(JSON.stringify({count:result.collections[0].count,bytes:result.bytes,heap:process.memoryUsage().heapUsed}));
  `;
  const result=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--require',fileURLToPath(new URL('../../tools/test-env.cjs',import.meta.url)),'--max-old-space-size=96','--input-type=module'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
    child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));child.stdin.end(script);
  });
  assert.equal(result.code,0,result.stderr);
  assert.equal(JSON.parse(result.stdout).count,100000);
  assert.ok(JSON.parse(result.stdout).heap<96*1024*1024);
});
