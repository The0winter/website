export const trafficRuleVersion='observe-2026-09-25-v1';
const median=values=>{const sorted=[...values].sort((a,b)=>a-b);return sorted.length?sorted[Math.floor(sorted.length/2)]:Infinity;};

// This is an observation score, never an authentication or access-control decision.
export function scoreTraffic(session) {
  const pages=session.pages||[],requests=session.requests||[],signals=[];
  const add=(key,points)=>signals.push({key,points});
  const minutes=new Map();for(const at of requests){const m=Math.floor(at/60000);minutes.set(m,(minutes.get(m)||0)+1);}
  const burst=[...minutes].some(([m,n])=>n>60&&(minutes.get(m+1)||0)>60&&(minutes.get(m+2)||0)>60);
  const chapters=pages.filter(p=>p.type==='chapter');
  let fastChapters=false;
  for(let i=0;i<chapters.length;i++) {
    const window=chapters.slice(i).filter(p=>p.at-chapters[i].at<=120000);
    if(new Set(window.map(p=>p.target)).size>=20&&median(window.slice(1).map((p,j)=>p.at-window[j].at))<2000){fastChapters=true;break;}
  }
  if(burst||fastChapters)add('speed',40);
  const gaps=requests.slice(1).map((at,i)=>at-requests[i]);
  if(gaps.length>=30){const mean=gaps.reduce((a,b)=>a+b,0)/gaps.length,cv=mean>0?Math.sqrt(gaps.reduce((n,g)=>n+(g-mean)**2,0)/gaps.length)/mean:Infinity;if(median(gaps)<=5000&&cv<.1)add('regular',25);}
  const completed=pages.filter(p=>p.complete&&p.verified);
  if(completed.length>=10&&completed.filter(p=>p.visibleMs<3000&&p.interactions===0).length/completed.length>=.9)add('noInteraction',20);
  else if(completed.length&&completed.every(p=>p.visibleMs<3000&&p.interactions===0))add('short',10);
  if(session.automationDeclared)add('declaration',60);
  const reading=chapters.filter(p=>p.visibleMs>=30000&&p.interactions>=2&&p.interactionSpan>=20000);
  // Self-reported reading cannot erase a server-observed sustained speed anomaly.
  if(new Set(reading.map(p=>p.target)).size>=2&&!burst&&!fastChapters)add('reading',-30);
  const score=Math.max(0,Math.min(100,signals.reduce((n,s)=>n+s.points,0)));
  const groups=signals.filter(s=>s.points>0).length;
  const high=score>=70&&groups>=2;
  return {version:trafficRuleVersion,score,classification:high?'high':score>=30?'watch':completed.length?'retained':'insufficient',signals:signals.map(s=>s.key),coverage:session.truncated?'bounded':completed.length?'observed':'incomplete'};
}
