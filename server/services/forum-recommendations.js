import crypto from 'node:crypto';
import mongoose from 'mongoose';
import Book from '../models/Book.js';
import Bookmark from '../models/Bookmark.js';
import ReadingHistory from '../models/ReadingHistory.js';
import {RecommendationItem as Item, RecommendationProfile as Profile, RecommendationPreference as Preference,
  RecommendationEvent as Event, RecommendationTrend as Trend, RecommendationSession as Session} from '../models/ForumRecommendation.js';
import {DAY,hash,interestProfile,rankRecommendations,excludedByPreferences,trendScore} from './forum-recommendation-ranking.js';
import {initializeRecommendations,syncForumCatalog,publicRecommendationItems} from './forum-recommendation-catalog.js';

export const recommendationVersion='balanced-v1';
export const preferenceReasons=['dislike','author','similar','extreme','quality','book','topic','followAuthor','followBook'];
const fail=(status,message,code)=>{throw Object.assign(new Error(message),{status,code});};
const id=value=>typeof value==='string'&&/^[a-f0-9]{24}$/.test(value);
const secret=()=>process.env.JWT_SECRET;
export function recommendationIdentity(req,res,userId,key) {
  let visitor=req.nativeVisitorId || req.cookies?.forum_visitor;
  if(!userId && !/^[a-f0-9]{64}$/.test(visitor||'')) {
    visitor=crypto.randomBytes(32).toString('hex');
    res.cookie('forum_visitor',visitor,{httpOnly:true,sameSite:'lax',secure:req.secure || process.env.APP_ENV==='production',maxAge:90*DAY,path:'/'});
  }
  return {actor:crypto.createHmac('sha256',key).update(userId?'user:'+userId:'guest:'+visitor).digest('hex'),userId:userId||null};
}
export function signRecommendation(value,key=secret()) {
  const data=Buffer.from(JSON.stringify(value)).toString('base64url');
  return data+'.'+crypto.createHmac('sha256',key).update(data).digest('base64url');
}
export function verifyRecommendation(token,actor,key=secret(),now=Date.now()) {
  try {
    if(typeof token!=='string'||token.length>1500)throw Error();
    const [data,signature,...rest]=token.split('.');if(rest.length || !signature)throw Error();
    const expected=crypto.createHmac('sha256',key).update(data).digest('base64url');
    if(signature.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))throw Error();
    const value=JSON.parse(Buffer.from(data,'base64url').toString());
    if(value.v!==1 || value.actor!==actor || !Number.isFinite(value.expires) || value.expires<now)throw Error();
    return value;
  } catch {fail(409,'推荐已更新，请刷新列表','FEED_EXPIRED');}
}

export async function recommendationPreferences(actor) {
  await initializeRecommendations();
  const [rows,profile]=await Promise.all([Preference.find({actor}).sort({createdAt:-1}).limit(200).lean(),Profile.findById(actor).lean()]);
  return {rows:rows.map(({_id,actor:owner,createdAt,...row})=>({id:_id,...row})),
    enabled:profile?.enabled!==false,exploration:profile?.exploration||'balanced',resetAt:profile?.resetAt||null};
}

export async function saveRecommendationPreference(actor,entry,reason) {
  if(!id(entry)||!preferenceReasons.includes(reason))fail(400,'推荐偏好参数无效');
  const [row]=await publicRecommendationItems([entry]);if(!row)fail(404,'内容不存在或不可见');
  if(['book','followBook'].includes(reason)&&!row.book)fail(400,'该内容未关联书籍');
  const scope=reason==='author'||reason==='followAuthor'?row.author:reason==='book'||reason==='followBook'?row.book:
    reason==='topic'?row.topic:reason==='similar'?row.post:entry;
  const key=hash(actor+'\0'+reason+'\0'+scope);
  if(!await Preference.exists({_id:key})&&await Preference.countDocuments({actor})>=200)fail(400,'偏好已达上限，请先移除不需要的偏好');
  await Preference.updateOne({_id:key},{$set:{actor,entry,question:row.post,book:row.book,topic:row.topic,
    author:row.author,authorName:row.authorName,title:row.item.title,text:row.fingerprint,reason,createdAt:new Date()}},{upsert:true});
  return recommendationPreferences(actor);
}

