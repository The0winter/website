// Explicit, resumable upload of a selected JSON. Never discovers old secrets.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const [file]=process.argv.slice(2).filter(v=>!v.startsWith('--'));
if(!file)throw new Error('Usage: node infra/import-local.mjs FILE [--apply]');
const endpoint=process.env.IMPORT_API_URL;
if(!endpoint||!/^http:\/\/127\.0\.0\.1:\d+\/api$/.test(endpoint))throw new Error('Explicit loopback IMPORT_API_URL required');
const secret=process.env.IMPORT_SECRET;if(!secret||secret.length<32)throw new Error('IMPORT_SECRET required');
const raw=await fs.readFile(file),book=JSON.parse(raw);
if(!book.sourceUrl||!Array.isArray(book.chapters))throw new Error('No stable sourceUrl/chapters; mapping review required');
const hash=crypto.createHash('sha256').update(raw).digest('hex'),apply=process.argv.includes('--apply');
const checkpoint='.runtime/import-'+hash+'.json';let start=0;
if(apply){try{start=JSON.parse(await fs.readFile(checkpoint,'utf8')).offset;}catch(e){if(e.code!=='ENOENT')throw e;}}
for(let offset=start;offset<book.chapters.length;offset+=20){
  const body={sourceUrl:book.sourceUrl,title:book.title,author:book.author,category:book.category,chapters:book.chapters.slice(offset,offset+20),dryRun:!apply};
  let response;
  for(let attempt=0;attempt<3;attempt++){
    try {response=await fetch(endpoint+'/admin/upload-book',{method:'POST',headers:{'content-type':'application/json','x-import-secret':secret},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});if(response.status<500)break;}
    catch(e){if(attempt===2)throw e;}
    await new Promise(r=>setTimeout(r,500*2**attempt));
  }
  if(!response?.ok)throw new Error(`Import stopped at ${offset}: HTTP ${response?.status}`);
  console.log(JSON.stringify({offset,...await response.json()}));
  if(apply){await fs.mkdir('.runtime',{recursive:true});await fs.writeFile(checkpoint,JSON.stringify({hash,offset:offset+20}));}
}
