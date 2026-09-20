import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {remoteSnapshot} from './remote.mjs';

export const defaults = {host:'ubuntu@51.79.242.0',identity:path.join(os.homedir(),'.ssh','ovh_website_ed25519'),site:'https://jiutianxiaoshuo.com',atlasLimitMiB:null};
export function validateConfig(input={}) {
  const value={...defaults,...input};
  if(!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*@[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(value.host))throw Error('SSH 主机格式应为 user@host');
  if(typeof value.identity!=='string'||!path.isAbsolute(value.identity)||/[\r\n\0]/.test(value.identity))throw Error('SSH 密钥需要绝对路径');
  const site=new URL(value.site);if(site.protocol!=='https:'||site.username||site.password||site.pathname!=='/'||site.search||site.hash)throw Error('网站地址需要 HTTPS 根地址');
  value.site=site.origin;
  if(value.atlasLimitMiB===''||value.atlasLimitMiB===null)value.atlasLimitMiB=null;
  else {value.atlasLimitMiB=Number(value.atlasLimitMiB);if(!Number.isFinite(value.atlasLimitMiB)||value.atlasLimitMiB<1||value.atlasLimitMiB>1e8)throw Error('容量上限无效');}
  return {host:value.host,identity:value.identity,site:value.site,atlasLimitMiB:value.atlasLimitMiB};
}
export function runRemote(kind,config,signal,request={}) {
  if(!['server','atlas','r2','inventory'].includes(kind))return Promise.reject(Error('未知采集类型'));
  if(!fs.existsSync(config.identity))return Promise.reject(Error('找不到 SSH 密钥，请在连接设置中检查路径'));
  const script=`const timeout=setTimeout(()=>process.exit(2),25000);try{console.log(JSON.stringify(await (${remoteSnapshot.toString()})(${JSON.stringify(kind)},${JSON.stringify(request)})))}catch{console.log(JSON.stringify({error:'REMOTE_READ_FAILED'}));process.exitCode=1}finally{clearTimeout(timeout)}`;
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
export async function collectSite(config,signal) {
  const start=Date.now();
  const response=await fetch(config.site,{signal:AbortSignal.any([signal,AbortSignal.timeout(12000)]),redirect:'error'});
  await response.body?.cancel();
  if(!response.ok)throw Error(`网站响应 HTTP ${response.status}`);
  return {sampledAt:new Date().toISOString(),status:response.status,latencyMs:Date.now()-start,url:config.site};
}
export function collectors(config) {return Object.fromEntries(['server','atlas','r2','site'].map(kind=>[kind,signal=>kind==='site'?collectSite(config,signal):runRemote(kind,config,signal)]));}