async function history(identity,profile,events) {
  let books=[];
  if(identity.userId && profile.enabled!==false) {
    const [shelf,reading]=await Promise.all([
      Bookmark.find({user_id:identity.userId,...(profile.resetAt?{created_at:{$gt:profile.resetAt}}:{})}).sort({created_at:-1}).limit(60).select('bookId').lean(),
      ReadingHistory.find({userId:identity.userId,lastReadAt:{$gt:new Date(Math.max(Date.now()-90*DAY,+new Date(profile.resetAt||0)))}}).sort({lastReadAt:-1}).limit(40).select('bookId').lean(),
    ]);
    books=await Book.find({_id:{$in:[...new Set([...shelf,...reading].map(row=>String(row.bookId)))]},deletedAt:null,visibility:{$ne:'private'}})
      .select('title category author description').lean();
  }
  return {events,books};
}

const candidateFeatures='_id post book author topic topics fingerprint nearSignature length quality publishedAt';
function publicCandidates(seed) {
  const bucket=parseInt(hash(seed).slice(0,4),16)%16;
  // Rank compact features; fetch display metadata only for the delivered page.
  return Promise.all([
    Item.find({}).sort({createdAt:-1,_id:1}).limit(150).batchSize(150).select(candidateFeatures).lean(),
    Item.find({}).sort({quality:-1,_id:1}).limit(180).batchSize(180).select(candidateFeatures).lean(),
    Item.find({bucket:{$in:Array.from({length:4},(_,i)=>(bucket+i)%16)}}).sort({quality:-1,_id:1}).limit(180).batchSize(180).select(candidateFeatures).lean(),
    Trend.find({at:{$gte:new Date(Date.now()-7*DAY)}}).sort({heat24:-1}).limit(150).batchSize(150).lean(),
  ]);
}
async function candidates(interests,preferences,publicRows) {
  const [recent,quality,discovery,trending]=publicRows;
  const personalFilters=[
    ['book',[...interests.books.keys(),...preferences.filter(p=>p.reason==='followBook').map(p=>p.book)]],
    ['topic',[...interests.topics.keys()]],
    ['author',[...interests.authors.keys(),...preferences.filter(p=>p.reason==='followAuthor').map(p=>p.author)]],
  ].filter(([,values])=>values.length).map(([field,values])=>({[field]:{$in:values}}));
  const [personal,hot]=await Promise.all([
    personalFilters.length?Item.find({$or:personalFilters})
      .sort({quality:-1,_id:1}).limit(180).batchSize(180).select(candidateFeatures).lean():[],
    trending.length?Item.find({_id:{$in:trending.map(row=>row._id)}}).batchSize(150).select(candidateFeatures).lean():[],
  ]);
  const rows=[...new Map([...recent,...quality,...discovery,...hot,...personal].map(row=>[row._id,row])).values()];
  return rows;
}

