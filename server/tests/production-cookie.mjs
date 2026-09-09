import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import {MongoMemoryReplSet} from 'mongodb-memory-server';
import {chromium} from '../../web-next/node_modules/playwright/index.mjs';
import {readConfig} from '../config.js';
import {createApp} from '../app.js';
import User from '../models/User.js';
import Book from '../models/Book.js';
import Chapter from '../models/Chapter.js';
import {createMaintenance} from '../../infra/maintenance.mjs';
const root=process.cwd(),directory=path.join(root,'.runtime','tls-'+Date.now()),origin='https://127.0.0.1:8443';
await fs.mkdir(directory,{recursive:true});
const clean=JSON.parse(await fs.readFile('artifacts/clean-room-report.json','utf8'));
if(clean.steps.some(step=>step.code!==0)||!clean.steps.some(step=>step.name==='build'))throw new Error('Passing clean build required');
async function command(file,args){await new Promise((resolve,reject)=>{const child=spawn(file,args,{stdio:'ignore',windowsHide:true});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`Local command failed: ${code}`)));});}
await command('F:/MERN/git/Git/usr/bin/openssl.exe',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(directory,'key.pem'),'-out',path.join(directory,'cert.pem'),'-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1']);
const replica=await MongoMemoryReplSet.create({binary:{version:'7.0.40'},replSet:{count:1,storageEngine:'wiredTiger'}});
const env={...process.env,APP_ENV:'production',NODE_ENV:'production',MONGO_URI:replica.getUri('test1_test'),JWT_SECRET:crypto.randomBytes(48).toString('hex'),INTERNAL_API_SECRET:crypto.randomBytes(32).toString('hex'),EXTERNAL_SERVICES:'disabled',MAIL_MODE:'capture',WRITE_MODE:'readwrite',ALLOWED_ORIGINS:origin,TRUST_PROXY:'loopback',INTERNAL_API_URL:'http://127.0.0.1:5003/api',NEXT_DIST_DIR:'.next-candidate',NEXT_PUBLIC_SITE_URL:origin,NEXT_PUBLIC_EXTERNAL_SERVICES:'disabled',NEXT_TELEMETRY_DISABLED:'1'};
Object.assign(process.env,env);
await mongoose.connect(env.MONGO_URI,{autoIndex:false,autoCreate:false,serverSelectionTimeoutMS:5000});
for(const model of Object.values(mongoose.models))await model.createIndexes();
await User.create({username:'TLS合成用户',email:'tls@example.test',password:await bcrypt.hash('TLS-test-12345',10)});
const preservedBook=await Book.create({title:'维护切换后保留的作品'});
const preservedChapter=await Chapter.create({bookId:preservedBook._id,title:'原章节',content:'维护切换不恢复旧数据库，也不丢失这些新正文。',chapter_number:1});
const api=createApp(readConfig(env)).listen(5003,'127.0.0.1');
const frontend=spawn(process.execPath,[path.join(clean.destination,'web-next/node_modules/next/dist/bin/next'),'start',path.join(clean.destination,'web-next'),'--hostname','127.0.0.1','--port','3003'],{env,stdio:'ignore',windowsHide:true});
const nginxRoot=path.join(root,'.runtime/nginx-1.30.4'),nginx=path.join(nginxRoot,'nginx.exe'),prefix=nginxRoot.replaceAll('\\','/')+'/';
const conf=path.join(directory,'nginx.conf').replaceAll('\\','/');
await fs.writeFile(conf,`pid ${directory.replaceAll('\\','/')}/nginx.pid;
events { worker_connections 128; }
http { server { listen 127.0.0.1:8443 ssl; server_name 127.0.0.1;
ssl_certificate ${directory.replaceAll('\\','/')}/cert.pem; ssl_certificate_key ${directory.replaceAll('\\','/')}/key.pem;
add_header X-Robots-Tag "noindex, nofollow" always;
proxy_set_header Host $http_host; proxy_set_header X-Forwarded-For $remote_addr; proxy_set_header X-Forwarded-Proto https; proxy_set_header X-Internal-Api-Secret "";
location /api/ { proxy_pass http://127.0.0.1:5003; }
location / { proxy_pass http://127.0.0.1:3003; }
} }`);
const proxy=spawn(nginx,['-p',prefix,'-c',conf],{stdio:'ignore',windowsHide:true});
let browser;
try{
  for(let attempt=0;attempt<30;attempt++){try{if((await fetch('http://127.0.0.1:3003/login')).ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,200));}
  browser=await chromium.launch({channel:'chrome',headless:true});
  const context=await browser.newContext({ignoreHTTPSErrors:true});
  const page=await context.newPage();
  await page.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
  await page.goto(origin+'/login');
  await page.getByPlaceholder('请输入用户名').fill('TLS合成用户');await page.getByPlaceholder('请输入密码').fill('TLS-test-12345');
  await page.getByRole('button',{name:'立即登录',exact:true}).click();await page.waitForURL(origin+'/');
  await page.reload();
  assert.equal((await page.request.get(origin+'/api/auth/session')).status(),200);
  const session=(await context.cookies()).find(cookie=>cookie.name==='__Host-session');
  assert.ok(session);assert.equal(session.secure,true);assert.equal(session.httpOnly,true);assert.equal(session.path,'/');assert.equal(session.sameSite,'Lax');
  const oldSession=session.value;
  await page.goto(origin+'/profile');page.on('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'退出',exact:true}).click();await page.waitForURL(origin+'/');
  assert.equal((await page.request.get(origin+'/api/auth/session',{headers:{cookie:'__Host-session='+oldSession}})).status(),401);
  const originalConf=await fs.readFile(conf,'utf8');
  const maintenance=createMaintenance().listen(5004,'127.0.0.1');await new Promise(resolve=>maintenance.once('listening',resolve));
  const rollbackStarted=Date.now();
  try{
    await fs.writeFile(conf,originalConf.replaceAll(/proxy_pass http:\/\/127\.0\.0\.1:(5003|3003);/g,'proxy_pass http://127.0.0.1:5004;'));
    await command(nginx,['-p',prefix,'-c',conf,'-t']);await command(nginx,['-p',prefix,'-c',conf,'-s','reload']);
    for(let i=0;i<30;i++){if((await page.request.get(origin+'/api/books/'+preservedBook._id)).status()===503)break;await new Promise(resolve=>setTimeout(resolve,100));}
    const unavailable=await page.goto(origin+'/book/'+preservedBook._id);assert.equal(unavailable.status(),503);assert.equal(unavailable.headers()['retry-after'],'60');
    assert.match(await page.locator('body').innerText(),/网站维护中/);
    await fs.writeFile(conf,originalConf);await command(nginx,['-p',prefix,'-c',conf,'-s','reload']);
    let restored;
    for(let i=0;i<30;i++){restored=await page.request.get(origin+'/api/chapters/'+preservedChapter._id);if(restored.status()===200)break;await new Promise(resolve=>setTimeout(resolve,100));}
    assert.equal(restored.status(),200);assert.equal((await restored.json()).content,preservedChapter.content);
    assert.equal(await Chapter.countDocuments({bookId:preservedBook._id}),1);
    await fs.writeFile('artifacts/maintenance-recovery-report.json',JSON.stringify({result:'passed',elapsedMs:Date.now()-rollbackStarted,proxy:'actual nginx TLS reload',preservedChapterId:String(preservedChapter._id),contentSha256:crypto.createHash('sha256').update(preservedChapter.content).digest('hex'),mode:'candidate to maintenance to same candidate',limitations:'No safe earlier release exists; this is a maintenance fallback drill, not a two-version schema rollback or production data restore'},null,2));
  }finally{await fs.writeFile(conf,originalConf);await new Promise(resolve=>maintenance.close(resolve));}
  await fs.writeFile('artifacts/production-cookie-report.json',JSON.stringify({result:'passed',origin,mode:'production with synthetic replica',cleanBuild:clean.destination,proxy:'nginx HTTPS to Next production and API',checks:['secure HttpOnly __Host-session at /','SameSite=Lax','browser refresh remains authenticated','logout revokes replayed old cookie'],externalServices:'disabled',limitations:'Loopback self-signed certificate accepted only by isolated browser context; no public DNS, trusted certificate or Linux service test'},null,2));
  console.log('PRODUCTION_COOKIE_PASSED');
}finally{if(browser)await browser.close();await command(nginx,['-p',prefix,'-c',conf,'-s','quit']);frontend.kill();await new Promise(resolve=>api.close(resolve));await mongoose.disconnect();await replica.stop();}
