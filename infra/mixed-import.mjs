// One bounded importer, targeting only the current synthetic staging instance.
import fs from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
const state=JSON.parse(await fs.readFile('.runtime/staging.json','utf8'));
if(state.env.APP_ENV!=='test'||state.env.EXTERNAL_SERVICES!=='disabled'||!/^mongodb:\/\/127\.0\.0\.1:/.test(state.uri))throw new Error('Synthetic staging required');
const seconds=Number(process.env.LOAD_SECONDS||1800);
if(!Number.isInteger(seconds)||seconds<1||seconds>3600)throw new Error('Invalid duration');
const started=performance.now(), batches=[];
const sourceUrl=`https://source.example.test/mixed-${Date.now()}`;
let number=1;
try {
  while(performance.now()-started<seconds*1000){
    const begin=performance.now();
    const body={sourceUrl,title:'混合负载合成导入',author:'合成署名',chapters:Array.from({length:20},()=>({chapter_number:number++,title:`第${number-1}章`,content:'受控导入合成正文。'.repeat(95)}))};
    const response=await fetch('http://127.0.0.1:8088/api/admin/upload-book',{method:'POST',headers:{'content-type':'application/json','x-import-secret':state.env.IMPORT_SECRET},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
    const result=await response.json();
    batches.push({offsetMs:begin-started,ms:performance.now()-begin,status:response.status,...result});
    if(!response.ok||result.inserted!==20)throw new Error(`Import batch failed: ${response.status}`);
    await new Promise(resolve=>setTimeout(resolve,Math.max(0,2500-(performance.now()-begin))));
  }
} finally {
  await fs.writeFile('artifacts/mixed-import.json',JSON.stringify({sourceUrl,seconds,elapsedMs:performance.now()-started,inserted:batches.reduce((n,b)=>n+(b.inserted||0),0),batches},null,2));
}
