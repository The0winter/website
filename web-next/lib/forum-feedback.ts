'use client';
import {useCallback, useEffect, useSyncExternalStore} from 'react';
import type {ForumPost} from './api';
import {plainForumText} from './forum-presentation';

export const feedbackReasons = {
  dislike:'不喜欢该内容', author:'不再推荐作者', similar:'太多重复或相似内容',
  extreme:'内容极端或引战', quality:'内容质量差',
};
export type FeedbackReason = keyof typeof feedbackReasons;
export type ForumFeedback = {id:string; entry:string; question:string; author:string; authorName:string; title:string; text:string; reason:FeedbackReason};
type Snapshot = {ready:boolean; rows:ForumFeedback[]};
const empty:Snapshot = {ready:false, rows:[]};
const snapshots = new Map<string,Snapshot>();
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
    if (row.entry === entry || row.reason === 'author' && row.author === author) return true;
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
  snapshots.set(user,{ready:true, rows}); notify();
}
export function useForumFeedback(user:string) {
  const snapshot = useSyncExternalStore(subscribeForumFeedback, useCallback(() => snapshots.get(user) || empty,[user]), () => empty);
  useEffect(() => {
    if (!snapshots.has(user)) read(user);
    const onStorage = (event:StorageEvent) => {if (event.key === storageKey(user) || event.key === null) read(user);};
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [user]);
  const save = (rows:ForumFeedback[]) => {
    let persisted = true;
    try {localStorage.setItem(storageKey(user),JSON.stringify(rows));} catch {persisted = false;}
    snapshots.set(user,{ready:true, rows}); notify();
    return persisted;
  };
  return {...snapshot,
    add(post:ForumPost, reason:FeedbackReason) {
      const author = forumAuthor(post);
      const row:ForumFeedback = {id:crypto.randomUUID(), entry:forumEntryKey(post), question:post.id, author:author.id, authorName:author.name, title:post.title, text:normalize(post.topReply?.content || post.content || post.excerpt || '').slice(0,800), reason};
      return {row, persisted:save([...(snapshots.get(user)?.rows || []),row])};
    },
    remove(id:string) {return save((snapshots.get(user)?.rows || []).filter(row => row.id !== id));},
  };
}
