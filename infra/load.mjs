import fs from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
const state=JSON.parse(await fs.readFile('.runtime/staging.json','utf8'));
const seconds=Number(process.env.LOAD_SECONDS||1800),rps=Number(process.env.LOAD_RPS||20);
const label=process.env.LOAD_LABEL||'baseline';
if(!Number.isSafeInteger(seconds)||seconds<1||seconds>3600||!Number.isFinite(rps)||rps<1||rps>100)throw new Error('Invalid bounded load');
const paths=[...Array(6).fill(`/api/chapters/${state.chapterId}`),...Array(2).fill(`/book/${state.bookId}/${state.chapterId}`),'/api/books?q=合成&limit=20',`/api/books/${state.bookId}/chapters?limit=100`];
const samples=[],pending=new Set();let skipped=0;
const started=performance.now();
for(let i=0;i<seconds*rps;i++){
  const due=started+i*1000/rps;const wait=due-performance.now();if(wait>0)await new Promise(r=>setTimeout(r,wait));
  if(pending.size>=200){skipped++;continue;}
  const kind=i%10<6?'body':i%10<8?'ssr':'list';
  const request=(async()=>{const begin=performance.now();try{const response=await fetch('http://127.0.0.1:8088'+paths[i%10],{signal:AbortSignal.timeout(15000)});const ttfb=performance.now()-begin;await response.arrayBuffer();samples.push({kind,status:response.status,ttfb,ms:performance.now()-begin});}catch{samples.push({kind,status:0,ms:performance.now()-begin,ttfb:15000});}})();
  pending.add(request);request.finally(()=>pending.delete(request));
  if(i&&i%(rps*60)===0)console.log(JSON.stringify({minute:Math.round(i/rps/60),completed:samples.length,pending:pending.size}));
}
await Promise.all(pending);
const percentile=(a,p)=>a.sort((x,y)=>x-y)[Math.floor((a.length-1)*p)]||0;
const summary={label,seconds,rps,elapsedMs:performance.now()-started,requests:samples.length,skipped,status:Object.fromEntries([...new Set(samples.map(s=>s.status))].map(code=>[code,samples.filter(s=>s.status===code).length])),byKind:Object.fromEntries(['body','ssr','list'].map(kind=>{const a=samples.filter(s=>s.kind===kind);return[kind,{count:a.length,p95:percentile(a.map(s=>kind==='ssr'?s.ttfb:s.ms),.95),p99:percentile(a.map(s=>s.ms),.99)}];}))};
await fs.writeFile(`artifacts/load-${label}.json`,JSON.stringify({summary,samples},null,2));console.log(JSON.stringify(summary,null,2));
if(skipped||samples.some(s=>s.status===0||s.status>=500))process.exitCode=1;
