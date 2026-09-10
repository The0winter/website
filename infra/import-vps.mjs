import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {prepareImport} from './import-plan.mjs';
const args=process.argv.slice(2);
const files=args.filter(a=>!a.startsWith('--'));
if(files.length!==1||args.some(a=>a.startsWith('--')&&!['--apply','--validate-only'].includes(a)&&!a.startsWith('--host=')&&!a.startsWith('--identity=')))throw Error('Usage: node infra/import-vps.mjs FILE [--apply | --validate-only] [--host=ubuntu@HOST] [--identity=KEY]');
const raw=await fs.readFile(files[0]);
const batches=prepareImport(JSON.parse(raw.toString('utf8').replace(/^\uFEFF/,'')));
console.log(JSON.stringify({validated:true,batches:batches.length,chapters:batches.reduce((n,b)=>n+b.chapters.length,0)}));
if(!args.includes('--validate-only')){
 const host=args.find(a=>a.startsWith('--host='))?.slice(7)||'ubuntu@51.79.242.0';
 if(!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*@[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(host))throw Error('Invalid SSH host');
 const key=args.find(a=>a.startsWith('--identity='))?.slice(11)||path.join(os.homedir(),'.ssh','ovh_website_ed25519');
 const command='sudo -n python3 /srv/test1/current/infra/import-vps-runner.py'+(args.includes('--apply')?' --apply':'');
 const child=spawn('ssh',['-i',key,'-o','BatchMode=yes','-o','ConnectTimeout=15',host,command],{stdio:['pipe','inherit','inherit'],windowsHide:true});
 child.stdin.on('error',()=>{});child.stdin.end(raw);
 process.exitCode=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>resolve(code??1));});
}
