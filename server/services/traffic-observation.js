import crypto from 'node:crypto';
import {scoreTraffic,trafficRuleVersion} from './traffic-scoring.js';

const idleMs=30*60000,retentionMs=30*86400000;
const day=at=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));
export const declaredAutomation=ua=>/\b(bot|crawler|spider|headlesschrome|playwright|puppeteer|selenium|python-requests|curl|wget)\b/i.test(String(ua||'').slice(0,300));
export function trafficSigner(secret) {
  const sign=value=>crypto.createHmac('sha256',secret).update('traffic-observe-v1:'+value).digest('hex');
  return {pack:value=>value+'.'+sign(value),unpack(token){if(typeof token!=='string'||token.length>400)return null;const i=token.lastIndexOf('.'),value=token.slice(0,i),signature=token.slice(i+1);return /^[a-f0-9]{64}$/.test(signature)&&crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(sign(value)))?value:null;},hash:value=>sign('identity:'+value)};
}
export function validateTrafficEvent(input) {
  if(!input||!['open','update'].includes(input.kind)||typeof input.id!=='string'||!/^[a-f0-9-]{36}$/.test(input.id)||Object.keys(input).some(k=>!['kind','id','type','target','token','visibleMs','interactions','interactionSpan','complete'].includes(k)))throw Error('Invalid event');
  if(input.kind==='open') {
    if(!['page','chapter'].includes(input.type)||input.type==='chapter'&&!/^[a-f0-9]{24}$/.test(input.target||''))throw Error('Invalid page');
    return {kind:'open',id:input.id,type:input.type,target:input.type==='chapter'?input.target:null};
  }
  if(typeof input.token!=='string'||input.token.length>400||typeof input.complete!=='boolean'||!['visibleMs','interactions','interactionSpan'].every(k=>Number.isSafeInteger(input[k])&&input[k]>=0)||input.visibleMs>86400000||input.interactions>10000||input.interactionSpan>86400000)throw Error('Invalid observation');
  return input;
}

