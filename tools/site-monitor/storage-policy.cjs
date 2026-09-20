const fs=require('node:fs');
const path=require('node:path');
const BASE='.runtime/site-monitor';
const POLICY=Object.freeze({reportDays:30,reportBytes:200*1024**2,profileDays:1,browserBytes:256*1024**2,maxReportBytes:16*1024**2});
const reportPattern=/^monitor-\d{8}T\d{6}-[a-f0-9]{8}\.(json|csv)$/;
function list(root,relative){
  const target=path.join(root,relative);
  // Fail closed on any linked ancestor, including .runtime.
  let cursor=root;for(const part of relative.split('/')){cursor=path.join(cursor,part);if(!fs.existsSync(cursor))return [];if(fs.lstatSync(cursor).isSymbolicLink())return [];}
  return fs.readdirSync(target,{withFileTypes:true});
}
function alive(pid){if(!Number.isInteger(pid)||pid<1)return true;try{process.kill(pid,0);return true;}catch(e){return e.code!=='ESRCH';}}
function reports(root){return list(root,BASE+'/reports').filter(e=>e.isFile()&&reportPattern.test(e.name)).map(e=>{const relative=BASE+'/reports/'+e.name,s=fs.lstatSync(path.join(root,relative));return {name:e.name,path:relative,bytes:s.size,mtime:s.mtimeMs};});}
function browserBytes(root){
  let bytes=0,files=0;
  function visit(target){const stat=fs.lstatSync(target);if(stat.isSymbolicLink())return;if(++files>200000)throw Error('Browser directory has too many files');if(stat.isFile())bytes+=stat.size;else if(stat.isDirectory())for(const e of fs.readdirSync(target))visit(path.join(target,e));}
  for(const e of list(root,BASE+'/browser'))if(e.isDirectory()&&/^session-[a-f0-9-]{36}$/.test(e.name))visit(path.join(root,BASE,'browser',e.name));
  return bytes;
}
function candidates(root,now=Date.now(),reserveBytes=0){
  if(!Number.isInteger(reserveBytes)||reserveBytes<0||reserveBytes>POLICY.maxReportBytes)throw Error('Invalid report reservation');
  const out=[],files=reports(root).sort((a,b)=>a.mtime-b.mtime);let bytes=files.reduce((n,f)=>n+f.bytes,0)+reserveBytes;
  for(const f of files)if(now-f.mtime>POLICY.reportDays*86400000||bytes>POLICY.reportBytes){out.push(f.path);bytes-=f.bytes;}
  for(const e of list(root,BASE+'/browser')){
    if(!e.isDirectory()||!/^session-[a-f0-9-]{36}$/.test(e.name))continue;
    const relative=BASE+'/browser/'+e.name,target=path.join(root,relative),ownerFile=path.join(target,'owner.json');
    try {
      if(fs.lstatSync(ownerFile).isSymbolicLink())continue;
      const owner=JSON.parse(fs.readFileSync(ownerFile,'utf8'));
      if(owner.app!=='site-monitor'||(owner.browserPid&&alive(owner.browserPid)))continue;
      if(!owner.closed&&alive(owner.pid))continue;
      if(owner.closed||now-fs.statSync(target).mtimeMs>POLICY.profileDays*86400000)out.push(relative);
    }catch { /* Unknown directory is protected. */ }
  }
  return out;
}
module.exports={BASE,POLICY,reportPattern,reports,candidates,browserBytes};
