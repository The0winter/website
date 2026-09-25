import {forumApi, type ForumPost} from './api';

type Feed = 'recommend' | 'hot' | 'follow';
type Snapshot = {posts: Partial<Record<Feed, ForumPost[]>>; loading: Record<Feed, boolean>; errors: Partial<Record<Feed, string>>};
const empty: Snapshot = {posts: {}, loading: {recommend: true, hot: true, follow: true}, errors: {}};
let snapshot = empty;
let user: string | null | undefined;
let generation = 0;
const updated = new Map<Feed, number>();
const pending = new Map<Feed, Promise<void>>();
const requested = new Set<Feed>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());

export function setForumUser(id: string | null) {
  if (user === id) return;
  user = id;
  generation++;
  snapshot = empty;
  updated.clear(); pending.clear(); requested.clear(); notify();
}
export const getForumSnapshot = () => snapshot;
export const serverForumSnapshot = () => empty;
export function subscribeForum(listener: () => void) {
  listeners.add(listener);
  return () => {listeners.delete(listener);};
}
export function loadForum(tab: Feed = 'recommend') {
  if (user === undefined) return;
  requested.add(tab);
  if (pending.has(tab) || Date.now() - (updated.get(tab) ?? 0) < 60000) return;
  const version = generation;
  snapshot = {...snapshot, loading: {...snapshot.loading, [tab]: !snapshot.posts[tab]}, errors: {...snapshot.errors, [tab]: undefined}};
  const request = forumApi.getPosts(tab).then(posts => {
    if (version !== generation) return;
    snapshot = {...snapshot, posts: {...snapshot.posts, [tab]: posts || []}};
    updated.set(tab, Date.now());
  }).catch(() => {
    // Retain the last successful list when a background refresh fails.
    if (version === generation) snapshot = {...snapshot, errors: {...snapshot.errors, [tab]: '暂时无法加载，请重试'}};
  }).finally(() => {
    if (version !== generation) return;
    pending.delete(tab);
    snapshot = {...snapshot, loading: {...snapshot.loading, [tab]: false}};
    notify();
  });
  pending.set(tab, request);
  notify();
}
export function refreshForum() {
  generation++; pending.clear(); updated.clear();
  // Mutations refresh visited feeds without fetching unopened tabs.
  for (const tab of requested) loadForum(tab);
}
