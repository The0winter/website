// Equivalent local staging: real replica set + production Next build + nginx.
import {MongoMemoryReplSet} from 'mongodb-memory-server';
import mongoose from 'mongoose';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import os from 'node:os';
import {createApp} from './app.js';
import {readConfig} from './config.js';
import Book from './models/Book.js';
import Chapter from './models/Chapter.js';
import Job from './models/Job.js';

const root=path.resolve('.');
const sourceFiles=[];
function sourceManifest(directory){for(const name of fs.readdirSync(directory)){if(name==='node_modules'||name.startsWith('.next')||name.startsWith('.env')||['artifacts','test-results'].includes(name)||name.endsWith('.tsbuildinfo'))continue;const file=path.join(directory,name);if(fs.statSync(file).isDirectory())sourceManifest(file);else sourceFiles.push({path:path.relative(root,file),sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')});}}
sourceManifest(path.join(root,'server'));sourceManifest(path.join(root,'web-next'));
fs.mkdirSync('artifacts',{recursive:true});
fs.writeFileSync('artifacts/staging-source.json',JSON.stringify({startedAt:new Date().toISOString(),files:sourceFiles},null,2));
const repl=await MongoMemoryReplSet.create({binary:{version:'7.0.40'},replSet:{count:1,storageEngine:'wiredTiger'},instanceOpts:[{args:['--wiredTigerCacheSizeGB','0.5']}]});
const env={...process.env,APP_ENV:'test',MONGO_URI:repl.getUri('test1_test'),JWT_SECRET:crypto.randomBytes(48).toString('hex'),INTERNAL_API_SECRET:crypto.randomBytes(32).toString('hex'),EXTERNAL_SERVICES:'disabled',MAIL_MODE:'capture',PORT:'5001',INTERNAL_API_URL:'http://127.0.0.1:5001/api',NEXT_PUBLIC_API_URL:'',NEXT_PUBLIC_SITE_URL:'http://127.0.0.1:8088',NEXT_PUBLIC_EXTERNAL_SERVICES:'disabled',NEXT_DIST_DIR:'.next-stage',ALLOWED_ORIGINS:'http://127.0.0.1:8088',LOG_REQUESTS:'enabled'};
env.IMPORT_SECRET=crypto.randomBytes(32).toString('hex');env.TRUST_PROXY='loopback';
Object.assign(process.env,env);
mongoose.set('bufferCommands',false);
await mongoose.connect(env.MONGO_URI,{autoIndex:false,autoCreate:false,serverSelectionTimeoutMS:5000,socketTimeoutMS:10000,maxPoolSize:20});
for(const model of Object.values(mongoose.models))await model.createIndexes();
const books=Array.from({length:1000},(_,i)=>({_id:new mongoose.Types.ObjectId((100000+i).toString(16).padStart(24,'0')),title:`合成作品 ${i}`,author:'合成署名',description:'隔离负载数据',category:'玄幻',views:i,weekly_views:i%100}));
await Book.insertMany(books);
let serial=0,batch=[];
for(let b=0;b<1000;b++){
  const count=b===0?10000:b<=90?91:90;
  for(let c=1;c<=count;c++){
    batch.push({_id:new mongoose.Types.ObjectId((1000000+serial++).toString(16).padStart(24,'0')),bookId:books[b]._id,title:`第${c}章 合成测试`,chapter_number:c,content:b===0&&c===1?'长'.repeat(60000):'用于验证性能与完整性的合成正文。\n'.repeat(50),word_count:b===0&&c===1?60000:950});
    if(batch.length===1000){await Chapter.insertMany(batch);batch=[];}
  }
}
if(batch.length)await Chapter.insertMany(batch);
const server=createApp(readConfig(env)).listen(5001,'127.0.0.1');
fs.mkdirSync('artifacts',{recursive:true});fs.mkdirSync('.runtime',{recursive:true});
fs.writeFileSync('.runtime/staging.json',JSON.stringify({uri:env.MONGO_URI,env:Object.fromEntries(['APP_ENV','MONGO_URI','JWT_SECRET','INTERNAL_API_SECRET','IMPORT_SECRET','TRUST_PROXY','EXTERNAL_SERVICES','MAIL_MODE','PORT','INTERNAL_API_URL','NEXT_PUBLIC_API_URL','NEXT_PUBLIC_SITE_URL','NEXT_PUBLIC_EXTERNAL_SERVICES','NEXT_DIST_DIR','ALLOWED_ORIGINS'].map(k=>[k,env[k]])),bookId:String(books[0]._id),chapterId:(1000000).toString(16).padStart(24,'0')}));
fs.writeFileSync('artifacts/staging-environment.json',JSON.stringify({node:process.version,mongodb:'7.0.40',nginx:'1.30.4',platform:os.platform(),release:os.release(),cpus:os.cpus().length,cpu:os.cpus()[0].model,totalMemory:os.totalmem(),books:1000,chapters:serial,topology:'one-node replica set',externalServices:'disabled'},null,2));
async function run(args,log){return new Promise((resolve,reject)=>{const fd=fs.openSync(log,'w');const child=spawn(process.execPath,args,{env,stdio:['ignore',fd,fd],windowsHide:true});child.on('exit',code=>{fs.closeSync(fd);code===0?resolve():reject(new Error('Child failed: '+args[0]));});child.on('error',reject);});}
await run(['web-next/node_modules/next/dist/bin/next','build','web-next'],'artifacts/staging-build.txt');
const nextLog=fs.openSync('artifacts/staging-next.log','w');
const frontend=spawn(process.execPath,['web-next/node_modules/next/dist/bin/next','start','web-next','--port','3001','--hostname','127.0.0.1'],{env,stdio:['ignore',nextLog,nextLog],windowsHide:true});
const nginxRoot=path.join(root,'.runtime/nginx-1.30.4');
const conf=`worker_processes 1;
events { worker_connections 2048; }
http {
 upstream stage_api { server 127.0.0.1:5001; keepalive 32; }
 upstream stage_web { server 127.0.0.1:3001; keepalive 32; }
 access_log logs/access.log;
 server { listen 127.0.0.1:8088; server_name localhost; client_max_body_size 10m;
 proxy_http_version 1.1; proxy_set_header Connection "";
 add_header X-Robots-Tag "noindex, nofollow" always;
 location /api/ { proxy_pass http://stage_api; proxy_set_header Connection ""; proxy_set_header X-Internal-Api-Secret ""; proxy_set_header X-Forwarded-For $remote_addr; proxy_set_header Host $host; proxy_read_timeout 15s; }
 location /health/ { proxy_pass http://stage_api; }
 location / { proxy_pass http://stage_web; proxy_set_header Connection ""; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $remote_addr; proxy_read_timeout 15s; }
 }
}`;
fs.writeFileSync(path.join(nginxRoot,'conf/staging.conf'),conf);
const nginx=spawn(path.join(nginxRoot,'nginx.exe'),['-p',nginxRoot.replaceAll('\\','/')+'/','-c','conf/staging.conf'],{windowsHide:true,stdio:'inherit'});
console.log('STAGING_READY http://127.0.0.1:8088');
let stopping=false;
async function stop(){if(stopping)return;stopping=true;spawn(path.join(nginxRoot,'nginx.exe'),['-p',nginxRoot.replaceAll('\\','/')+'/','-c','conf/staging.conf','-s','quit'],{windowsHide:true});frontend.kill();server.close();await mongoose.disconnect();await repl.stop();}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
