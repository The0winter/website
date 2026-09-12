import {flushSync} from 'react-dom';
import {mobileReaderCream, readerPaperPosition} from './reader-paper';
import {freezeBookPage} from './book-transition';

type ChapterEntry = {
  token: string; href: string; chapterId: string; title: string; error?: string; position: 'start' | 'resume'; minimumVisibleMs: number;
  paper: string; ink: string; desk: string; width: string; textured: boolean; paperPosition: string; releasing?: boolean; revealing?: boolean;
  motion: 'none' | 'enter' | 'catalog'; motionComplete: boolean;
};
const listeners = new Set<() => void>();
let entry: ChapterEntry | null = null;
let clearMotion: (() => void) | undefined;
const notify = () => listeners.forEach(listener => listener());
export const currentChapterEntry = () => entry;
export const serverChapterEntry = () => null;
export function subscribeChapterEntry(listener: () => void) { listeners.add(listener); return () => {listeners.delete(listener);}; }

export function beginChapterEntry(href: string, title: string, position: 'start' | 'resume' = 'start', minimumVisibleMs = 400) {
  clearMotion?.();
  const chapterId = href.split('/').at(-1)!;
  const mobileDetail = innerWidth < 768 && location.pathname === href.slice(0, href.lastIndexOf('/'));
  const catalog = mobileDetail ? document.querySelector<HTMLElement>('.book-catalog-overlay[data-open=true]') : null;
  const motion = mobileDetail && !matchMedia('(prefers-reduced-motion: reduce)').matches ? catalog ? 'catalog' : 'enter' : 'none';
  // Retain only the visible catalog when it slides out; retain the detail page
  // beneath an incoming loader. Both snapshots survive a cached route swap.
  const snapshot = motion === 'none' ? null : catalog
    ? freezeBookPage('chapter-entry-snapshot chapter-catalog-snapshot', catalog, clone => {
      clone.style.background = 'transparent';
      clone.querySelector<HTMLElement>('.book-catalog-sheet')!.style.boxShadow = 'none';
    })
    : freezeBookPage('chapter-entry-snapshot');
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
    paperPosition: readerPaperPosition(paperPage), motion, motionComplete: motion === 'none'};
  if (motion === 'catalog' || mobileDetail && motion === 'none') entry.minimumVisibleMs = 0;
  // Cancel older chapter requests before the catalog's asynchronous history pop.
  window.dispatchEvent(new Event('chapter-entry-start'));
  // Paint the opaque reading paper before Next can replace the source route.
  flushSync(notify);
  if (snapshot) {
    const token = entry.token;
    const moving = motion === 'catalog' ? snapshot : document.querySelector<HTMLElement>('.chapter-loading-page')!;
    const animation = moving.animate(motion === 'catalog'
      ? [{transform: 'translateX(0)'}, {transform: 'translateX(calc(100vw + 24px))'}]
      : [{transform: 'translateX(100%)'}, {transform: 'translateX(0)'}],
    {duration: 400, easing: 'cubic-bezier(.22,.7,.25,1)', fill: 'forwards'});
    const cleanup = () => {animation.cancel(); snapshot.remove(); if (clearMotion === cleanup) clearMotion = undefined;};
    clearMotion = cleanup;
    void animation.finished.then(() => {
      cleanup();
      if (entry?.token === token) {entry = {...entry, motionComplete: true}; notify();}
    }, () => {});
  }
  return entry;
}
export function failChapterEntry(href: string, error: string) {
  if (entry?.href === href) { entry = {...entry, error, revealing: false}; notify(); }
}
export function cancelChapterEntry() {
  clearMotion?.();
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
