import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import retention from '../storage-maintenance.cjs';
import storage from './storage-policy.cjs';
import {collectors,validateConfig,runRemote} from './collectors.mjs';
import {MonitorSession} from './session.mjs';
import {validateCredentials} from './analytics.mjs';

// Directory file URLs retain a trailing separator; retention requires a
// normalized root so its descendant check does not compare a double separator.
export const projectRoot=path.resolve(fileURLToPath(new URL('../../',import.meta.url)));
const webRoot=fileURLToPath(new URL('./',import.meta.url));
const safeFile=(root,rel)=>retention.inside(root,rel);
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}
async function body(req){let text='';for await(const chunk of req){text+=chunk;if(text.length>16384)throw Error('请求过大');}return text?JSON.parse(text):{};}
function atomic(root,relative,data){const dest=safeFile(root,relative);fs.mkdirSync(path.dirname(dest),{recursive:true});const tmp=safeFile(root,relative+'.tmp');fs.writeFileSync(tmp,JSON.stringify(data,null,2),{mode:0o600});fs.renameSync(tmp,dest);}
function csv(snapshot){const rows=['module,time,cpu_percent,memory_percent,disk_percent,download_bytes_per_second,upload_bytes_per_second,atlas_logical_bytes,latency_ms,gap'];for(const [key,value]of Object.entries(snapshot.modules))for(const p of value.history)rows.push([key,new Date(p.at).toISOString(),p.cpu,p.memory,p.disk,p.rx,p.tx,p.logical,p.ping??p.latency,p.gap?1:0].map(x=>x??'').join(','));return '\uFEFF'+rows.join('\r\n');}

