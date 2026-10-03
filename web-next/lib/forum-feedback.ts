'use client';
import {useCallback, useEffect, useSyncExternalStore} from 'react';
import type {ForumPost} from './api';
import {plainForumText} from './forum-presentation';
import {safeFetch} from './request';

export const feedbackReasons = {
  dislike:'不喜欢该内容', author:'不再推荐作者', similar:'太多重复或相似内容',
  extreme:'内容极端或引战', quality:'内容质量差',
  book:'少看这本书', topic:'少看这个主题', followAuthor:'关注这位作者', followBook:'关注这本书',
};
export type FeedbackReason = keyof typeof feedbackReasons;
export type ForumFeedback = {id:string; entry:string; question:string; author:string; authorName:string; title:string; text:string; reason:FeedbackReason; book?:string; topic?:string};
type Snapshot = {ready:boolean; rows:ForumFeedback[]; enabled:boolean; exploration:'balanced'|'more'; error?:string};
const empty:Snapshot = {ready:false, rows:[], enabled:true, exploration:'balanced'};
const snapshots = new Map<string,Snapshot>();
const requests = new Map<string,Promise<Snapshot>>();
const refreshed = new Map<string,number>();
const listeners = new Set<() => void>();
const storageKey = (user:string) => `forum-feedback-v1:${user}`;
const notify = () => listeners.forEach(listener => listener());
export function subscribeForumFeedback(listener:()=>void) {listeners.add(listener); return () => {listeners.delete(listener);};}
export function forumEntryKey(post:ForumPost) {return post.entryId || post.topReply?.id || post.id;}
export function forumAuthor(post:ForumPost) {
  const reply = post.topReply;
  const name = reply?.source?.author || reply?.author.name || (typeof post.author === 'string' ? post.author : post.author.name) || '书友';
  // Imported answers share an uploader account, but each original author is distinct.
  let source = '';
  try {if (reply?.source) source = new URL(reply.source.url).hostname;} catch { /* Old imports may omit a URL. */ }
  const id = reply?.source ? `source:${source}:${name}` : `user:${reply?.author.id || post.authorId || (typeof post.author === 'object' && post.author.id) || name}`;
  return {id, name};
}
const normalize = (text:string) => plainForumText(text).toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
function similar(left:string, right:string) {
  if (left.length < 12 || right.length < 12) return left.length > 0 && left === right;
  const grams = (value:string) => new Set(Array.from({length:value.length - 2}, (_, i) => value.slice(i, i + 3)));
  const a = grams(left), b = grams(right);
  let common = 0;
  for (const gram of a) if (b.has(gram)) common++;
  return 2 * common / (a.size + b.size) >= .82;
}
export function isForumRecommended(post:ForumPost, rows:ForumFeedback[]) {
  const entry = forumEntryKey(post), author = forumAuthor(post).id;
  return !rows.some(row => {
    if (row.reason.startsWith('follow')) return false;
    if (row.entry === entry || row.reason === 'author' && row.author === author) return true;
    if (row.reason === 'book' && row.book && row.book === post.bookId) return true;
    if (row.reason === 'topic' && row.topic && row.topic === post.recommendation?.topic) return true;
    if (row.reason !== 'similar') return false;
    // Suppress this question's other answers and near-duplicate reposts, without
    // treating a shared tag or a short generic phrase as evidence of duplication.
    return row.question === post.id || similar(normalize(row.title), normalize(post.title)) ||
      similar(row.text, normalize(post.topReply?.content || post.content || post.excerpt || '').slice(0, 800));
  });
}
function read(user:string) {
  let rows:ForumFeedback[] = [];
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(user)) || '[]');
    if (Array.isArray(value)) rows = value.filter(row => row && ['id','entry','question','author','authorName','title','text'].every(key => typeof row[key] === 'string') && Object.hasOwn(feedbackReasons,row.reason));
  } catch { /* A damaged or unavailable preference store must not block the feed. */ }
  snapshots.set(user,{...empty,ready:true, rows}); notify();
}

function publish(user:string, value:Omit<Snapshot,'ready'>) {
  const snapshot={...value,ready:true};snapshots.set(user,snapshot);
  try {localStorage.setItem(storageKey(user),JSON.stringify(value.rows));} catch { /* Server preferences remain authoritative. */ }
  notify();return snapshot;
}
async function requestPreferences(method='GET',body?:unknown,key='') {
  const response=await safeFetch('/api/forum/preferences'+key,{method,cache:'no-store',
    ...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
  if(!response.ok)throw Error('推荐偏好暂时无法同步，请稍后重试');
  return await response.json() as Snapshot;
}
// Shared by prefetch, visible feed and readers: establish the guest cookie once
// before parallel requests issue any signed recommendation receipts.
export function ensureForumFeedback(user:string,force=false):Promise<Snapshot> {
  const pending=requests.get(user);if(pending)return pending;
  if(!force && snapshots.get(user)?.ready && Date.now()-(refreshed.get(user)||0)<60000)return Promise.resolve(snapshots.get(user)!);
  if(!snapshots.has(user))read(user);
  const task=(async()=>{
    try {
      let value=await requestPreferences();
      let legacy:ForumFeedback[]=[];
      try {if(!localStorage.getItem(storageKey(user)+':migrated'))legacy=snapshots.get(user)?.rows||[];} catch { /* Optional legacy migration. */ }
      for(let start=0;start<legacy.length;start+=100)value=await requestPreferences('POST',{action:'import',rows:legacy.slice(start,start+100).map(row=>({entry:row.entry,reason:row.reason}))});
      try {localStorage.setItem(storageKey(user)+':migrated','1');} catch { /* Never block reading. */ }
      refreshed.set(user,Date.now());return publish(user,value);
    } catch(error) {
      const value={...(snapshots.get(user)||empty),ready:true,error:error instanceof Error?error.message:'偏好同步失败'};
      snapshots.set(user,value);notify();return value;
    } finally {requests.delete(user);}
  })();
  requests.set(user,task);return task;
}

export function useForumFeedback(user:string) {
  const snapshot = useSyncExternalStore(subscribeForumFeedback, useCallback(() => snapshots.get(user) || empty,[user]), () => empty);
  useEffect(() => {
    void ensureForumFeedback(user);
    const onStorage = (event:StorageEvent) => {if (event.key === storageKey(user) || event.key === null) void ensureForumFeedback(user,true);};
    const onVisible=()=>{if(document.visibilityState==='visible')void ensureForumFeedback(user);};
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange',onVisible);
    return () => {window.removeEventListener('storage', onStorage);document.removeEventListener('visibilitychange',onVisible);};
  }, [user]);
  return {...snapshot,
    async add(post:ForumPost, reason:FeedbackReason) {
      await ensureForumFeedback(user);
      const value=await requestPreferences('POST',{entry:forumEntryKey(post),reason});
      publish(user,value);
      return value.rows.find(row=>row.reason===reason && (row.entry===forumEntryKey(post) || row.author===forumAuthor(post).id))!;
    },
    async remove(id:string) {publish(user,await requestPreferences('DELETE',undefined,'/'+encodeURIComponent(id)));},
    async settings(value:{enabled?:boolean;exploration?:'balanced'|'more';action?:'reset'}) {publish(user,await requestPreferences('PATCH',value));},
    retry:()=>ensureForumFeedback(user,true),
  };
}
