import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import mongoose from 'mongoose';
import {MongoMemoryReplSet} from 'mongodb-memory-server';
import {createApp} from '../app.js';
import {readConfig} from '../config.js';
const started=Date.now(),state=JSON.parse(fs.readFileSync('.runtime/staging.json'));
readConfig(state.env);
const directory=path.resolve('.runtime/backups');fs.mkdirSync(directory,{recursive:true});
const archive=path.join(directory,`synthetic-${started}.archive.gz`);
const tools=path.resolve('.runtime/mongodb-database-tools-windows-x86_64-100.17.0/bin');
async function run(name,args){return new Promise((resolve,reject)=>{const log=fs.openSync(`artifacts/${name}-${started}.log`,'w');const child=spawn(path.join(tools,name+'.exe'),args,{windowsHide:true,stdio:['ignore',log,log]});child.on('exit',code=>{fs.closeSync(log);code===0?resolve():reject(new Error(name+' failed'));});child.on('error',reject);});}
const source=await mongoose.createConnection(state.uri,{serverSelectionTimeoutMS:5000}).asPromise();
async function inventory(connection){const result={};for(const {name} of await connection.db.listCollections().toArray()){result[name]={count:await connection.collection(name).countDocuments(),indexes:(await connection.collection(name).indexes()).map(i=>({name:i.name,key:Object.entries(i.key),unique:i.unique,expireAfterSeconds:i.expireAfterSeconds,partialFilterExpression:i.partialFilterExpression})).sort((a,b)=>a.name.localeCompare(b.name))};}return result;}
const before=await inventory(source);
const samples=await source.collection('chapters').find({}).sort({_id:1}).limit(3).toArray();
// Baseline load is read-only. No jobs/importers/writers run on this staging database.
await run('mongodump',['--uri',state.uri,'--archive='+archive,'--gzip']);
const afterDump=await inventory(source);assert.deepEqual(afterDump,before);
const replica=await MongoMemoryReplSet.create({binary:{version:'7.0.40'},replSet:{count:1,storageEngine:'wiredTiger'}});
const targetUri=replica.getUri('test1_test');
await run('mongorestore',['--uri',targetUri,'--archive='+archive,'--gzip','--nsInclude=test1_test.*']);
await mongoose.connect(targetUri,{autoIndex:false,autoCreate:false,serverSelectionTimeoutMS:5000});
try {
  const restored=await inventory(mongoose.connection);assert.deepEqual(restored,before);
  const hashes=[];for(const sample of samples){const copy=await mongoose.connection.collection('chapters').findOne({_id:sample._id});assert.deepEqual(copy,sample);hashes.push({id:String(sample._id),sha256:crypto.createHash('sha256').update(sample.content).digest('hex')});}
  const server=createApp(readConfig({...state.env,MONGO_URI:targetUri})).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  try {const base=`http://127.0.0.1:${server.address().port}`;assert.equal((await fetch(base+'/health/ready')).status,200);const response=await fetch(base+'/api/chapters/'+state.chapterId);assert.equal(response.status,200);assert.equal((await response.json()).content.length,60000);}finally{await new Promise(r=>server.close(r));}
  const report={startedAt:new Date(started).toISOString(),finishedAt:new Date().toISOString(),elapsedMs:Date.now()-started,source:'isolated synthetic staging; no business writes or jobs during dump',mongodb:'7.0.40',tools:'100.17.0',archiveBytes:fs.statSync(archive).size,archiveSha256:crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex'),inventory:restored,samples:hashes,result:'passed',limits:'Same machine copy only; no independent offsite storage or real old data verification'};
  fs.writeFileSync('artifacts/restore-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({result:report.result,elapsedMs:report.elapsedMs,archiveBytes:report.archiveBytes}));
}finally{await source.close();await mongoose.disconnect();await replica.stop();}