export async function personalizedForumFeed({identity,tab='recommend',limit=20,cursor,key,now=Date.now()}) {
  await initializeRecommendations();
  const seed=cursor?null:crypto.randomUUID();
  // Independent public retrieval, preference and behavior queries overlap even
  // when the database is far from the API server. Permissions stay uncached.
  const [preferences,initialEvents,publicRows]=await Promise.all([
    recommendationPreferences(identity.actor),
    cursor?null:Event.find({actor:identity.actor,at:{$gte:new Date(now-90*DAY)}}).sort({at:-1}).limit(1200).lean(),
    cursor || tab==='follow'?null:publicCandidates(seed),
  ]);
  if(!cursor && tab==='follow' && !preferences.rows.some(row=>row.reason==='followBook'||row.reason==='followAuthor'))
    return {items:[],nextCursor:null,algorithm:recommendationVersion};
  let session,offset=0,tail=[],createSession=false;
  if(cursor) {
    const parsed=verifyRecommendation(cursor,identity.actor,key,now);
    if(parsed.kind!=='cursor'||parsed.tab!==tab||!Number.isSafeInteger(parsed.offset)||parsed.offset<0)fail(400,'分页游标无效');
    session=await Session.findOne({_id:parsed.session,actor:identity.actor,tab,expiresAt:{$gt:new Date(now)}}).lean();
    if(!session || parsed.offset>session.entries.length)fail(409,'推荐已更新，请刷新列表','FEED_EXPIRED');
    offset=parsed.offset;
    if(!Array.isArray(parsed.tail)||parsed.tail.length>19||parsed.tail.some(value=>!id(value)))fail(400,'分页游标无效');
    tail=parsed.tail;
  } else {
    const {events,books}=await history(identity,preferences,initialEvents);
    const interests=interestProfile(events,books,preferences.rows,preferences,now);
    let rows=await candidates(interests,preferences.rows,publicRows||await publicCandidates(seed));
    if(!rows.length){await syncForumCatalog({batches:4});rows=await candidates(interests,preferences.rows,await publicCandidates(seed));}
    // Interest learning is bounded, but the read/exposure exclusion must cover
    // every candidate for the full cooldown even for very active readers.
    const [trendRows,exposures]=await Promise.all([
      Trend.find({_id:{$in:rows.map(row=>row._id)}}).lean(),
      tab==='recommend' && rows.length?Event.find({actor:identity.actor,
        entry:{$in:rows.map(row=>row._id)},at:{$gte:new Date(now-30*DAY)}})
        .select('entry read impression day at').limit(rows.length*32).lean():events,
    ]);
    const ranked=rankRecommendations(rows,{interests,preferences:preferences.rows,events:exposures,trends:new Map(trendRows.map(row=>[row._id,row])),
      tab,seed,now,exploration:preferences.exploration});
    session={_id:seed,actor:identity.actor,tab,entries:ranked.map(row=>row._id),reasons:ranked.map(row=>row.reason),createdAt:new Date(now),expiresAt:new Date(now+6*3600000)};
    createSession=true;
  }
  const deliver=async()=>{
  const result=[];
  const previous=tail.length?await Item.find({_id:{$in:tail}}).select('post').lean():[];
  const recentQuestions=tail.map(entry=>previous.find(row=>row._id===entry)?.post||'');
  // Revalidate all returned records; cached permissions and newly blocked entries
  // must not leak through a previously created session.
  while(offset<session.entries.length && result.length<limit) {
    const batch=session.entries.slice(offset,offset+Math.min(30,limit-result.length));
    const rows=await publicRecommendationItems(batch),byId=new Map(rows.map(row=>[row._id,row]));
    const trends=tab==='hot'?new Map((await Trend.find({_id:{$in:batch}}).lean()).map(row=>[row._id,row])):new Map();
    for(const entry of batch) {
      const row=byId.get(entry),reason=session.reasons[offset++];
      if(!row || excludedByPreferences(row,preferences.rows) || recentQuestions.includes(row.post))continue;
      if(tab==='follow' && !preferences.rows.some(pref=>pref.reason==='followBook'&&pref.book===row.book || pref.reason==='followAuthor'&&pref.author===row.author))continue;
      const ticket=signRecommendation({v:1,kind:'feed',actor:identity.actor,entry,issued:now,expires:now+6*3600000},key);
      result.push({...row.item,recommendation:{reason,topic:row.topic,author:row.author,token:ticket,
        ...(tab==='hot'?{heat:Math.round(trendScore(trends.get(entry),now)*100)}:{})}});
      tail.push(entry);recentQuestions.push(row.post);if(tail.length>19){tail.shift();recentQuestions.shift();}
    }
  }
  return {items:result,nextCursor:offset<session.entries.length?signRecommendation({v:1,kind:'cursor',actor:identity.actor,
    session:session._id,tab,offset,tail,expires:+new Date(session.expiresAt)},key):null,algorithm:recommendationVersion};
  };
  if(createSession){const [,feed]=await Promise.all([Session.create(session),deliver()]);return feed;}
  return deliver();
}

export async function recommendationReadReceipt(actor,entry,key,now=Date.now()) {
  if(!id(entry))fail(400,'内容ID无效');
  await initializeRecommendations();
  const [row]=await publicRecommendationItems([entry]);if(!row)fail(404,'内容不存在或不可见');
  const minReadMs=Math.min(45000,Math.max(12000,row.length*8));
  return {minReadMs,token:signRecommendation({v:1,kind:'read',actor,entry,issued:now,minReadMs,expires:now+6*3600000},key)};
}

