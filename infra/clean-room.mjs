import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';

const root=process.cwd(),destination=path.join(root,'.runtime','clean-room-'+Date.now());
await fs.mkdir(destination,{recursive:true});
const manifest=[];
async function copy(relative){
  const source=path.join(root,relative),target=path.join(destination,relative),name=path.basename(relative);
  if(name==='node_modules'||name.startsWith('.env')||name.startsWith('.next')||['artifacts','test-results','playwright-report'].includes(name)||name.endsWith('.tsbuildinfo'))return;
  const stat=await fs.lstat(source);if(stat.isSymbolicLink())throw new Error('Unexpected source symlink');
  if(stat.isDirectory()){await fs.mkdir(target,{recursive:true});for(const child of await fs.readdir(source))await copy(path.join(relative,child));}
  else{const data=await fs.readFile(source);await fs.writeFile(target,data);manifest.push({path:relative,sha256:crypto.createHash('sha256').update(data).digest('hex')});}
}
for(const entry of ['server','web-next'])await copy(entry);
await fs.mkdir(path.join(destination,'artifacts'));
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>['path','systemroot','windir','temp','tmp','userprofile','localappdata','appdata','comspec','processor_architecture'].includes(key.toLowerCase())));
Object.assign(env,{npm_config_cache:path.join(root,'.runtime','npm-cache'),EXTERNAL_SERVICES:'disabled',NEXT_PUBLIC_EXTERNAL_SERVICES:'disabled',NEXT_TELEMETRY_DISABLED:'1',INTERNAL_API_URL:'http://127.0.0.1:59999/api',NEXT_PUBLIC_SITE_URL:'http://127.0.0.1:3000'});
const npm=path.join(path.dirname(process.execPath),'node_modules','npm','bin','npm-cli.js');
const steps=[];
async function run(name,args){
  const begin=Date.now(),log=await fs.open(path.join(root,'artifacts',`clean-${name}.txt`),'w');
  const child=spawn(process.execPath,[npm,...args],{cwd:destination,env,windowsHide:true,stdio:['ignore',log.fd,log.fd]});
  const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});await log.close();
  steps.push({name,args,code,ms:Date.now()-begin});console.log(JSON.stringify(steps.at(-1)));if(code!==0)throw new Error(`Clean step ${name} failed`);
}
try {
  for(const name of ['server','web-next'])await run(name+'-install',['--prefix',name,'ci']);
  await run('server-test',['--prefix','server','test']);
  await run('typecheck',['--prefix','web-next','run','typecheck']);
  await run('lint',['--prefix','web-next','run','lint']);
  await run('build',['--prefix','web-next','run','build']);
} finally {await fs.writeFile(path.join(root,'artifacts','clean-room-report.json'),JSON.stringify({destination,node:process.version,apiUnavailableDuringBuild:true,manifest,steps},null,2));}
