// Persist only small book/chapter pointers. Chapter bodies and route prefetches
// still belong to this document and are discarded on reload.
const storageKey = 'reader-recent-chapters:v1';
const recent = new Map<string, string>();
const subscribers = new Set<() => void>();
let savedValue: string | null | undefined;
function restore() {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw === savedValue) return;
    savedValue = raw;
    const rows: unknown = JSON.parse(raw || '[]');
    recent.clear();
    if (Array.isArray(rows)) for (const row of rows.slice(-100)) {
      if (Array.isArray(row) && row.length === 2 && row.every(value => typeof value === 'string' && /^[a-z0-9_-]{1,100}$/i.test(value))) recent.set(row[0], row[1]);
    }
  } catch { /* Reading remains available with unavailable or invalid storage. */ }
}
export function rememberChapter(bookId: string, chapterId: string) {
  restore();
  if (!bookId || !chapterId || recent.get(bookId) === chapterId) return;
  recent.delete(bookId);
  recent.set(bookId, chapterId);
  while (recent.size > 100) recent.delete(recent.keys().next().value!);
  try { const raw = JSON.stringify([...recent]); localStorage.setItem(storageKey, raw); savedValue = raw; } catch {}
  subscribers.forEach(listener => listener());
}
export const lastReadChapter = (bookId: string) => { restore(); return recent.get(bookId) ?? null; };
export const serverLastReadChapter = () => null;
export function subscribeReadingSession(listener: () => void) {
  subscribers.add(listener);
  const onStorage = (event: StorageEvent) => { if (event.key === storageKey || event.key === null) listener(); };
  window.addEventListener('storage', onStorage);
  return () => { subscribers.delete(listener); window.removeEventListener('storage', onStorage); };
}
