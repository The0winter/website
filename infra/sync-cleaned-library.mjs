import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createVpsLibrarySession} from './library-sync-session.mjs';
import {atomicWrite, hash, readJson, withLock} from '../tools/novel-crawler/storage.mjs';
import {continuationKey} from '../tools/novel-crawler/continuation.mjs';

const volume = c => JSON.stringify([c.volume_title || null, c.volume_number || null]);
export function planCleaningSync(book, report, remote) {
  const chapters = new Map(book.chapters.map(c=>[c.chapter_number,c])), existing = new Map(remote.chapters.map(c=>[c.number,c]));
  if (chapters.size !== book.chapters.length || existing.size !== remote.chapters.length) throw Error('重复序号，已停止修订');
  const patches = [], missing = [];
  for (const change of report.changes) {
    const local = chapters.get(change.number), old = existing.get(change.number);
    if (!local || hash(local.content) !== change.afterHash || volume(local) !== volume(change.afterVolume)) throw Error('本地清理结果已变化');
    if (!old) {missing.push(change.number); continue;}
    if (old.title !== local.title || old.link && local.link && old.link !== local.link) throw Error(`第 ${change.number} 章身份不一致`);
    if (old.hash === change.afterHash && volume(old) === volume(change.afterVolume)) continue;
    if (old.hash !== change.beforeHash || volume(old) !== volume(change.beforeVolume)) throw Error(`第 ${change.number} 章线上原文或卷信息已变化`);
    patches.push({id:old.id,number:change.number,title:local.title,link:local.link,beforeHash:change.beforeHash,beforeVolume:change.beforeVolume,
      content:local.content,...change.afterVolume});
  }
  const batches=[];let batch=[],bytes=0;
  for(const patch of patches){const size=Buffer.byteLength(JSON.stringify(patch));if(batch.length && (batch.length>=200 || bytes+size>3.5*1024*1024)){batches.push(batch);batch=[];bytes=0;}batch.push(patch);bytes+=size;}
  if(batch.length)batches.push(batch);
  return {batches,missing,changed:patches.length};
}

export async function main(args=process.argv.slice(2)) {
  const opts=Object.fromEntries(args.filter(a=>a.includes('=')).map(a=>a.slice(2).split(/=(.*)/su).slice(0,2)));
  if(args.some(a=>a!=='--apply'&&!/^--(?:summary|report-dir|file|run-id|restore|online-title)=/u.test(a)))throw Error('参数无效');
  if('online-title' in opts&&(!opts.file||!opts['online-title'].trim()))throw Error('已核实的线上书名只能配合 --file 指定单本书');
  const transport=createVpsLibrarySession({worker:'library-cleaning-worker.mjs'}),apply=args.includes('--apply');
  const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
  try{
    if(opts.restore){if(!apply)throw Error('恢复需要 --apply');console.log(JSON.stringify(await transport({mode:'restore',backupFile:opts.restore})));return;}
    if(!opts.summary||!opts['report-dir'])throw Error('需要 --summary=本地已执行摘要.json --report-dir=任务目录');
    const input=readJson(path.resolve(opts.summary));if(!input.apply)throw Error('只能同步已完成的本地清理');
    const reportDir=path.resolve(opts['report-dir']);fs.mkdirSync(reportDir,{recursive:true});
    const runId=opts['run-id']||'reading-cleanup-'+new Date().toISOString().replace(/[:.]/g,'-');
    const result={apply,runId,startedAt:new Date().toISOString(),books:[],errors:[]};
    for(const item of input.books.filter(b=>b.changed&&(!opts.file||b.file===opts.file))){
      try{
        const report=readJson(item.reportFile);
        await withLock(path.join(root,'.novel-crawler/book-locks',continuationKey(report)+'.lock'),async()=>{
          const bytes=fs.readFileSync(path.join(root,'downloads',item.file));
          if(hash(bytes)!==report.afterHash)throw Error('清理后本地文件又发生变化，已暂停此书同步');
          const book=JSON.parse(bytes.toString('utf8')),identity={sourceUrl:book.sourceUrl,title:opts['online-title']||book.title,author:book.author};
          const remote=await transport({mode:'inspect',...identity});
          const evidenceFile=path.join(reportDir,continuationKey(book)+'-before.json');
          if(!fs.existsSync(evidenceFile))atomicWrite(evidenceFile,{identity,...remote});
          const receiptsFile=path.join(reportDir,continuationKey(book)+'-receipts.json');
          const savedReceipts=readJson(receiptsFile);
          const plan=planCleaningSync(book,report,remote),receipts=savedReceipts?.receipts||[];
          let token=remote.token;
          for(const chapters of plan.batches){
            const receipt=await transport({mode:'revise',...identity,bookId:remote.bookId,token,runId,chapters,preview:!apply});
            if(apply)token=receipt.token;receipts.push(receipt);
            atomicWrite(receiptsFile,{file:item.file,title:item.title,runId,receipts});
          }
          if(apply){
            const verified=await transport({mode:'inspect',...identity});
            if(planCleaningSync(book,report,verified).changed)throw Error('线上修订后复核不一致');
            const after=new Map(verified.chapters.map(c=>[c.id,c]));
            for(const before of remote.chapters){const current=after.get(before.id);if(!current||before.number!==current.number||before.title!==current.title||before.link!==current.link)throw Error('章节身份或顺序发生变化');}
            atomicWrite(path.join(reportDir,continuationKey(book)+'-verified.json'),verified);
          }
          result.books.push({file:item.file,title:item.title,bookId:remote.bookId,updated:plan.changed,missingOnline:plan.missing,verified:apply,batches:receipts.length});
        });
      }catch(error){result.errors.push({file:item.file,title:item.title,error:error.message});if(error.fatal){atomicWrite(path.join(reportDir,apply?'verified-sync-summary.json':'preview-sync-summary.json'),result);break;}}
      atomicWrite(path.join(reportDir,apply?'verified-sync-summary.json':'preview-sync-summary.json'),result);
    }
    console.log(JSON.stringify({apply,books:result.books.length,updated:result.books.reduce((n,b)=>n+b.updated,0),errors:result.errors,reportDir}));
    if(result.errors.length)process.exitCode=2;
  }finally{await transport.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
