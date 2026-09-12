import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const usage = 'node infra/upload-cover.mjs --book=书名 --image=图片路径 [--author=作者] [--apply]\n也可用 --book-id=书籍ID；可选 --admin=管理员 --host=SSH主机 --identity=SSH密钥 --site=网站地址。默认只预览。';
export function parseArgs(args) {
  const options = {apply:false, host:'ubuntu@51.79.242.0', identity:path.join(os.homedir(),'.ssh','ovh_website_ed25519'), site:'https://jiutianxiaoshuo.com'};
  const names = {'book':'book','book-id':'bookId','author':'author','image':'image','admin':'admin','host':'host','identity':'identity','site':'site'};
  const seen = new Set();
  for (const arg of args) {
    if (arg === '--help') return {help:true};
    if (arg === '--apply' && !seen.has('apply')) {options.apply=true;seen.add('apply');continue;}
    const match = /^--([^=]+)=(.+)$/s.exec(arg);
    if (!match || !names[match[1]] || seen.has(match[1])) throw Error(usage);
    seen.add(match[1]); options[names[match[1]]] = match[2];
  }
  if (!options.image || Boolean(options.book) === Boolean(options.bookId)) throw Error(usage);
  if (options.bookId && !/^[a-f0-9]{24}$/.test(options.bookId)) throw Error('书籍 ID 无效');
  if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*@[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(options.host)) throw Error('SSH 主机无效');
  const site = new URL(options.site);
  if (site.protocol!=='https:' || site.username || site.password || site.pathname!=='/' || site.search || site.hash) throw Error('网站地址须为 HTTPS 站点根地址');
  options.site=site.origin;
  return options;
}

// This function is also sent over SSH; keep all server dependencies explicit.
export async function uploadCover(job, services) {
  const {mongoose,Book,Media,User,prepareCover,storage,config,lockBook,claimMedia,checkWritable,verifyImage,writeAudit,hash,newId} = services;
  const fail = message => {throw Object.assign(new Error(message),{coverMessage:message});};
  if (!/^cover-[a-f0-9-]{36}$/.test(job.runId) || Boolean(job.book)===Boolean(job.bookId) || (job.bookId&&!/^[a-f0-9]{24}$/.test(job.bookId))) fail('上传参数无效');
  const bytes=Buffer.from(job.imageBase64,'base64');
  if (!bytes.length || bytes.length>8*1024*1024 || hash(bytes)!==job.sourceSha256) fail('图片字节无效或超过 8 MB');
  await checkWritable();
  const filter={deletedAt:null,...(job.bookId?{_id:job.bookId}:{title:job.book}),...(job.author?{author:job.author}:{})};
  const books=await Book.find(filter).limit(2).lean();
  if (books.length!==1) fail(books.length?'存在同名作品，请指定作者或书籍 ID':'未找到对应的在架作品');
  const before=books[0];
  const admins=await User.find({role:'admin',isBanned:{$ne:true},...(job.admin?{username:job.admin}:{})}).select('_id username').limit(2).lean();
  if (admins.length!==1) fail('请用 --admin 指定唯一的现有管理员');
  const actor={id:String(admins[0]._id),role:'admin'};
  const variants=await prepareCover(bytes);
  if (variants.length!==2 || variants.some((v,i)=>v.width!==[240,480][i]||v.height!==[320,640][i])) fail('请先把封面裁成 3:4；也可使用网站的封面裁剪框');
  const previousCover=before.cover_image||'';
  const same=previousCover.startsWith(config.baseUrl+'/covers/') && await Media.exists({publicUrl:previousCover,storage:'r2',bucket:config.bucket,deleted:false,sha256:variants[1].sha256});
  const result={runId:job.runId,bookId:String(before._id),title:before.title,author:before.author,previousCover,sourceSha256:job.sourceSha256,variants:variants.map(({width,height,bytes,sha256})=>({width,height,size:bytes.length,sha256}))};
  if (same) {
    for (const variant of variants) await verifyImage(previousCover.replace('/480.webp',`/${variant.width}.webp`),variant.sha256);
    return {...result,status:'unchanged',cover:previousCover};
  }
  if (!job.apply) return {...result,status:'preview',wouldReplace:Boolean(previousCover)};
  const mediaId=newId();
  await writeAudit({...result,status:'prepared',actor:actor.id,mediaId});
  const stored=await storage.write(mediaId,variants);
  const uploaded={...result,status:'uploaded',actor:actor.id,mediaId,stored};
  await writeAudit(uploaded);
  for (const variant of variants) await verifyImage(stored.publicUrl.replace('/480.webp',`/${variant.width}.webp`),variant.sha256);
  await checkWritable();
  await mongoose.connection.transaction(async session=>{
    if (!await User.exists({_id:actor.id,role:'admin',isBanned:{$ne:true}}).session(session)) fail('管理员状态已变化');
    const book=await lockBook(result.bookId,actor,session);
    if (book.title!==before.title || book.author!==before.author || (book.cover_image||'')!==previousCover) fail('书籍或封面已被其他任务修改，请重新检查后重试');
    await Media.create([{_id:mediaId,owner:actor.id,...stored}],{session});
    if (!await claimMedia(stored.publicUrl,actor.id,session)) fail('封面归属校验失败');
    book.cover_image=stored.publicUrl; await book.save({session});
  });
  if (!await Book.exists({_id:before._id,cover_image:stored.publicUrl})) fail('封面绑定回读失败');
  await writeAudit({...uploaded,status:'bound',completedAt:new Date().toISOString()});
  return {...result,status:'bound',cover:stored.publicUrl,mediaId};
}

