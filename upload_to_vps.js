// 保留采集 -> 本地 JSON -> 分批同步流程；不再自动加载历史密钥或旧 VPS 地址。
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
const selected=process.argv.slice(2).filter(x=>!x.startsWith('--'));
const files=selected.length?selected:fs.readdirSync('downloads').filter(x=>x.endsWith('.json')).map(x=>path.join('downloads',x));
for(const file of files){
 const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['infra/import-local.mjs',file,...process.argv.filter(x=>['--apply','--validate-only'].includes(x))],{stdio:'inherit',windowsHide:true});child.on('error',reject);child.on('exit',resolve);});
 if(code!==0){process.exitCode=1;break;}
}
