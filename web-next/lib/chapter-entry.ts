import {flushSync} from 'react-dom';
import {mobileReaderCream, readerPaperPosition} from './reader-paper';

type ChapterEntry = {
  token: string; href: string; chapterId: string; title: string; error?: string; position: 'start' | 'resume'; minimumVisibleMs: number;
  paper: string; ink: string; desk: string; width: string; textured: boolean; paperPosition: string; releasing?: boolean; revealing?: boolean;
};
const listeners = new Set<() => void>();
let entry: ChapterEntry | null = null;
const notify = () => listeners.forEach(listener => listener());
export const currentChapterEntry = () => entry;
export const serverChapterEntry = () => null;
export function subscribeChapterEntry(listener: () => void) { listeners.add(listener); return () => {listeners.delete(listener);}; }

export function beginChapterEntry(href: string, title: string, position: 'start' | 'resume' = 'start', minimumVisibleMs = 400) {
  const chapterId = href.split('/').at(-1)!;
  const reader = [...document.querySelectorAll<HTMLElement>('.reader-pages-root')].find(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.width > 0 && bounds.height > 0 && getComputedStyle(element).visibility === 'visible';
  });
  const colors: Record<string, [string, string, string]> = {
    cream: ['#e7d2ae', '#352a18', '#d9c6a6'], gray: ['#f0f0f0', '#222222', '#dcdcdc'],
    green: ['#dcedc8', '#222222', '#cce0b8'], blue: ['#e3edfc', '#222222', '#d5e2f5'],
    dark: ['#1a1a1a', '#a0a0a0', '#121212'],
  };
  if (innerWidth < 1024) colors.cream = [mobileReaderCream.bg, mobileReaderCream.text, colors.cream[2]];
  let theme = 'cream', width = 1000;
  let paperPage = 0;
  try {
    theme = JSON.parse(localStorage.getItem('novelhub_theme') || 'null') === 'dark' ? 'dark' : JSON.parse(localStorage.getItem('reader_themeColor') || '"cream"');
    const saved = JSON.parse(localStorage.getItem('reader_pageWidth') || 'null');
    if (typeof saved === 'number' && saved > 0 && saved < 3000) width = saved;
    if (position === 'resume' && JSON.parse(localStorage.getItem('reader_turnMode') || '"horizontal"') !== 'scroll') {
      paperPage = JSON.parse(localStorage.getItem(`reader-page:${chapterId}`) || 'null')?.paperPage || 0;
    }
  } catch { /* A chapter can still be opened without browser storage. */ }
  try {
    if (position === 'start') sessionStorage.setItem(`reader-entry:${chapterId}`, 'start');
    else sessionStorage.removeItem(`reader-entry:${chapterId}`);
  } catch {}
  const [paper, ink, desk] = colors[theme] || colors.cream;
  const style = reader ? getComputedStyle(reader) : null;
  entry = {token: crypto.randomUUID(), href, chapterId, title, position, minimumVisibleMs, paper: style?.getPropertyValue('--reader-paper') || paper,
    ink: style?.getPropertyValue('--reader-ink') || ink, desk, width: style?.getPropertyValue('--reader-width') || `${width}px`,
    textured: reader ? reader.querySelector('.reader-frame')?.getAttribute('data-paper') === 'true' : theme === 'cream',
    paperPosition: readerPaperPosition(paperPage)};
  // Cancel older chapter requests before the catalog's asynchronous history pop.
  window.dispatchEvent(new Event('chapter-entry-start'));
  // Paint the opaque reading paper before Next can replace the source route.
  flushSync(notify);
  return entry;
}
export function failChapterEntry(href: string, error: string) {
  if (entry?.href === href) { entry = {...entry, error, revealing: false}; notify(); }
}
export function cancelChapterEntry() {
  if (!entry) return;
  try { sessionStorage.removeItem(`reader-entry:${entry.chapterId}`); } catch {}
  entry = null; notify();
}
// Release reader layout constraints underneath the still-visible loading paper.
// Removing both in one commit can expose scroll restoration or a fresh layout.
export function prepareChapterReveal(token: string) {
  if (entry?.token === token && !entry.releasing) {entry = {...entry, releasing: true}; notify();}
}
// Show the actual text over the existing paper before removing the loading layer.
export function showChapterText(token: string) {
  if (entry?.token === token && entry.releasing) {entry = {...entry, revealing: true}; notify();}
}
export function finishChapterEntry(token: string) { if (entry?.token === token) cancelChapterEntry(); }
