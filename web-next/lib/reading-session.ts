// This visit only: no localStorage, cookies or chapter bodies. Closing/reloading
// the document discards both these small pointers and the router's prefetches.
const recent = new Map<string, string>();
const subscribers = new Set<() => void>();
export function rememberChapter(bookId: string, chapterId: string) {
  if (!bookId || !chapterId || recent.get(bookId) === chapterId) return;
  recent.delete(bookId);
  recent.set(bookId, chapterId);
  while (recent.size > 20) recent.delete(recent.keys().next().value!);
  subscribers.forEach(listener => listener());
}
export const lastReadChapter = (bookId: string) => recent.get(bookId) ?? null;
export const serverLastReadChapter = () => null;
export function subscribeReadingSession(listener: () => void) {
  subscribers.add(listener);
  return () => { subscribers.delete(listener); };
}
