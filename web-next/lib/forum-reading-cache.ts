import {forumApi, type ForumPost, type ForumReply} from './api';
import {currentPrefetchPolicy} from './book-prefetch';
import {requestSignal} from './request-signal';

type Reading = {post:ForumPost; answer:ForumReply|null};
type Value = Reading | ForumReply[];
type Entry = {promise:Promise<Value>; expires:number; controller:AbortController};
const cache = new Map<string, Entry>();
let account:string|null|undefined;

export function clearForumReadingCache(cancelPending = false) {
  if (cancelPending) for (const entry of cache.values()) entry.controller.abort();
  cache.clear();
}
export function setForumReadingUser(id:string|null) {
  // Initial reads use the same HttpOnly cookie as the session check.
  if (account !== undefined && account !== id) clearForumReadingCache(true);
  account = id;
}
function read<T extends Value>(key:string, fetcher:(signal:AbortSignal)=>Promise<T>):Promise<T> {
  const existing = cache.get(key);
  if (existing && existing.expires > Date.now()) {cache.delete(key); cache.set(key, existing); return existing.promise as Promise<T>;}
  if (existing) {existing.controller.abort(); cache.delete(key);}
  const controller = new AbortController();
  const entry:Entry = {controller, expires:Infinity, promise:Promise.resolve(null as unknown as T)};
  entry.promise = fetcher(requestSignal(controller.signal)).then(value => {entry.expires = Date.now() + 60000; return value;})
    .catch(error => {if (cache.get(key) === entry) cache.delete(key); throw error;});
  cache.set(key, entry);
  while (cache.size > 24) {
    const oldest = cache.keys().next().value!;
    cache.get(oldest)?.controller.abort(); cache.delete(oldest);
  }
  return entry.promise as Promise<T>;
}
export const loadForumReading = (id:string, answerId?:string) => read(`read:${id}:${answerId || ''}`, signal => forumApi.getReading(id, answerId, signal));
export const loadForumAnswers = (id:string, page:number, limit=5) => read(`answers:${id}:${page}:${limit}`, signal => forumApi.getReplies(id, page, limit, signal));

let code:Promise<unknown>|undefined;
export function warmForumReaderCode() {
  if (typeof window === 'undefined' || currentPrefetchPolicy() === 'paused') return;
  code ??= import('../app/forum/[postId]/ForumPostClient').catch(() => {code = undefined;});
}
export function warmForumDestination(href:string) {
  if (typeof window === 'undefined' || currentPrefetchPolicy() === 'paused') return;
  const url = new URL(href, location.origin);
  const match = /^\/forum\/([a-f0-9]{24})$/i.exec(url.pathname);
  if (url.origin !== location.origin || !match) return;
  warmForumReaderCode();
  const question = url.searchParams.get('fromQuestion');
  if (question && !/^[a-f0-9]{24}$/i.test(question)) return;
  void loadForumReading(question || match[1], question ? match[1] : undefined).catch(() => {});
}
