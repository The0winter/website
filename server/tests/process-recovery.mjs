import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import mongoose from 'mongoose';
import assert from 'node:assert/strict';
import {MongoMemoryReplSet} from 'mongodb-memory-server';
import '../app.js';
import Book from '../models/Book.js';
import Job from '../models/Job.js';
const started=Date.now(),children=[];
const replica=await MongoMemoryReplSet.create({binary:{version:'7.0.40'},replSet:{count:1,storageEngine:'wiredTiger'}});
const env={...process.env,APP_ENV:'test',MONGO_URI:replica.getUri('test1_test'),JWT_SECRET:crypto.randomBytes(48).toString('hex'),EXTERNAL_SERVICES:'disabled',MAIL_MODE:'capture',RUN_JOBS:'enabled',PORT:'5006'};
function launch(file){const child=spawn(process.execPath,[file],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});child.output='';child.stdout.on('data',data=>child.output+=data);child.stderr.on('data',()=>{});children.push(child);return child;}
async function until(predicate,timeout){const end=Date.now()+timeout;while(Date.now()<end){if(await predicate())return;await delay(50);}throw new Error('Recovery deadline exceeded');}
async function kill(child){if(child.exitCode!==null||child.signalCode)return;await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGKILL');});}
await mongoose.connect(env.MONGO_URI,{autoIndex:false,autoCreate:false,serverSelectionTimeoutMS:5000});
try{
  for(const model of Object.values(mongoose.models))await model.createIndexes();
  const books=await Book.insertMany(Array.from({length:1000},(_,i)=>({title:`进程恢复合成作品 ${i}`,views:100+i})));
  let api=launch('server/index.js');await until(()=>api.output.includes('API ready'),15000);
  const endpoint=`http://127.0.0.1:5006/api/books/${books[0]._id}`;
  assert.equal((await (await fetch(endpoint)).json()).views,100);
  await kill(api);
  await assert.rejects(fetch(endpoint,{signal:AbortSignal.timeout(2000)}));
  const apiRestart=Date.now();api=launch('server/index.js');await until(()=>api.output.includes('API ready'),15000);
  assert.equal((await (await fetch(endpoint)).json()).views,100);
  const apiRecoveryMs=Date.now()-apiRestart;
  const worker=launch('server/jobs/index.js');
  let lease;await until(async()=>{lease=await Job.findById('statistics');return lease?.status==='running';},15000);
  await kill(worker);
  const killedAt=Date.now(),staleOwner=lease.owner;
  const blocked=launch('server/jobs/index.js');await until(()=>blocked.output.includes('"claimed":false'),15000);await kill(blocked);
  console.log('Killed worker lease prevents overlap; waiting for its real expiry without database edits');
  const afterKill=await Job.findById('statistics');
  const remaining=Math.max(0,+afterKill.leaseUntil-Date.now()+100);
  for(let waited=0;waited<remaining;waited+=1000)await delay(Math.min(1000,remaining-waited));
  const replacement=launch('server/jobs/index.js');
  await until(async()=>{const job=await Job.findById('statistics');return job?.status==='done'&&job.owner!==staleOwner;},30000);
  assert.equal(await Book.countDocuments(),1000);
  assert.equal((await Book.findById(books[0]._id)).views,100);
  assert.equal((await Book.findById(books[999]._id)).views,1099);
  const report={result:'passed',elapsedMs:Date.now()-started,apiRecoveryMs,workerRecoveryMs:Date.now()-killedAt,leaseWaitMs:remaining,booksRetained:1000,checks:['owned API hard kill and fresh process reconnect','unchanged book IDs and lifetime views','owned worker hard kill','live lease excludes replacement','real lease expiry permits replacement without manual DB edits'],limitations:'Scripted local Windows process restart; systemd automatic boot/restart and graceful Linux signals remain unverified'};
  await fs.writeFile('artifacts/process-recovery-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{for(const child of children)await kill(child);await mongoose.disconnect();await replica.stop();}
