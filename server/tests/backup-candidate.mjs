// Actual tools, fresh synthetic replicas, no old URI and no production writes.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import {MongoMemoryReplSet} from 'mongodb-memory-server';
import {runBackup} from '../../infra/backup.mjs';
import {createApp} from '../app.js';
import {readConfig} from '../config.js';
import User from '../models/User.js';
import Book from '../models/Book.js';
import Chapter from '../models/Chapter.js';
import Bookmark from '../models/Bookmark.js';
import Review from '../models/Review.js';
import ChapterDraft from '../models/ChapterDraft.js';
const root=process.cwd(),started=Date.now(),directory=path.join(root,'.runtime','backup-candidate-'+started);
await fs.mkdir(directory,{recursive:true});
const toolDirectory=path.join(root,'.runtime/mongodb-database-tools-windows-x86_64-100.17.0/bin');
const source=await MongoMemoryReplSet.create({binary:{version:'7.0.40'},replSet:{count:1,storageEngine:'wiredTiger'}});
const target=await MongoMemoryReplSet.create({binary:{version:'7.0.40'},replSet:{count:1,storageEngine:'wiredTiger'}});
try{
  await mongoose.connect(source.getUri('test1_test'),{autoIndex:false,autoCreate:false,serverSelectionTimeoutMS:5000});
  for(const model of Object.values(mongoose.models))await model.createIndexes();
  const user=await User.create({username:'恢复作者',email:'restore@example.test',password:await bcrypt.hash('Restore-test-12345',10)});
  const book=await Book.create({title:'恢复关系合成作品',author_id:user._id});
  const chapter=await Chapter.create({bookId:book._id,title:'原章节URL',content:'必须逐字恢复的合成正文。'.repeat(100),chapter_number:1});
  await Bookmark.create({user_id:user._id,bookId:book._id});
  await Review.create({user:user._id,book:book._id,rating:5,content:'合成恢复评论'});
  await ChapterDraft.create({owner:user._id,bookId:book._id,chapter_number:2,title:'私密草稿',content:'恢复后仍不公开'});
  const uri=new URL(source.getUri());uri.pathname='/';
  const mongoConfig=path.join(directory,'mongodump.yaml');await fs.writeFile(mongoConfig,'uri: '+JSON.stringify(uri.href)+'\n',{mode:0o600});
  const manifest=await runBackup({directory,mongoConfig,mongodump:path.join(toolDirectory,'mongodump.exe'),codeVersion:'working-candidate',schemaVersion:'r3-v2'});
  await mongoose.disconnect();
  const restoredUri=new URL(target.getUri());restoredUri.pathname='/';
  await new Promise((resolve,reject)=>{
    const child=spawn(path.join(toolDirectory,'mongorestore.exe'),['--uri='+restoredUri.href,'--archive='+path.join(directory,manifest.archive),'--gzip','--oplogReplay'],{windowsHide:true,stdio:'ignore'});
    child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`Restore failed: ${code}`)));
  });
  await mongoose.connect(target.getUri('test1_test'),{autoIndex:false,autoCreate:false,serverSelectionTimeoutMS:5000});
  assert.equal((await Chapter.findById(chapter._id)).content,chapter.content);
  assert.equal(String((await Bookmark.findOne({user_id:user._id})).bookId),String(book._id));
  assert.equal(String((await Review.findOne({book:book._id})).user),String(user._id));
  assert.equal((await ChapterDraft.findOne({owner:user._id})).content,'恢复后仍不公开');
  assert.ok(await bcrypt.compare('Restore-test-12345',(await User.findById(user._id)).password));
  assert.ok((await Chapter.collection.indexes()).some(index=>index.unique&&index.key.bookId===1&&index.key.chapter_number===1));
  const config=readConfig({APP_ENV:'test',MONGO_URI:target.getUri('test1_test'),JWT_SECRET:crypto.randomBytes(48).toString('hex'),EXTERNAL_SERVICES:'disabled'});
  const server=createApp(config).listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  try{
    const base=`http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(base+'/health/ready')).status,200);
    assert.equal((await (await fetch(base+'/api/chapters/'+chapter._id)).json()).content,chapter.content);
    const catalog=await (await fetch(`${base}/api/books/${book._id}/chapters`)).json();assert.equal(catalog.length,1);
    const csrfResponse=await fetch(base+'/api/auth/csrf');const csrf=await csrfResponse.json();
    const login=await fetch(base+'/api/auth/signin',{method:'POST',headers:{'content-type':'application/json',origin:'http://127.0.0.1:3000','x-csrf-token':csrf.csrfToken,cookie:csrfResponse.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')},body:JSON.stringify({email:user.email,password:'Restore-test-12345'})});
    assert.equal(login.status,200);
    const cookie=login.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
    assert.equal((await fetch(`${base}/api/books/${book._id}/draft`,{headers:{cookie}})).status,200);
    assert.equal((await fetch(`${base}/api/users/${user._id}/bookmarks`,{headers:{cookie}})).status,200);
  }finally{await new Promise(resolve=>server.close(resolve));}
  const report={result:'passed',elapsedMs:Date.now()-started,mongodb:'7.0.40',tools:'100.17.0',backup:manifest,checked:['chapter ID and exact content','book-user-shelf-review relations','password login','private draft retention','unique chapter index','readiness and restored HTTP reading'],limitations:['synthetic data only','same Windows machine','no offsite copy','no browser or Linux boot verification']};
  await fs.writeFile('artifacts/backup-candidate-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({result:report.result,elapsedMs:report.elapsedMs}));
}finally{await mongoose.disconnect();await source.stop();await target.stop();}
