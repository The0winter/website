import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {remoteSnapshot} from './remote.mjs';
import {googleCollectors} from './analytics.mjs';
import {readBusiness} from './business.mjs';

export const defaults = {host:'ubuntu@51.79.242.0',identity:path.join(os.homedir(),'.ssh','ovh_website_ed25519'),site:'https://jiutianxiaoshuo.com',atlasLimitMiB:null,gaPropertyId:'',gaCredentialsPath:process.env.GOOGLE_APPLICATION_CREDENTIALS||'',analyticsDays:30};
export function validateConfig(input={}) {
  const value={...defaults,...input};
  if(!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*@[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(value.host))throw Error('SSH 主机格式应为 user@host');
  if(typeof value.identity!=='string'||!path.isAbsolute(value.identity)||/[\r\n\0]/.test(value.identity))throw Error('SSH 密钥需要绝对路径');
  const site=new URL(value.site);if(site.protocol!=='https:'||site.username||site.password||site.pathname!=='/'||site.search||site.hash)throw Error('网站地址需要 HTTPS 根地址');
  value.site=site.origin;
  if(value.atlasLimitMiB===''||value.atlasLimitMiB===null)value.atlasLimitMiB=null;
  else {value.atlasLimitMiB=Number(value.atlasLimitMiB);if(!Number.isFinite(value.atlasLimitMiB)||value.atlasLimitMiB<1||value.atlasLimitMiB>1e8)throw Error('容量上限无效');}
  value.gaPropertyId=String(value.gaPropertyId||'').trim();
  if(value.gaPropertyId&&!/^\d{1,20}$/.test(value.gaPropertyId))throw Error('谷歌资源 ID 应为纯数字，不是 G- 开头的衡量 ID');
  value.gaCredentialsPath=String(value.gaCredentialsPath||'').trim();
  if(value.gaCredentialsPath&&(!path.isAbsolute(value.gaCredentialsPath)||/[\r\n\0]/.test(value.gaCredentialsPath)))throw Error('谷歌授权文件需要绝对路径');
  value.analyticsDays=Number(value.analyticsDays);if(![7,30,90].includes(value.analyticsDays))throw Error('统计范围应为 7、30 或 90 天');
  return Object.fromEntries(['host','identity','site','atlasLimitMiB','gaPropertyId','gaCredentialsPath','analyticsDays'].map(k=>[k,value[k]]));
}
export function runRemote(kind,config,signal,request={}) {
  if(!['server','atlas','r2','inventory','business'].includes(kind))return Promise.reject(Error('未知采集类型'));
  if(!fs.existsSync(config.identity))return Promise.reject(Error('找不到 SSH 密钥，请在连接设置中检查路径'));
  const script=`const timeout=setTimeout(()=>process.exit(2),25000);try{console.log(JSON.stringify(await (${remoteSnapshot.toString()})(${JSON.stringify(kind)},${JSON.stringify(request)},(${readBusiness.toString()}))))}catch{console.log(JSON.stringify({error:'REMOTE_READ_FAILED'}));process.exitCode=1}finally{clearTimeout(timeout)}`;
  return new Promise((resolve,reject)=>{
    const child=spawn('ssh',['-i',config.identity,'-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=8','-o','ServerAliveInterval=5','-o','ServerAliveCountMax=1',config.host,'sudo -n /opt/node-v22.23.2-linux-x64/bin/node --env-file=/etc/test1/api.env --input-type=module'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let output='',stderr='',done=false;
    const finish=(err,value)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(err)reject(err);else resolve(value);};
    const abort=()=>{child.kill();finish(Error('采集已取消'));};
    const timer=setTimeout(()=>{child.kill();finish(Error('读取超时，请检查服务器连接'));},30000);
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}
    child.stdout.on('data',b=>{output+=b;if(output.length>1024*1024){child.kill();finish(Error('采集响应超出安全上限'));}});
    child.stderr.on('data',b=>{if(stderr.length<8192)stderr+=b;});
    child.on('error',()=>finish(Error('SSH 无法启动，请检查 OpenSSH 是否可用')));
    child.on('close',code=>{
      if(code!==0){const message=/Host key verification failed|REMOTE HOST IDENTIFICATION/.test(stderr)?'SSH 主机身份未验证，请先核对 known_hosts':/Permission denied|password is required/.test(stderr)?'SSH 或 sudo 权限不足':'服务器只读查询失败，请检查连接与现有服务配置';finish(Error(message));return;}
      try{const data=JSON.parse(output.trim());if(data.error)throw Error();finish(null,data);}catch{finish(Error('服务器未返回有效监控数据'));}
    });
    child.stdin.on('error',()=>{});child.stdin.end(script);
  });
}
export async function collectSite(config,signal,{fetchImpl=fetch}={}) {
  // GET only: no browser, analytics script or reading-counter endpoint is executed.
  const checks=[],sampledAt=new Date().toISOString();
  async function read(id,label,route,validate,json=true) {
    const start=Date.now();
    try {
      const response=await fetchImpl(config.site+route,{signal:AbortSignal.any([signal,AbortSignal.timeout(10000)]),redirect:'error',headers:{'User-Agent':'Shiye-Monitor/2.0'}});
      if(!response.ok){await response.body?.cancel();throw Error(`HTTP ${response.status}`);}
      let value;
      const reader=response.body.getReader();let size=0;const chunks=[];try{while(true){const {done,value:part}=await reader.read();if(done)break;size+=part.length;if(size>2*1024*1024)throw Error('响应过大');chunks.push(part);}const text=Buffer.concat(chunks).toString('utf8');value=json?JSON.parse(text):text;}finally{await reader.cancel();}
      validate?.(value);checks.push({id,label,status:'ok',latencyMs:Date.now()-start});return value;
    }catch(error){if(signal.aborted)throw error;checks.push({id,label,status:'error',error:/^HTTP \d+$/.test(error.message)?error.message:'无法读取有效内容',latencyMs:Date.now()-start});return null;}
  }
  await read('home','网站首页','',value=>{if(!/<html[\s>]/i.test(value)||!/<title[\s>]/i.test(value))throw Error();},false);
  const books=await read('books','书籍列表','/api/books?limit=1',value=>{if(!Array.isArray(value)||!value.length||! /^[a-f0-9]{24}$/i.test(value[0].id||value[0]._id))throw Error();});
  if(checks.at(-1).status==='ok') {
    const bookId=books[0].id||books[0]._id;
    const chapters=await read('catalog','章节目录',`/api/books/${bookId}/chapters?limit=1`,value=>{if(!Array.isArray(value)||!value.length||! /^[a-f0-9]{24}$/i.test(value[0].id||value[0]._id))throw Error();});
    if(checks.at(-1).status==='ok')await read('chapter','章节正文',`/api/chapters/${chapters[0].id||chapters[0]._id}`,value=>{if(typeof value?.content!=='string'||!value.content.trim())throw Error();});
    else checks.push({id:'chapter',label:'章节正文',status:'skipped',error:'目录未通过，暂未检查正文'});
  }else checks.push({id:'catalog',label:'章节目录',status:'skipped',error:'书籍列表未通过'},{id:'chapter',label:'章节正文',status:'skipped',error:'书籍列表未通过'});
  return {sampledAt,status:checks[0].status==='ok'?200:null,latencyMs:checks[0].latencyMs,url:config.site,checks};
}
export function collectors(config) {return {...Object.fromEntries(['server','atlas','r2','site','business'].map(kind=>[kind,signal=>kind==='site'?collectSite(config,signal):runRemote(kind,config,signal,kind==='business'?{days:config.analyticsDays}:{})])),...googleCollectors(config)};}