export async function createMonitor({root=projectRoot,collect,config:configInput,start=true,onClose=()=>{},remote=runRemote}={}) {
  root=path.resolve(root);
  let config;try{config=validateConfig(configInput??JSON.parse(fs.readFileSync(safeFile(root,storage.BASE+'/config.json'),'utf8')));}catch{config=validateConfig(configInput);}
  const token=crypto.randomBytes(32).toString('hex');
  let session=new MonitorSession(collect||collectors(config)),inventory={running:false,buckets:[],error:null},scanController,scanPromise,closing=false,updating=false;
  const tidy=(apply,reserveBytes=0)=>retention.maintain({root,scope:'site-monitor',apply,reserveBytes,processes:[]});
  function diskState(){const files=storage.reports(root);return {policy:storage.POLICY,bytes:files.reduce((n,f)=>n+f.bytes,0),files:files.sort((a,b)=>b.mtime-a.mtime),directory:path.join(root,storage.BASE,'reports')};}
  function snapshot(){return {...session.snapshot(),config:{...config},inventory:{...inventory,buckets:inventory.buckets.map(({cursor,...rest})=>rest)},storage:diskState()};}
  async function scan(){
    if(inventory.running)return;
    inventory={running:true,buckets:[],error:null,startedAt:Date.now()};scanController=new AbortController();
    scanPromise=(async()=>{try{
      for(const id of ['chapters','covers']){
        const total={id,bytes:0,objects:0,pages:0,complete:false,groups:{},startedAt:Date.now()};inventory.buckets.push(total);
        while(!scanController.signal.aborted){
          const part=await remote('inventory',config,scanController.signal,{bucket:id,cursor:total.cursor});
          if(scanController.signal.aborted)break;
          if(part.status==='error'||part.status==='unconfigured')throw Error('R2 容量盘点失败，已保留本次已读取部分');
          total.bytes+=part.bytes;total.objects+=part.objects;total.pages+=part.pages;total.cursor=part.cursor;total.bucket=part.bucket;total.complete=part.complete;
          for(const [name,group]of Object.entries(part.groups)){total.groups[name]??={bytes:0,objects:0};total.groups[name].bytes+=group.bytes;total.groups[name].objects+=group.objects;}
          if(part.complete){total.finishedAt=Date.now();break;}
          if(total.pages>=200){inventory.error='已到单桶 200 次列表请求上限；当前为部分统计。';break;}
        }
        if(scanController.signal.aborted)break;
      }
    }catch(error){inventory.error=scanController.signal.aborted?'盘点已取消；部分结果不代表总容量':error.message;}
    finally{inventory.running=false;inventory.finishedAt=Date.now();}})();
  }
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    const origin=`http://127.0.0.1:${server.address()?.port}`;
    if(req.headers.host!==new URL(origin).host||(req.headers.origin&&req.headers.origin!==origin)){json(res,403,{error:'连接来源不受信任'});return;}
    try{
      const url=new URL(req.url,origin);
      if(url.pathname.startsWith('/api/')){
        if(req.headers['x-monitor-token']!==token){json(res,403,{error:'本地会话已失效'});return;}
        if(closing){json(res,503,{error:'程序正在关闭'});return;}
        if(req.method==='GET'&&url.pathname==='/api/state'){json(res,200,snapshot());return;}
        if(req.method==='GET'&&url.pathname==='/api/report'){
          const name=url.searchParams.get('name');if(!storage.reportPattern.test(name||''))throw Error('报告名称无效');
          const file=safeFile(root,storage.BASE+'/reports/'+name);if(fs.lstatSync(file).size>storage.POLICY.maxReportBytes)throw Error('报告过大');
          res.setHeader('Content-Type',name.endsWith('.csv')?'text/csv; charset=utf-8':'application/json; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename="${name}"`);res.end(fs.readFileSync(file));return;
        }
        if(req.method!=='POST'){json(res,404,{error:'接口不存在'});return;}
        const value=await body(req);
        if(url.pathname==='/api/refresh'){if(value.module&&!session.modules[value.module])throw Error('未知模块');void session.refresh(value.module);json(res,202,{ok:true});return;}
        if(url.pathname==='/api/pause'){session.paused=Boolean(value.paused);json(res,200,{ok:true});return;}
        if(url.pathname==='/api/inventory'){void scan();json(res,202,{ok:true});return;}
        if(url.pathname==='/api/inventory/cancel'){if(inventory.running){inventory.error='盘点已取消；部分结果不代表总容量';scanController?.abort();}json(res,200,{ok:true});return;}
        if(['/api/config','/api/range','/api/analytics/credentials'].includes(url.pathname)&&updating){json(res,409,{error:'正在更新设置，请稍后重试'});return;}
        if(url.pathname==='/api/range'){
          const next=validateConfig({...config,analyticsDays:value.days});updating=true;
          try{atomic(root,storage.BASE+'/config.json',next);config=next;await session.reset(['analytics','business'],collect||collectors(config));json(res,200,{ok:true});}finally{updating=false;}return;
        }
        if(url.pathname==='/api/analytics/credentials'){
          const credentials=validateCredentials(value.credentials);const next=validateConfig({...config,gaPropertyId:value.propertyId,gaCredentialsPath:safeFile(root,storage.BASE+'/google-credentials.json')});
          if(!next.gaPropertyId)throw Error('请先填写谷歌资源 ID');updating=true;
          try{atomic(root,storage.BASE+'/google-credentials.json',credentials);atomic(root,storage.BASE+'/config.json',next);config=next;await session.reset(['analytics','realtime'],collect||collectors(config));json(res,200,{ok:true});}finally{updating=false;}return;
        }
        if(url.pathname==='/api/config'){
          const next=validateConfig({...config,...value});updating=true;
          try{atomic(root,storage.BASE+'/config.json',next);scanController?.abort();await scanPromise;const paused=session.paused;await session.close();
          config=next;inventory={running:false,buckets:[],error:null};session=new MonitorSession(collect||collectors(config));session.paused=paused;session.start();json(res,200,{ok:true});}finally{updating=false;}return;
        }
        if(url.pathname==='/api/export'){
          if(!['json','csv'].includes(value.format))throw Error('导出格式无效');
          const captured=snapshot();delete captured.config.identity;delete captured.config.gaCredentialsPath;delete captured.storage.files;delete captured.storage.directory;
          const data=value.format==='csv'?csv(captured):JSON.stringify(captured,null,2),bytes=Buffer.byteLength(data);
          if(bytes>storage.POLICY.maxReportBytes)throw Error('报告超过 16 MB 上限，请导出 CSV');
          tidy(true,bytes);
          if(diskState().bytes+bytes>storage.POLICY.reportBytes)throw Error('报告目录接近 200 MB 上限，请先另存并清理旧报告');
          const name=`monitor-${new Date().toISOString().replace(/[-:]/g,'').slice(0,15)}-${crypto.randomBytes(4).toString('hex')}.${value.format}`;
          const file=safeFile(root,storage.BASE+'/reports/'+name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,data,{flag:'wx',mode:0o600});json(res,200,{name,bytes});return;
        }
        if(url.pathname==='/api/cleanup'){const result=tidy(value.apply===true);json(res,200,result);return;}
        if(url.pathname==='/api/close'){json(res,200,{ok:true});setImmediate(onClose);return;}
        json(res,404,{error:'接口不存在'});return;
      }
      const assets={'/':'index.html','/app.js':'app.js','/health.mjs':'health.mjs','/periods.mjs':'periods.mjs','/trend-chart.js':'trend-chart.js','/app.css':'app.css','/vendor/bootstrap.min.css':'vendor/bootstrap.min.css','/icon.svg':'icon.svg'};
      if(req.method!=='GET'||!assets[url.pathname]){res.writeHead(404);res.end();return;}
      const file=assets[url.pathname];res.setHeader('Content-Type',file.endsWith('.css')?'text/css':/\.m?js$/.test(file)?'text/javascript':file.endsWith('.svg')?'image/svg+xml':'text/html; charset=utf-8');res.end(fs.readFileSync(path.join(webRoot,file)));
    }catch(error){json(res,400,{error:/^ENOENT/.test(error.message)?'文件不存在':error.message});}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  if(start)session.start();
  const cleanTimer=setInterval(()=>{try{tidy(true);}catch{}},3600000);cleanTimer.unref();
  const baseUrl=`http://127.0.0.1:${server.address().port}`;
  return {server,token,baseUrl,url:baseUrl+'/#'+token,snapshot,get session(){return session;},get config(){return config;},async close(){if(closing)return;closing=true;clearInterval(cleanTimer);scanController?.abort();await Promise.allSettled([session.close(),scanPromise]);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
