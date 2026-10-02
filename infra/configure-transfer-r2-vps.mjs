// Takes a local, Git-ignored env file. Values travel over SSH stdin, never logs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import dotenv from '../server/node_modules/dotenv/lib/main.js';
const names=['TRANSFER_R2_BUCKET','TRANSFER_R2_ENDPOINT','TRANSFER_R2_ACCESS_KEY_ID','TRANSFER_R2_SECRET_ACCESS_KEY'];
if(!process.argv[2])throw Error('Provide the local private submission bucket env file');
const values=dotenv.parse(fs.readFileSync(process.argv[2]));
if(names.some(k=>!values[k]||/[\s'"\\]/.test(values[k]))||Object.keys(values).some(k=>!names.includes(k)))throw Error('Invalid transfer configuration fields');
if(!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(values.TRANSFER_R2_BUCKET)||!/^https:\/\/[a-f0-9]{32}(?:\.(?:eu|us))?\.r2\.cloudflarestorage\.com\/?$/.test(values.TRANSFER_R2_ENDPOINT))throw Error('Invalid R2 bucket or endpoint');
const script=`import sys,json,pathlib,os,shutil,time
p=pathlib.Path('/etc/test1/api.env')
values=json.load(sys.stdin)
allowed={'TRANSFER_R2_BUCKET','TRANSFER_R2_ENDPOINT','TRANSFER_R2_ACCESS_KEY_ID','TRANSFER_R2_SECRET_ACCESS_KEY'}
assert set(values)==allowed
assert all(isinstance(v,str) and not any(c.isspace() or c in "'\\\"\\\\" for c in v) for v in values.values())
old=p.read_text().splitlines()
existing=dict(line.split('=',1) for line in old if '=' in line and not line.startswith('#'))
assert values['TRANSFER_R2_BUCKET'] not in [existing.get('R2_BUCKET'),existing.get('COVER_R2_BUCKET')]
backup=str(p)+'.pre-transfer-'+str(time.time_ns());shutil.copy2(p,backup);os.chmod(backup,0o600)
temp=p.with_suffix('.transfer-'+str(time.time_ns()))
fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as f:f.write('\\n'.join([line for line in old if line.partition('=')[0] not in allowed]+[k+'='+v for k,v in values.items()])+'\\n')
os.replace(temp,p)
print('Private submission configuration installed; existing configuration preserved; restart required')
`;
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const child=spawn('ssh',['-i',path.join(os.homedir(),'.ssh','ovh_website_ed25519'),'-o','BatchMode=yes','-o','ConnectTimeout=15','ubuntu@51.79.242.0','sudo -n python3 -c '+quote(script)],{windowsHide:true,stdio:['pipe','inherit','inherit']});
child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(values));
process.exitCode=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',c=>resolve(c??1));});
