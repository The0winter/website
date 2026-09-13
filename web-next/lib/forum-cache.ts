import {forumApi, type ForumPost} from './api';

type Feed = 'recommend' | 'hot' | 'follow';
type Snapshot = {posts: Partial<Record<Feed, ForumPost[]>>; loading: Record<Feed, boolean>};
const empty: Snapshot = {posts: {}, loading: {recommend: true, hot: true, follow: true}};
let snapshot = empty;
let user: string | null | undefined;
let generation = 0;
const updated = new Map<Feed, number>();
const pending = new Map<Feed, Promise<void>>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());

export function setForumUser(id: string | null) {
  if (user === id) return;
  user = id;
  generation++;
  snapshot = empty;
  updated.clear(); pending.clear(); notify();
}
export const getForumSnapshot = () => snapshot;
export const serverForumSnapshot = () => empty;
export function subscribeForum(listener: () => void) {
  listeners.add(listener);
  return () => {listeners.delete(listener);};
}
export function loadForum() {
  if (user === undefined) return;
  for (const tab of ['recommend', 'hot', 'follow'] as const) {
    if (pending.has(tab) || Date.now() - (updated.get(tab) ?? 0) < 60000) continue;
    const version = generation;
    const request = forumApi.getPosts(tab).then(posts => {
      if (version !== generation) return;
      snapshot = {...snapshot, posts: {...snapshot.posts, [tab]: posts || []}};
      updated.set(tab, Date.now());
    }).catch(() => {
      // Retain the last successful list when a background refresh fails.
    }).finally(() => {
      if (version !== generation) return;
      pending.delete(tab);
      snapshot = {...snapshot, loading: {...snapshot.loading, [tab]: false}};
      notify();
    });
    pending.set(tab, request);
  }
}
export function refreshForum() {
  generation++; pending.clear(); updated.clear();
  loadForum();
}
