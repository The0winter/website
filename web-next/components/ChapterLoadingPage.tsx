'use client';

import {useEffect, useRef, useSyncExternalStore, type CSSProperties} from 'react';
import {flushSync} from 'react-dom';
import {beginChapterEntry, currentChapterEntry, failChapterEntry, finishChapterEntry, prepareChapterReveal, showChapterText, serverChapterEntry, subscribeChapterEntry} from '@/lib/chapter-entry';
import './chapter-loading.css';

export default function ChapterLoadingPage() {
  const entry = useSyncExternalStore(subscribeChapterEntry, currentChapterEntry, serverChapterEntry);
  const token = entry?.token;
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (entry?.error) panel.current?.querySelector('button')?.focus({preventScroll: true});
  }, [entry?.error]);
  useEffect(() => {
    const target = currentChapterEntry();
    if (!target || target.token !== token) return;
    panel.current?.focus({preventScroll: true});
    let frame = 0, inputAt = -Infinity, disposed = false, stableFrames = 0, previousLayout = '';
    const pointers = new Set<number>();
    const ready = () => {
      if (location.pathname !== target.href) return null;
      const reader = document.querySelector<HTMLElement>(`[data-reader-entry-key="${target.token}"] [data-reader-chapter="${target.chapterId}"][data-reader-ready="true"]`);
      const sheet = reader?.querySelector<HTMLElement>('.reader-frame');
      if (!reader || !sheet) return null;
      const bounds = sheet.getBoundingClientRect();
      // A measured page can still be offscreen, transparent, or in a hidden
      // route tree. It must cover its final reading area before it is revealed.
      const left = Math.max(0, (innerWidth - bounds.width) / 2);
      if (!bounds.width || bounds.height < innerHeight - 1 || Math.abs(bounds.top) >= 1 || Math.abs(bounds.left - left) >= 1) return null;
      for (let element: HTMLElement | null = sheet; element; element = element.parentElement) {
        const style = getComputedStyle(element);
        if (style.visibility !== 'visible' || Number(style.opacity) < .999) return null;
      }
      const scroll = reader.querySelector('.reader-scroll-window');
      const columns = reader.querySelector<HTMLElement>('.reader-columns');
      const host = reader.closest('.reader-entry-content');
      return JSON.stringify([bounds.x, bounds.y, bounds.width, bounds.height, reader.getAttribute('style'),
        getComputedStyle(sheet).backgroundColor, host && getComputedStyle(host).backgroundColor,
        scroll?.scrollTop, columns?.getAttribute('style'), reader.querySelector('[data-reader-page]')?.textContent]);
    };
    const reveal = () => {
      cancelAnimationFrame(frame);
      if (disposed || currentChapterEntry()?.token !== target.token || currentChapterEntry()?.error) return;
      const layout = !pointers.size && performance.now() - inputAt >= 140 ? ready() : null;
      stableFrames = layout && layout === previousLayout ? stableFrames + 1 : 0;
      previousLayout = layout || '';
      if (stableFrames >= 2) {
        if (currentChapterEntry()?.revealing) {
          flushSync(() => finishChapterEntry(target.token)); return;
        }
        // Unlock scrolling and commit the final reader layout while the same
        // opaque loading page remains above it. Then verify actual paint frames.
        if (currentChapterEntry()?.releasing) flushSync(() => showChapterText(target.token));
        else flushSync(() => prepareChapterReveal(target.token));
        stableFrames = 0; previousLayout = '';
      }
      frame = requestAnimationFrame(reveal);
    };
    const down = (event: PointerEvent) => {pointers.add(event.pointerId); inputAt = performance.now(); reveal();};
    const up = (event: PointerEvent) => {pointers.delete(event.pointerId); inputAt = performance.now(); reveal();};
    const releasePointers = () => {pointers.clear(); inputAt = performance.now(); reveal();};
    const blockScroll = (event: Event) => {event.preventDefault(); event.stopImmediatePropagation(); inputAt = performance.now(); reveal();};
    const keyboard = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      event.stopImmediatePropagation();
      if (event.key === 'Escape') {event.preventDefault(); window.history.back(); return;}
      if (event.key === 'Tab') {
        event.preventDefault();
        const buttons = panel.current?.querySelectorAll('button');
        if (buttons?.length) buttons[document.activeElement === buttons[0] ? 1 : 0]?.focus();
        return;
      }
      if (event.key === 'Enter' && !(event.target as HTMLElement).closest('.chapter-loading-actions')) {event.preventDefault(); return;}
      if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) blockScroll(event);
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    window.addEventListener('blur', releasePointers);
    window.addEventListener('wheel', blockScroll, {capture: true, passive: false});
    window.addEventListener('touchmove', blockScroll, {capture: true, passive: false});
    window.addEventListener('keydown', keyboard, true);
    const timeout = window.setTimeout(() => {if (!ready()) failChapterEntry(target.href, '章节暂时未能加载，请重试');}, 20000);
    reveal();
    return () => {
      disposed = true; window.clearTimeout(timeout); cancelAnimationFrame(frame);
      window.removeEventListener('pointerdown', down, true); window.removeEventListener('pointerup', up, true); window.removeEventListener('pointercancel', up, true);
      window.removeEventListener('blur', releasePointers);
      window.removeEventListener('wheel', blockScroll, true); window.removeEventListener('touchmove', blockScroll, true); window.removeEventListener('keydown', keyboard, true);
    };
  }, [token]);
  if (!entry) return null;
  const style = {'--reader-paper': entry.paper, '--entry-ink': entry.ink, '--entry-desk': entry.desk, '--entry-width': entry.width} as CSSProperties;
  return <div ref={panel} tabIndex={-1} aria-busy={!entry.error} aria-label={`正在打开章节：${entry.title}`} className="chapter-loading-page" style={style} data-chapter-loading={entry.chapterId} data-loading-visible="true" data-text-revealed={Boolean(entry.revealing)}>
    <div className="chapter-loading-sheet" data-paper={entry.textured}>
      <div role={entry.error ? 'alert' : 'status'} aria-live="polite" className="chapter-loading-message">
        <h2>{entry.title}</h2><p>{entry.error || '正在加载'}</p>
        {entry.error && <div className="chapter-loading-actions"><button onClick={() => {beginChapterEntry(entry.href, entry.title); window.location.replace(entry.href);}}>重试</button><button onClick={() => window.history.back()}>返回</button></div>}
      </div>
    </div>
  </div>;
}
