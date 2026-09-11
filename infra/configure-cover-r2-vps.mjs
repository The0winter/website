// Run locally with an untracked env file: node infra/configure-cover-r2-vps.mjs <file>
// Installs only cover settings; deployment/restart is a separate step.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import dotenv from '../server/node_modules/dotenv/lib/main.js';
import {coverConfig} from '../server/services/cover-storage.js';
if(!process.argv[2])throw Error('Provide a local cover configuration file');
const config=dotenv.parse(fs.readFileSync(process.argv[2]));
if(!coverConfig(config))throw Error('COVER_STORAGE must be r2');
const allowed=['COVER_STORAGE','COVER_R2_BUCKET','COVER_R2_ENDPOINT','COVER_R2_ACCESS_KEY_ID','COVER_R2_SECRET_ACCESS_KEY','COVER_PUBLIC_BASE_URL'];
const values=Object.fromEntries(allowed.map(key=>[key,config[key]]));
if(allowed.some(key=>typeof values[key]!=='string'||/[\s'"\\]/.test(values[key])))throw Error('Invalid configuration');
const script=`import sys,json,pathlib,os,shutil,time
p=pathlib.Path('/etc/test1/api.env')
data=json.load(sys.stdin)
allowed={'COVER_STORAGE','COVER_R2_BUCKET','COVER_R2_ENDPOINT','COVER_R2_ACCESS_KEY_ID','COVER_R2_SECRET_ACCESS_KEY','COVER_PUBLIC_BASE_URL'}
assert set(data)==allowed
assert all(isinstance(v,str) and not any(c.isspace() or c in "'\\\"\\\\" for c in v) for v in data.values())
old=p.read_text().splitlines()
existing=dict(line.split('=',1) for line in old if '=' in line and not line.startswith('#'))
assert existing.get('R2_BUCKET')!=data['COVER_R2_BUCKET'], 'Cover bucket must be separate'
backup=str(p)+'.pre-cover-'+str(time.time_ns())
shutil.copy2(p,backup);os.chmod(backup,0o600)
lines=[line for line in old if line.partition('=')[0] not in allowed]
lines += [k+'='+v for k,v in data.items()]
temp=p.with_suffix('.cover-'+str(time.time_ns()))
fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as f: f.write('\\n'.join(lines)+'\\n')
os.replace(temp,p)
print('Cover R2 configuration installed; chapter configuration preserved; credentials hidden')
`;
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const child=spawn('ssh',['-i',path.join(os.homedir(),'.ssh','ovh_website_ed25519'),'-o','BatchMode=yes','-o','ConnectTimeout=15','ubuntu@51.79.242.0','sudo -n python3 -c '+quote(script)],{stdio:['pipe','inherit','inherit'],windowsHide:true});
child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(values));
process.exitCode=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',c=>resolve(c??1));});
