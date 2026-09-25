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

export function createTrafficStore(db,secret,{clock=Date.now}={}) {
  const signer=trafficSigner(secret),pending=new Map();
  const raw=db.collection('traffic_observation_sessions'),summaries=db.collection('traffic_observation_summaries');
  async function serial(key,fn){if(pending.size>=1000&&!pending.has(key))throw Error('Observation busy');const prior=pending.get(key)||Promise.resolve();const work=prior.catch(()=>{}).then(fn);pending.set(key,work);try{return await work;}finally{if(pending.get(key)===work)pending.delete(key);}}
  async function persist(session,now) {
    const assessment=scoreTraffic(session);
    // Persist the evidence before its materialized summary; retries are idempotent.
    session.lastAt=now;session.expiresAt=new Date(now+retentionMs);
    await raw.replaceOne({_id:session._id},session,{upsert:true,maxTimeMS:2000});
    for(const date of session.days)await summaries.updateOne({_id:session._id+':'+date},{$set:{visitor:session.visitor,day:date,session:session._id,startedAt:new Date(session.startedAt),updatedAt:new Date(now),...assessment,pages:session.pageCount,completedPages:session.pages.filter(p=>p.complete).length},$setOnInsert:{createdAt:new Date(now)}},{upsert:true,maxTimeMS:2000});
    return assessment;
  }
  async function accept(event,{visitorCookie,sessionCookie,userAgent}={}) {
    const now=clock(),visitorValue=signer.unpack(visitorCookie),visitor=visitorValue&&/^v:[a-f0-9]{48}$/.test(visitorValue)?visitorValue:'v:'+crypto.randomBytes(24).toString('hex'),visitorHash=signer.hash(visitor);
    if(event.kind==='update') {
      const payload=signer.unpack(event.token)?.split(':');
      if(!visitorValue||payload?.length!==4||payload[0]!=='p'||payload[2]!==visitorHash||payload[3]!==event.id)throw Error('Invalid observation token');
      return serial(payload[1],async()=>{
        const session=await raw.findOne({_id:payload[1]},{maxTimeMS:2000});
        if(!session||session.visitor!==visitorHash||now-session.lastAt>idleMs||now-session.startedAt>=86400000)throw Error('Observation expired');
        const page=session.pages.find(p=>p.id===event.id);if(!page)throw Error('Observation expired');
        const elapsed=Math.max(0,now-page.at);
        page.visibleMs=Math.max(page.visibleMs,Math.min(event.visibleMs,elapsed));
        page.interactions=Math.max(page.interactions,Math.min(event.interactions,Math.floor(elapsed/1000)+1));
        page.interactionSpan=Math.max(page.interactionSpan,Math.min(event.interactionSpan,elapsed,page.visibleMs));
        page.complete=event.complete;page.verified=true;
        if(!session.days.includes(day(now)))session.days.push(day(now));
        await persist(session,now);return {visitorCookie:signer.pack(visitor),sessionCookie:signer.pack('s:'+session._id),accepted:true};
      });
    }
    const sid=signer.unpack(sessionCookie),proposed=sid&&/^s:[a-f0-9]{48}$/.test(sid)?sid.slice(2):null;
    return serial(visitorHash,async()=>{
      const existing=proposed?await raw.findOne({_id:proposed},{maxTimeMS:2000}):null;
      const session=existing&&existing.visitor===visitorHash&&now-existing.lastAt<=idleMs&&now-existing.startedAt<86400000?existing:{_id:crypto.randomBytes(24).toString('hex'),visitor:visitorHash,startedAt:now,lastAt:now,days:[],requests:[],pages:[],pageCount:0,automationDeclared:false};
      // Serialize open and update against the same session document, including parallel tabs.
      return serial(session._id,async()=>{
        const fresh=existing&&session===existing?await raw.findOne({_id:session._id},{maxTimeMS:2000}):session;
        if(!fresh.pages.some(p=>p.id===event.id)) {
          fresh.requests.push(now);fresh.requests=fresh.requests.slice(-400);fresh.pageCount++;
          fresh.pages.push({id:event.id,type:event.type,target:event.target,at:now,visibleMs:0,interactions:0,interactionSpan:0,complete:false,verified:false});
          if(fresh.pages.length>120){fresh.pages.shift();fresh.truncated=true;}
        }
        fresh.automationDeclared ||= declaredAutomation(userAgent);
        if(!fresh.days.includes(day(now)))fresh.days.push(day(now));
        await persist(fresh,now);
        return {visitorCookie:signer.pack(visitor),sessionCookie:signer.pack('s:'+fresh._id),token:signer.pack(`p:${fresh._id}:${visitorHash}:${event.id}`),accepted:true};
      });
    });
  }
  return {accept,drain:()=>Promise.allSettled([...pending.values()])};
}

// Additive, explicit deployment step. Never build indexes on the request path.
export async function prepareTrafficCollections(db,now=new Date()) {
  await db.collection('traffic_observation_sessions').createIndex({expiresAt:1},{expireAfterSeconds:0,name:'traffic_evidence_30d'});
  await db.collection('traffic_observation_summaries').createIndex({visitor:1,day:1},{name:'traffic_visitor_day'});
  await db.collection('traffic_observation_summaries').createIndex({day:1,classification:1},{name:'traffic_day_classification'});
  await db.collection('traffic_observation_meta').updateOne({_id:'observation'},{$setOnInsert:{startedAt:now,mode:'observe',ruleVersion:trafficRuleVersion}},{upsert:true});
}
