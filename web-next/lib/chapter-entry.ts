import {freezeBookPage} from './book-transition';

type ChapterEntry = {
  token: string; href: string; chapterId: string; title: string; error?: string;
  paper: string; ink: string; desk: string; width: string; deferLoading: boolean;
};
const listeners = new Set<() => void>();
let entry: ChapterEntry | null = null;
let snapshot: HTMLElement | undefined;
const notify = () => listeners.forEach(listener => listener());
export const currentChapterEntry = () => entry;
export const serverChapterEntry = () => null;
export function subscribeChapterEntry(listener: () => void) { listeners.add(listener); return () => {listeners.delete(listener);}; }

export function beginChapterEntry(href: string, title: string) {
  const chapterId = href.split('/').at(-1)!;
  const reader = document.querySelector<HTMLElement>('.reader-pages-root');
  snapshot?.remove();
  // Hold the catalog in place until the reader is ready. Next's shared book
  // loading boundary must never flash through during a chapter navigation.
  snapshot = reader ? undefined : freezeBookPage('chapter-entry-snapshot');
  const colors: Record<string, [string, string, string]> = {
    cream: ['#e7d2ae', '#352a18', '#d9c6a6'], gray: ['#f0f0f0', '#222222', '#dcdcdc'],
    green: ['#dcedc8', '#222222', '#cce0b8'], blue: ['#e3edfc', '#222222', '#d5e2f5'],
    dark: ['#1a1a1a', '#a0a0a0', '#121212'],
  };
  let theme = 'cream', width = 1000;
  try {
    theme = JSON.parse(localStorage.getItem('novelhub_theme') || 'null') === 'dark' ? 'dark' : JSON.parse(localStorage.getItem('reader_themeColor') || '"cream"');
    const saved = JSON.parse(localStorage.getItem('reader_pageWidth') || 'null');
    if (typeof saved === 'number' && saved > 0 && saved < 3000) width = saved;
  } catch { /* A chapter can still be opened without browser storage. */ }
  try { sessionStorage.setItem(`reader-entry:${chapterId}`, 'start'); } catch {}
  const [paper, ink, desk] = colors[theme] || colors.cream;
  const style = reader ? getComputedStyle(reader) : null;
  entry = {token: crypto.randomUUID(), href, chapterId, title, paper: style?.getPropertyValue('--reader-paper') || paper,
    ink: style?.getPropertyValue('--reader-ink') || ink, desk, width: style?.getPropertyValue('--reader-width') || `${width}px`, deferLoading: !reader};
  // Cancel older chapter requests before the catalog's asynchronous history pop.
  window.dispatchEvent(new Event('chapter-entry-start'));
  notify();
  return entry;
}
export function failChapterEntry(href: string, error: string) {
  if (entry?.href === href) { entry = {...entry, error}; notify(); }
}
export function cancelChapterEntry() {
  snapshot?.remove(); snapshot = undefined;
  if (!entry) return;
  try { sessionStorage.removeItem(`reader-entry:${entry.chapterId}`); } catch {}
  entry = null; notify();
}
export function finishChapterEntry(token: string) { if (entry?.token === token) cancelChapterEntry(); }