export async function recordRecommendationEvent(identity,entry,event,{now=Date.now(),row}={}) {
  if(!['impression','read','like','comment'].includes(event)||!id(entry))fail(400,'阅读行为无效');
  row ||= (await publicRecommendationItems([entry]))[0];if(!row)return false;
  const day=new Date(now).toISOString().slice(0,10),eventId=hash(identity.actor+'\0'+entry+'\0'+day);
  let recorded=false;
  await mongoose.connection.transaction(async session=>{
    recorded=false;
    const previous=await Event.findById(eventId).session(session).lean();
    if(previous?.[event])return;
    const trend=await Trend.findById(entry).session(session).lean();
    const age=trend?.at?Math.max(0,now-+trend.at)/DAY:0;
    // Unique actor/entry/day for each action. Imported counters, prefetches and
    // historical likes are never treated as fresh interactions.
    const weight=({impression:0,read:1,like:3,comment:.5}[event])*(identity.userId?1:.35);
    await Event.updateOne({_id:eventId},{$set:{actor:identity.actor,entry,day,book:row.book,author:row.author,topic:row.topic,
      topics:row.topics,[event]:true,at:new Date(now),expiresAt:new Date(now+90*DAY)}},{upsert:true,session});
    await Trend.updateOne({_id:entry},{$set:{heat24:(trend?.heat24||0)*2**(-age)+weight,
      heat7:(trend?.heat7||0)*2**(-age/7)+weight,at:new Date(now),expiresAt:new Date(now+30*DAY)},
      $inc:{exposures:event==='impression'?1:0,reads:event==='read'?1:0,likes:event==='like'?1:0}},{upsert:true,session});
    recorded=true;
  });
  return recorded;
}

export async function acceptRecommendationEvents(identity,events,key,now=Date.now()) {
  if(!Array.isArray(events)||!events.length||events.length>20)fail(400,'阅读记录批次无效');
  // Validate the entire batch before accepting any event.
  const verified=events.map(event=>{
    const ticket=verifyRecommendation(event.token,identity.actor,key,now);
    if(!id(ticket.entry)||!Number.isFinite(ticket.issued)||ticket.issued>now||
      !['impression','read'].includes(event.type)||event.type==='impression' && (ticket.kind!=='feed'||now-ticket.issued<900)||
      event.type==='read' && (ticket.kind!=='read'||now-ticket.issued<ticket.minReadMs||
        !Number.isFinite(event.activeMs)||event.activeMs<ticket.minReadMs||event.activeMs>now-ticket.issued+1500||
        !Number.isFinite(event.depth)||event.depth<.1||event.depth>1))fail(400,'阅读记录未达到有效条件');
    return {entry:ticket.entry,type:event.type};
  });
  const rows=new Map((await publicRecommendationItems(verified.map(row=>row.entry))).map(row=>[row._id,row]));
  let recorded=0;
  for(const event of verified)if(rows.has(event.entry)&&await recordRecommendationEvent(identity,event.entry,event.type,{row:rows.get(event.entry),now}))recorded++;
  return {recorded};
}

export async function updateRecommendationSettings(actor,value) {
  if(value.action==='reset')await Profile.updateOne({_id:actor},{$set:{resetAt:new Date()}},{upsert:true});
  else {
    if(value.enabled!==undefined&&typeof value.enabled!=='boolean' || value.exploration!==undefined&&!['balanced','more'].includes(value.exploration))fail(400,'推荐设置无效');
    const update={...(value.enabled!==undefined?{enabled:value.enabled}:{}),...(value.exploration!==undefined?{exploration:value.exploration}:{})};
    if(!Object.keys(update).length)fail(400,'推荐设置为空');
    await Profile.updateOne({_id:actor},{$set:update},{upsert:true});
  }
  return recommendationPreferences(actor);
}

export async function removeRecommendationPreference(actor,key) {
  if(typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key))fail(400,'推荐偏好ID无效');
  await Preference.deleteOne({_id:key,actor});return recommendationPreferences(actor);
}