export function createTrafficStore(db,secret,{clock=Date.now,maxCacheEntries=256,maxCacheBytes=16*1024*1024,cacheMs=5*60000}={}) {
  const signer=trafficSigner(secret),pending=new Map(),cache=new Map();let cacheBytes=0;
  const counts={reads:0,cacheHits:0,evictions:0,conflicts:0,writes:0,failures:0};
  const raw=db.collection('traffic_observation_sessions'),summaries=db.collection('traffic_observation_summaries');
  async function serial(key,fn){if(pending.size>=1000&&!pending.has(key))throw Error('Observation busy');const prior=pending.get(key)||Promise.resolve();const work=prior.catch(()=>{}).then(fn);pending.set(key,work);try{return await work;}finally{if(pending.get(key)===work)pending.delete(key);}}
  function forget(id){const entry=cache.get(id);if(entry)cacheBytes-=entry.bytes;cache.delete(id);}
  function remember(session) {
    forget(session._id);
    // Conservative retained-object estimate, with independent entry and byte
    // caps. No timers or deferred writes; evicting a row loses no observations.
    const bytes=1024+session.pages.length*512+session.requests.length*16+session.days.length*64;
    if(maxCacheEntries<=0||bytes>maxCacheBytes)return;
    cache.set(session._id,{session:structuredClone(session),bytes,until:clock()+cacheMs});cacheBytes+=bytes;
    while(cache.size>maxCacheEntries||cacheBytes>maxCacheBytes){forget(cache.keys().next().value);counts.evictions++;}
  }
  async function load(id) {
    const now=clock();for(const [key,entry] of cache)if(entry.until<=now)forget(key);
    const entry=cache.get(id);
    if(entry){counts.cacheHits++;cache.delete(id);cache.set(id,entry);return structuredClone(entry.session);}
    counts.reads++;return raw.findOne({_id:id},{maxTimeMS:2000});
  }
  async function persistSummary(session,now) {
    const assessment=scoreTraffic(session);
    for(const date of session.days) {
      const filter={_id:session._id+':'+date,$or:[{observationRevision:{$exists:false}},{observationRevision:{$lte:session.observationRevision}}]};
      const update={$set:{visitor:session.visitor,day:date,session:session._id,startedAt:new Date(session.startedAt),updatedAt:new Date(session.lastAt),...assessment,pages:session.pageCount,completedPages:session.pages.filter(p=>p.complete).length,observationRevision:session.observationRevision},$setOnInsert:{createdAt:new Date(now)}};
      try{await summaries.updateOne(filter,update,{upsert:true,maxTimeMS:2000});}
      catch(error){
        // Another process may already have published a newer summary. An
        // _id collision must not let this older assessment replace that row.
        if(error.code!==11000)throw error;
        await summaries.updateOne(filter,update,{upsert:false,maxTimeMS:2000});
      }
    }
  }
  async function change(id,now,apply,create) {
    return serial('session:'+id,async()=>{
      try{
        for(let attempt=0;attempt<8;attempt++) {
          const previous=await load(id),session=previous||create?.();
          if(!session)throw Error('Observation expired');
          const revision=session.observationRevision,lastAt=session.lastAt;
          apply(session);
          session.lastAt=Math.max(lastAt,now);session.expiresAt=new Date(session.lastAt+retentionMs);
          session.observationRevision=(revision??0)+1;
          if(!Number.isSafeInteger(session.observationRevision))throw Error('Observation revision unavailable');
          if(previous) {
            // Cached state is a proposal, never authority. Atomic compare and
            // replace detects other processes, including live preview overlap.
            // lastAt also detects most writes from a legacy rollback process.
            const result=await raw.replaceOne({_id:id,lastAt,observationRevision:revision??{$exists:false}},session,{maxTimeMS:2000});
            if(!result.matchedCount){forget(id);counts.conflicts++;continue;}
          } else {
            try{await raw.insertOne(session,{maxTimeMS:2000});}
            catch(error){if(error.code!==11000)throw error;forget(id);counts.conflicts++;continue;}
          }
          counts.writes++;
          // A successful HTTP response always follows durable evidence and
          // summary writes. Never acknowledge an event held only in memory.
          await persistSummary(session,now);remember(session);return session;
        }
        throw Error('Observation busy');
      }catch(error){forget(id);counts.failures++;throw error;}
    });
  }
  async function accept(event,{visitorCookie,sessionCookie,userAgent}={}) {
    const now=clock(),visitorValue=signer.unpack(visitorCookie),visitor=visitorValue&&/^v:[a-f0-9]{48}$/.test(visitorValue)?visitorValue:'v:'+crypto.randomBytes(24).toString('hex'),visitorHash=signer.hash(visitor);
    if(event.kind==='update') {
      const payload=signer.unpack(event.token)?.split(':');
      if(!visitorValue||payload?.length!==4||payload[0]!=='p'||payload[2]!==visitorHash||payload[3]!==event.id)throw Error('Invalid observation token');
      await change(payload[1],now,session=>{
        if(session.visitor!==visitorHash||now-session.lastAt>idleMs||now-session.startedAt>=86400000)throw Error('Observation expired');
        const page=session.pages.find(p=>p.id===event.id);if(!page)throw Error('Observation expired');
        const elapsed=Math.max(0,now-page.at);
        page.visibleMs=Math.max(page.visibleMs,Math.min(event.visibleMs,elapsed));
        page.interactions=Math.max(page.interactions,Math.min(event.interactions,Math.floor(elapsed/1000)+1));
        page.interactionSpan=Math.max(page.interactionSpan,Math.min(event.interactionSpan,elapsed,page.visibleMs));
        page.complete=event.complete;page.verified=true;
        if(!session.days.includes(day(now)))session.days.push(day(now));
      });
      return {visitorCookie:signer.pack(visitor),sessionCookie:signer.pack('s:'+payload[1]),accepted:true};
    }
    const sid=signer.unpack(sessionCookie),proposed=sid&&/^s:[a-f0-9]{48}$/.test(sid)?sid.slice(2):null;
    return serial('visitor:'+visitorHash,async()=>{
      const apply=fresh=>{
        if(fresh.visitor!==visitorHash||now-fresh.lastAt>idleMs||now-fresh.startedAt>=86400000)throw Error('Observation expired');
        if(!fresh.pages.some(p=>p.id===event.id)) {
          fresh.requests.push(now);fresh.requests=fresh.requests.slice(-400);fresh.pageCount++;
          fresh.pages.push({id:event.id,type:event.type,target:event.target,at:now,visibleMs:0,interactions:0,interactionSpan:0,complete:false,verified:false});
          if(fresh.pages.length>120){fresh.pages.shift();fresh.truncated=true;}
        }
        fresh.automationDeclared ||= declaredAutomation(userAgent);
        if(!fresh.days.includes(day(now)))fresh.days.push(day(now));
      };
      let session;
      if(proposed)try{session=await change(proposed,now,apply);}catch(error){if(error.message!=='Observation expired')throw error;}
      if(!session){
        const id=crypto.randomBytes(24).toString('hex');
        session=await change(id,now,apply,()=>({_id:id,visitor:visitorHash,startedAt:now,lastAt:now,days:[],requests:[],pages:[],pageCount:0,automationDeclared:false}));
      }
      return {visitorCookie:signer.pack(visitor),sessionCookie:signer.pack('s:'+session._id),token:signer.pack(`p:${session._id}:${visitorHash}:${event.id}`),accepted:true};
    });
  }
  return {accept,drain:async()=>{while(pending.size)await Promise.allSettled([...pending.values()]);},snapshot:()=>({...counts,entries:cache.size,estimatedBytes:cacheBytes,pending:pending.size})};
}

// Additive, explicit deployment step. Never build indexes on the request path.
export async function prepareTrafficCollections(db,now=new Date()) {
  await db.collection('traffic_observation_sessions').createIndex({expiresAt:1},{expireAfterSeconds:0,name:'traffic_evidence_30d'});
  await db.collection('traffic_observation_summaries').createIndex({visitor:1,day:1},{name:'traffic_visitor_day'});
  await db.collection('traffic_observation_summaries').createIndex({day:1,classification:1},{name:'traffic_day_classification'});
  await db.collection('traffic_observation_meta').updateOne({_id:'observation'},{$setOnInsert:{startedAt:now,mode:'observe',ruleVersion:trafficRuleVersion}},{upsert:true});
}
