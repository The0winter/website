import {forumApi, type ForumPost} from './api';
import {clearForumReadingCache, setForumReadingUser} from './forum-reading-cache';
import {requestSignal} from './request-signal';
import {ensureForumFeedback,setForumFeedbackUser} from './forum-feedback';
import {setForumActivityUser} from './forum-activity';

export type Feed = 'recommend' | 'hot' | 'follow';
type ByFeed<T> = Partial<Record<Feed, T>>;
type Snapshot = {posts:ByFeed<ForumPost[]>; loading:ByFeed<boolean>; errors:ByFeed<string>;
  loadingMore:ByFeed<boolean>; moreErrors:ByFeed<string>; cursors:ByFeed<string|null>; batches:ByFeed<number>};
const empty:Snapshot = {posts:{}, loading:{recommend:true, hot:true, follow:true}, errors:{}, loadingMore:{}, moreErrors:{}, cursors:{}, batches:{}};
let snapshot = empty;
let user:string|null|undefined;
let generation = 0;
const updated = new Map<Feed, number>();
const pending = new Map<Feed, AbortController>();
const sizes = new Map<Feed, number>();
const requested = new Set<Feed>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());
const key = (post:ForumPost) => post.entryId || post.topReply?.id || post.id;
function unique(posts:ForumPost[]) {const seen = new Set<string>(); return posts.filter(post => !seen.has(key(post)) && !!seen.add(key(post)));}
let position = {tab:'recommend' as Feed, search:'', y:0};
export const getForumPosition = () => position;
export function rememberForumPosition(next:typeof position) {position = next;}
export const forumPageSize = () => typeof window !== 'undefined' && window.matchMedia('(max-width:767px)').matches ? 5 : 20;

function cancel() {generation++; for (const controller of pending.values()) controller.abort(); pending.clear();}
export function setForumUser(id:string|null) {
  setForumReadingUser(id);
  setForumActivityUser(id);
  setForumFeedbackUser(id);
  if (user === id) return;
  const queued = user === undefined ? [...requested] : [];
  user = id; cancel(); snapshot = empty;
  position = {tab:'recommend', search:'', y:0};
  updated.clear(); sizes.clear(); requested.clear(); notify();
  for (const tab of queued) loadForum(tab);
}
export const getForumSnapshot = () => snapshot;
export const serverForumSnapshot = () => empty;
export function subscribeForum(listener:() => void) {listeners.add(listener); return () => {listeners.delete(listener);};}

export function loadForum(tab:Feed = 'recommend') {
  requested.add(tab);
  if (user === undefined || pending.has(tab) || Date.now() - (updated.get(tab) ?? 0) < 60000) return;
  sizes.set(tab, sizes.get(tab) || forumPageSize());
  const previous = snapshot.posts[tab];
  // Returning from a document restores the same recommendation session. Only
  // an explicit new batch changes the order; passive revalidation cannot do so.
  if(previous && updated.has(tab))return;
  // Revalidate the retained window on return without shrinking a scrolled list.
  const limit = Math.max(sizes.get(tab)!, Math.min(100, previous?.length || 0));
  const version = generation, controller = new AbortController();
  pending.set(tab, controller);
  snapshot = {...snapshot, loading:{...snapshot.loading, [tab]:!previous}, errors:{...snapshot.errors, [tab]:undefined}};
  notify();
  void ensureForumFeedback(user||'guest').then(()=>forumApi.getFeedPage(tab, limit, null, requestSignal(controller.signal))).then(result => {
    if (version !== generation || pending.get(tab)!==controller) return;
    const retained = previous && previous.length > limit;
    snapshot = {...snapshot, posts:{...snapshot.posts, [tab]:unique(retained ? [...result.items, ...previous] : result.items)},
      cursors:{...snapshot.cursors, [tab]:retained ? snapshot.cursors[tab] : result.nextCursor},
      batches:{...snapshot.batches, [tab]:snapshot.batches[tab] || 1}, moreErrors:{...snapshot.moreErrors, [tab]:undefined}};
    updated.set(tab, Date.now());
  }).catch(() => {
    if (version === generation && pending.get(tab)===controller) snapshot = {...snapshot, errors:{...snapshot.errors, [tab]:'暂时无法加载，请重试'}};
  }).finally(() => {
    if (version !== generation || pending.get(tab)!==controller) return;
    pending.delete(tab); snapshot = {...snapshot, loading:{...snapshot.loading, [tab]:false}}; notify();
  });
}

export async function loadMoreForum(tab:Feed) {
  const cursor = snapshot.cursors[tab];
  if (user === undefined || !cursor || pending.has(tab)) return;
  const version = generation, controller = new AbortController();
  pending.set(tab, controller);
  snapshot = {...snapshot, loadingMore:{...snapshot.loadingMore, [tab]:true}, moreErrors:{...snapshot.moreErrors, [tab]:undefined}}; notify();
  try {
    const result = await forumApi.getFeedPage(tab, sizes.get(tab) || forumPageSize(), cursor, requestSignal(controller.signal));
    if (version !== generation || pending.get(tab)!==controller) return;
    snapshot = {...snapshot, posts:{...snapshot.posts, [tab]:unique([...(snapshot.posts[tab] || []), ...result.items])},
      cursors:{...snapshot.cursors, [tab]:result.nextCursor}, batches:{...snapshot.batches, [tab]:(snapshot.batches[tab] || 1) + 1}};
    updated.set(tab, Date.now());
  } catch(error) {
    const expired=error instanceof Error && /推荐已更新|游标/.test(error.message);
    if (version === generation && pending.get(tab)===controller) snapshot = {...snapshot, moreErrors:{...snapshot.moreErrors, [tab]:expired?'这批推荐已过期，请点击“换一批”继续。':'更多内容加载失败，请重试'}};
  } finally {
    if (version === generation && pending.get(tab)===controller) {pending.delete(tab); snapshot = {...snapshot, loadingMore:{...snapshot.loadingMore, [tab]:false}}; notify();}
  }
}
export function refreshForum() {
  clearForumReadingCache();
  // Existing cards remain stable after likes/comments. Newly requested batches
  // hydrate fresh counters, and the explicit refresh also discovers new posts.
  for(const tab of requested)if(!snapshot.posts[tab])loadForum(tab);
}
export function renewForum() {
  cancel(); clearForumReadingCache(); updated.clear();
  snapshot = {...empty};position={...position,y:0};notify();
  for (const tab of requested) loadForum(tab);
}
export function reloadForumFollowing() {
  pending.get('follow')?.abort();pending.delete('follow');updated.delete('follow');
  snapshot={...snapshot,posts:{...snapshot.posts,follow:undefined},cursors:{...snapshot.cursors,follow:null}};notify();
  if(requested.has('follow'))loadForum('follow');
}
