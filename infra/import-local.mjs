import fs from 'node:fs/promises';
import {prepareImport} from './import-plan.mjs';
const args=process.argv.slice(2),files=args.filter(v=>!v.startsWith('--'));
if(files.length!==1||args.some(v=>v.startsWith('--')&&!['--apply','--validate-only'].includes(v)))throw Error('Usage: node infra/import-local.mjs FILE [--apply | --validate-only]');
const batches=prepareImport(JSON.parse((await fs.readFile(files[0],'utf8')).replace(/^\uFEFF/,'')));
console.log(JSON.stringify({phase:'validated',chapters:batches.reduce((n,b)=>n+b.chapters.length,0),batches:batches.length}));
if(!args.includes('--validate-only')){
 const endpoint=process.env.IMPORT_API_URL,secret=process.env.IMPORT_SECRET;
 if(!endpoint||!/^http:\/\/127\.0\.0\.1:\d+\/api$/.test(endpoint))throw Error('Explicit loopback IMPORT_API_URL required');
 if(!secret||secret.length<32)throw Error('IMPORT_SECRET required');
 async function send(batch,dryRun){
  for(let attempt=0;attempt<3;attempt++){
   let response;
   try{response=await fetch(endpoint+'/admin/upload-book',{method:'POST',headers:{'content-type':'application/json','x-import-secret':secret},body:JSON.stringify({...batch,dryRun}),signal:AbortSignal.timeout(30000)});}
   catch{if(attempt===2)throw Error('连接失败；可重新运行以核对并续传');}
   if(response?.ok)return response.json();
   if(response&&response.status<500&&response.status!==429){const data=await response.json().catch(()=>({}));throw Error(`HTTP ${response.status}: ${data.error||'导入拒绝'}`);}
   if(attempt===2)throw Error(`服务暂不可用 HTTP ${response?.status||'timeout'}；已成功批次保留，可重跑`);
   await new Promise(r=>setTimeout(r,1000*2**attempt));
  }
 }
 // Complete preflight before writing. Concurrent changes may still conflict;
 // batches are atomic and retries replay the target's idempotency checks.
 for(let i=0;i<batches.length;i++)console.log(JSON.stringify({phase:'preflight',batch:i+1,...await send(batches[i],true)}));
 if(args.includes('--apply'))for(let i=0;i<batches.length;i++)console.log(JSON.stringify({phase:'apply',batch:i+1,...await send(batches[i],false)}));
}
