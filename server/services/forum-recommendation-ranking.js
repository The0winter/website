import crypto from 'node:crypto';
import {forumFeedItem} from './forum-feed.js';

export const DAY = 86400000;
export const normalizeForumText = value => String(value || '').replace(/<[^>]*>/g, ' ').replace(/&[\w#]+;/g, ' ').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function nearSignature(text) {
  const votes=new Int32Array(64),grams=new Set();
  for(let i=0;i<Math.min(text.length-2,8000);i+=2)grams.add(text.slice(i,i+3));
  for(const gram of grams){const digest=crypto.createHash('sha256').update(gram).digest();for(let i=0;i<64;i++)votes[i]+=(digest[i>>3]>>(i%8))&1?1:-1;}
  return Array.from({length:16},(_,n)=>[0,1,2,3].reduce((sum,k)=>sum+(votes[n*4+k]>=0?1<<k:0),0).toString(16)).join('');
}
export function nearDuplicate(left,right) {
  if(!left.nearSignature || !right.nearSignature || left.length<200 || right.length<200 ||
    !(left.book && left.book===right.book) || Math.min(left.length,right.length)/Math.max(left.length,right.length)<.95)return false;
  let distance=0;
  for(let i=0;i<16;i++){let bits=parseInt(left.nearSignature[i],16)^parseInt(right.nearSignature[i],16);while(bits){distance++;bits&=bits-1;}if(distance>2)return false;}
  return true;
}
const ignored = new Set(['读后感','含剧透','书评','小说','文学','未分类','其他','其他小说']);
const themes = {
  科幻:['科幻','宇宙','外星','人工智能','太空','机器人','星际'],
  推理悬疑:['推理','悬疑','侦探','案件','凶手','犯罪','刑侦'],
  历史:['历史','朝代','王朝','史料','明朝','清朝','宋朝','唐朝','战争'],
  奇幻仙侠:['奇幻','玄幻','仙侠','修仙','魔法','修真','异世界'],
  现实社会:['现实','社会','阶级','制度','底层','劳动','乡村','人性'],
  人物成长:['成长','青春','童年','教育','自我','人生'],
  情感关系:['爱情','情感','婚姻','家庭','亲情','友情'],
  文学写作:['写作','叙事','文笔','文学','结构','视角','语言'],
  哲学思想:['哲学','思想','存在主义','伦理','信仰'],
  游戏竞技:['游戏','竞技','电竞','体育','足球','篮球'],
  幽默日常:['幽默','喜剧','日常','治愈','美食'],
};

export function contentTopics(post, book, text = '') {
  const category = String(book?.category || '').trim();
  const tags = (post.tags || []).filter(tag => typeof tag === 'string' && !ignored.has(tag) && tag !== book?.title).slice(0,8);
  const sample = `${post.title} ${category} ${tags.join(' ')} ${book?.description || ''} ${text.slice(0,5000)}`;
  const scored = Object.entries(themes).map(([topic, words]) => ({topic,
    score:words.reduce((sum, word) => sum + (sample.includes(word) ? 1 : 0) + (category.includes(word) ? 4 : 0),0)}))
    .filter(row => row.score > 0).sort((a,b) => b.score-a.score);
  const topics = [...new Set([...scored.slice(0,3).map(row=>row.topic), ...tags.slice(0,2),
    ...(!ignored.has(category) && category ? [category] : [])])].slice(0,6);
  return topics.length ? topics : ['阅读讨论'];
}

export function originalAuthor(post, reply) {
  const name = reply?.source?.author || reply?.author?.username || post.author?.username || '书友';
  let host = '';
  try {host = new URL(reply?.source?.url).hostname;} catch { /* Native author. */ }
  return {name, key:reply?.source ? `source:${host}:${name}` : `user:${reply?.author?._id || post.author?._id || ''}`};
}

export function makeRecommendationItem(post, reply, book, now = Date.now()) {
  const body = String(reply?.content ?? post.content ?? '');
  const text = normalizeForumText(body), author = originalAuthor(post,reply);
  const topics = contentTopics(post,book,text);
  const id = String(reply?._id || post._id), item = forumFeedItem(post,reply,true);
  item.bookTitle = book?.title;
  const category = String(book?.category || '').trim();
  const sourceTime = reply?.source?.publishedAt;
  const publishedAt = new Date(sourceTime || reply?.createdAt || post.createdAt || now);
  return {_id:id, post:String(post._id), book:String(post.bookId || ''), kind:reply?'answer':post.type,
    author:author.key, authorName:author.name, bookAuthor:book?.author || '',
    topic:topics[0], topics, terms:[...new Set([...topics, category, book?.author].filter(Boolean))],
    fingerprint:hash(text), nearSignature:nearSignature(text), bucket:parseInt(hash(String(post.bookId || post._id)).slice(0,4),16)%16,
    length:text.length, quality:Math.min(.95,.4 + Math.min(.3,Math.log1p(text.length)/30) + (reply?.source?.kind==='guide'?0:.1) + (text.length>=80?.1:0)),
    createdAt:new Date(reply?.createdAt || post.createdAt || now), publishedAt:Number.isFinite(+publishedAt)?publishedAt:new Date(now),
    sourceUpdatedAt:new Date(reply?.updatedAt || post.updatedAt || now), indexedAt:new Date(now), item};
}

export function trendScore(trend, now = Date.now()) {
  if (!trend?.at) return 0;
  const age = Math.max(0,now-+new Date(trend.at))/DAY;
  const heat = (trend.heat24 || 0)*2**(-age) + .2*(trend.heat7 || 0)*2**(-age/7);
  return Math.log1p(Math.max(0,heat));
}

export function excludedByPreferences(row, preferences) {
  return preferences.some(pref => {
    if (pref.reason.startsWith('follow')) return false;
    return pref.entry===row._id || pref.reason==='author' && pref.author===row.author ||
      pref.reason==='book' && pref.book && pref.book===row.book ||
      pref.reason==='topic' && pref.topic && row.topics.includes(pref.topic) ||
      pref.reason==='similar' && (pref.question===row.post || pref.text===row.fingerprint);
  });
}

export function interestProfile(events, books, preferences, profile = {}, now = Date.now()) {
  const interests = {books:new Map(),topics:new Map(),authors:new Map()};
  const add = (map,key,weight) => {if(key)map.set(key,Math.min(8,(map.get(key)||0)+weight));};
  if (profile.enabled === false) return interests;
  for (const book of books) {
    add(interests.books,String(book._id),2);
    for(const topic of contentTopics({title:book.title,tags:[]},book))add(interests.topics,topic,.8);
  }
  for (const event of events) {
    if (profile.resetAt && +new Date(event.at)<=+new Date(profile.resetAt)) continue;
    const age = Math.max(0,now-+new Date(event.at))/DAY;
    // Daily deduplication, saturation and two time scales prevent one click or a
    // marathon on one book from rewriting the whole profile. Comments are neutral.
    const strength = (event.read ? 1 : 0)+(event.like ? 2 : 0);
    const weight = strength*(.65*2**(-age/7)+.35*2**(-age/45));
    add(interests.books,event.book,weight);
    for (const topic of event.topics || [event.topic])add(interests.topics,topic,weight/Math.max(1,(event.topics||[]).length));
    add(interests.authors,event.author,weight*.35);
  }
  for (const pref of preferences) {
    if(pref.reason==='followBook')add(interests.books,pref.book,5);
    if(pref.reason==='followAuthor')add(interests.authors,pref.author,5);
  }
  return interests;
}

const schedule = ['interest','hot','interest','adjacent','new','interest','hot','interest','adjacent','interest',
  'hot','interest','new','interest','hot','adjacent','interest','hot','interest','interest'];
const neighbors = {科幻:['哲学思想','推理悬疑','奇幻仙侠'],推理悬疑:['历史','现实社会','科幻'],历史:['现实社会','哲学思想','文学写作'],
  奇幻仙侠:['科幻','人物成长','游戏竞技'],现实社会:['历史','情感关系','哲学思想'],人物成长:['情感关系','幽默日常','现实社会'],
  情感关系:['人物成长','现实社会','文学写作'],文学写作:['哲学思想','历史','人物成长'],哲学思想:['科幻','现实社会','文学写作'],
  游戏竞技:['奇幻仙侠','人物成长','幽默日常'],幽默日常:['情感关系','人物成长','游戏竞技']};

export function rankRecommendations(candidates, {interests, preferences = [], events = [], trends = new Map(),
  tab = 'recommend', seed = '', now = Date.now(), exploration = 'balanced', limit = 240} = {}) {
  interests ||= {books:new Map(),topics:new Map(),authors:new Map()};
  const recent = new Map();
  for (const event of events) {
    const state = recent.get(event.entry) || {seen:new Set(),lastSeen:0,lastRead:0};
    if (event.impression) {state.lastSeen=Math.max(state.lastSeen,+new Date(event.at));if(now-+new Date(event.at)<7*DAY)state.seen.add(event.day);}
    if(event.read)state.lastRead=Math.max(state.lastRead,+new Date(event.at));
    recent.set(event.entry,state);
  }
  const related = new Set([...interests.topics.keys()].flatMap(topic=>neighbors[topic]||[]));
  // Candidate groups are fixed before scoring. Reuse their Jaccard overlap and
  // count each rolling window once instead of rebuilding sets for every pair.
  const topicGroups=new Map(),similarities=new Map();
  const groupFor=topics=>{
    const key=JSON.stringify([...topics].sort());
    if(!topicGroups.has(key))topicGroups.set(key,{id:topicGroups.size,topics:new Set(topics)});
    return topicGroups.get(key);
  };
  const topicSimilarity=(left,right)=>{
    const key=Math.min(left.id,right.id)*topicGroups.size+Math.max(left.id,right.id);
    if(!similarities.has(key)) {
      let common=0;for(const topic of left.topics)if(right.topics.has(topic))common++;
      similarities.set(key,common/Math.max(1,left.topics.size+right.topics.size-common));
    }
    return similarities.get(key);
  };
  const pool = candidates.filter(row => row.length>0 && !excludedByPreferences(row,preferences) &&
    (tab!=='follow' || preferences.some(p=>p.reason==='followBook'&&p.book===row.book || p.reason==='followAuthor'&&p.author===row.author)))
    .filter(row => {const state=recent.get(row._id);return tab!=='recommend' || !state ||
      (!(state.lastRead && now-state.lastRead<30*DAY) && !(state.lastSeen && now-state.lastSeen<DAY) && state.seen.size<2);})
    .map(row => {
      const affinity = Math.min(1,((interests.books.get(row.book)||0)*1.4 + (interests.authors.get(row.author)||0)*.6 +
        row.topics.reduce((sum,t)=>sum+(interests.topics.get(t)||0),0)*.45)/8);
      const heat=trendScore(trends.get(row._id),now);
      const trend=trends.get(row._id);
      const satisfaction=Math.min(1,((trend?.reads||0)+2*(trend?.likes||0)+2)/(Math.max(trend?.exposures||0,trend?.reads||0)+20));
      const jitter=parseInt(hash(seed+row._id).slice(0,8),16)/0xffffffff;
      const fresh=2**(-Math.max(0,now-+new Date(row.publishedAt))/(30*DAY));
      return {...row, affinity, heat, jitter, fresh, topicGroup:groupFor(row.topics), adjacent:row.topics.some(t=>related.has(t)),
        score:.5*affinity+.2*row.quality+.05*satisfaction+.18*(heat/(heat+2))+.05*fresh+.02*jitter};
    });
  const chosen=[], fingerprints=new Set(),chosenByBook=new Map();
  while(pool.length && chosen.length<limit) {
    const window=chosen.slice(-19), lane=tab==='hot'?'hot':tab==='follow'?'follow':
      exploration==='more' && chosen.length%5===2?'adjacent':schedule[chosen.length%schedule.length];
    const counts=field=>{const values=new Map();for(const item of window)values.set(item[field],(values.get(item[field])||0)+1);return values;};
    const bookCounts=counts('book'),authorCounts=counts('author'),topicCounts=counts('topic');
    const questions=new Set(window.map(item=>item.post)),windowGroups=[...new Set(window.map(item=>item.topicGroup))];
    let eligible=pool.filter(row=>!fingerprints.has(row.fingerprint)&&!questions.has(row.post) &&
      !(chosenByBook.get(row.book)||[]).some(item=>nearDuplicate(row,item)));
    if(!eligible.length)break;
    const diversity=row=>(!row.book || (bookCounts.get(row.book)||0)<2) && (authorCounts.get(row.author)||0)<2;
    const topics=row=>(topicCounts.get(row.topic)||0)<10 && !(chosen.length>=2 && chosen.at(-1).topic===row.topic && chosen.at(-2).topic===row.topic);
    const varied=eligible.filter(row=>diversity(row)&&topics(row));
    // Only soft author/topic caps relax when supply is exhausted. Never relax
    // permission, explicit exclusions, exact duplicates or the question gap.
    eligible=varied.length?varied:eligible.filter(diversity).length?eligible.filter(diversity):eligible;
    const laneCandidates=eligible.filter(row=>lane==='interest'?row.affinity>.08:lane==='hot'?row.heat>0:
      lane==='adjacent'?row.adjacent&&row.affinity<.7:lane==='new'?!(trends.get(row._id)?.exposures>20):true);
    const matching=laneCandidates.length>0;
    if(matching)eligible=laneCandidates;
    const score=row=>{
      const similarity=row.book && bookCounts.has(row.book.trim())?1:
        Math.max(0,...windowGroups.map(group=>topicSimilarity(row.topicGroup,group)));
      const calibration=(topicCounts.get(row.topic)||0)*.025;
      return (tab==='hot'?row.heat:row.score)+(lane==='new'?.08*row.jitter:0)-.16*similarity-calibration;
    };
    let next=eligible[0],best=-Infinity;
    for(const row of eligible){const value=score(row);if(value>best || value===best&&row._id<next._id){next=row;best=value;}}
    next.reason=tab==='follow'?'来自你的关注':tab==='hot'?(next.heat>0?'近期讨论较多':'优质内容待发现'):
      matching&&lane==='interest'?'与你的阅读兴趣相关':matching&&lane==='hot'?'近期讨论较多':
      matching&&lane==='adjacent'?'探索相邻兴趣':matching&&lane==='new'?'发现较少曝光的内容':'换个主题看看';
    chosen.push(next);fingerprints.add(next.fingerprint);
    if(next.book){if(!chosenByBook.has(next.book))chosenByBook.set(next.book,[]);chosenByBook.get(next.book).push(next);}
    pool.splice(pool.findIndex(row=>row._id===next._id),1);
  }
  return chosen;
}