// Runs against the active release. No persistent remote script or local R2 credentials.
async function remoteWorker(run,job) {
  const fs=await import('node:fs/promises'), path=await import('node:path');
  const {pathToFileURL}=await import('node:url'),crypto=await import('node:crypto');
  process.chdir('/srv/test1/current/server');
  const load=name=>import(pathToFileURL(path.resolve(name)).href);
  let mongoose,storageClient;
  try {
    mongoose=(await load('node_modules/mongoose/index.js')).default;
    const [Book,Media,User]=await Promise.all(['Book','Media','User'].map(async name=>(await load(`models/${name}.js`)).default));
    const {prepareCover,coverConfig,createCoverStorage}=await load('services/cover-storage.js');
    const {lockBook}=await load('services/content.js'),{claimMedia}=await load('services/media-reference.js');
    const {S3Client}=await load('node_modules/@aws-sdk/client-s3/dist-cjs/index.js');
    const config=coverConfig();
    if (!config) throw Error('Cover storage unavailable');
    const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
    storageClient=new S3Client({region:'auto',endpoint:config.endpoint,credentials:config.credentials,maxAttempts:2});
    const checkWritable=async()=>{
      if (process.env.WRITE_MODE!=='readwrite') throw Object.assign(new Error(),{coverMessage:'网站处于只读维护状态，请恢复后重试'});
      let response; try {response=await fetch('http://127.0.0.1:5000/health/ready',{signal:AbortSignal.timeout(10000)});} catch {}
      if (!response?.ok) throw Object.assign(new Error(),{coverMessage:'网站 API 暂不可用，请恢复后重试'});
    };
    await checkWritable();
    await mongoose.connect(process.env.MONGO_URI,{autoIndex:false,autoCreate:false,serverSelectionTimeoutMS:10000});
    const result=await run(job,{mongoose,Book,Media,User,prepareCover,config,lockBook,claimMedia,hash,checkWritable,
      storage:createCoverStorage(config,storageClient),newId:()=>String(new mongoose.Types.ObjectId()),
      verifyImage:async(url,expected)=>{
        const response=await fetch(url,{signal:AbortSignal.timeout(25000)});
        if (!response.ok || response.headers.get('content-type')!=='image/webp' || hash(Buffer.from(await response.arrayBuffer()))!==expected) throw Object.assign(new Error(),{coverMessage:'公网图片校验失败；原书籍封面尚未替换'});
      },
      writeAudit:async record=>{
        const destination=`/srv/test1/import-runs/${job.runId}.json`;
        const temporary=destination+'.tmp';
        await fs.writeFile(temporary,JSON.stringify(record,null,2),{mode:0o600});
        await fs.rename(temporary,destination);
      }
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.log(JSON.stringify({error:error.coverMessage||'封面操作失败，未报告成功；请检查服务器状态和上传审计记录',runId:job.runId}));
    process.exitCode=1;
  } finally {storageClient?.destroy();if(mongoose)await mongoose.disconnect();}
}

export async function main(args) {
  const options=parseArgs(args);
  if (options.help) {console.log(usage);return;}
  const image=path.resolve(options.image),stat=await fs.stat(image);
  if (!stat.isFile() || !stat.size || stat.size>8*1024*1024) throw Error('请选择 8 MB 以内的图片文件');
  const bytes=await fs.readFile(image),runId='cover-'+crypto.randomUUID();
  const job={runId,book:options.book,bookId:options.bookId,author:options.author,admin:options.admin,apply:options.apply,imageBase64:bytes.toString('base64'),sourceSha256:crypto.createHash('sha256').update(bytes).digest('hex')};
  const command='sudo -n /opt/node-v22.23.2-linux-x64/bin/node --env-file=/etc/test1/api.env --input-type=module';
  const result=await new Promise((resolve,reject)=>{
    const child=spawn('ssh',['-i',options.identity,'-o','BatchMode=yes','-o','ConnectTimeout=15',options.host,command],{stdio:['pipe','pipe','pipe'],windowsHide:true});
    let stdout=''; const timer=setTimeout(()=>{child.kill();reject(Error(`SSH 超时；重新执行会检查现有封面。记录 ID：${runId}`));},180000);
    child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{stdout+=chunk;});
    child.stderr.resume(); // Never echo server diagnostics that could contain credentials.
    child.stdin.on('error',()=>{});
    child.on('error',error=>{clearTimeout(timer);reject(error);});
    child.on('close',code=>{
      clearTimeout(timer);
      let parsed;try{parsed=JSON.parse(stdout.trim());}catch{reject(Error(`SSH 执行失败，请检查连接和服务器权限（退出码 ${code}）`));return;}
      if(code!==0||parsed.error)reject(Error(parsed.error||'封面操作未完成'));else resolve(parsed);
    });
    // JSON goes into JavaScript on stdin, never into a shell command or source file.
    child.stdin.end(`(${remoteWorker.toString()})(${uploadCover.toString()},${JSON.stringify(job)});`);
  });
  const directory=fileURLToPath(new URL('../.runtime/cover-uploads/',import.meta.url));
  await fs.mkdir(directory,{recursive:true});
  const reportPath=path.join(directory,runId+'.json'),report={...result,image,site:options.site};
  await fs.writeFile(reportPath,JSON.stringify(report,null,2));
  if(options.apply && result.cover) {
    try {
      const response=await fetch(`${options.site}/api/books/${result.bookId}`,{signal:AbortSignal.timeout(20000)});
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      const book=await response.json();
      if (book.cover_image!==result.cover) throw Error('封面地址不匹配');
      const page=await fetch(`${options.site}/book/${result.bookId}`,{signal:AbortSignal.timeout(20000)});
      if(!page.ok || !(await page.text()).includes(result.cover)) throw Error('页面未显示新封面');
      report.verifiedAt=new Date().toISOString();
    } catch(error) {report.verificationError=error.message;await fs.writeFile(reportPath,JSON.stringify(report,null,2));throw Error(`封面已绑定，但公网验收未通过：${error.message}。记录：${reportPath}`);}
    await fs.writeFile(reportPath,JSON.stringify(report,null,2));
  }
  console.log(JSON.stringify({...result,verifiedAt:report.verifiedAt,reportPath}));
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
