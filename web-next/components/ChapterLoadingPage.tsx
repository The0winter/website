'use client';

import {useEffect, useRef, useSyncExternalStore, type CSSProperties} from 'react';
import {beginChapterEntry, currentChapterEntry, failChapterEntry, finishChapterEntry, serverChapterEntry, subscribeChapterEntry} from '@/lib/chapter-entry';
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
    let frame = 0, settle = 0, inputAt = 0, disposed = false;
    const pointers = new Set<number>();
    const ready = () => Boolean(document.querySelector(`[data-reader-entry-key="${target.token}"] [data-reader-chapter="${target.chapterId}"][data-reader-ready="true"]`));
    const reveal = () => {
      window.clearTimeout(settle); cancelAnimationFrame(frame);
      if (disposed || !ready() || currentChapterEntry()?.error || pointers.size) return;
      const quiet = Math.max(0, 140 - (performance.now() - inputAt));
      settle = window.setTimeout(() => {
        frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => {
          if (!disposed && !pointers.size && ready() && performance.now() - inputAt >= 140) finishChapterEntry(target.token);
          else reveal();
        }); });
      }, quiet);
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
    const observer = new MutationObserver(reveal);
    observer.observe(document.body, {subtree: true, childList: true, attributes: true});
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
      disposed = true; observer.disconnect(); window.clearTimeout(timeout); window.clearTimeout(settle); cancelAnimationFrame(frame);
      window.removeEventListener('pointerdown', down, true); window.removeEventListener('pointerup', up, true); window.removeEventListener('pointercancel', up, true);
      window.removeEventListener('blur', releasePointers);
      window.removeEventListener('wheel', blockScroll, true); window.removeEventListener('touchmove', blockScroll, true); window.removeEventListener('keydown', keyboard, true);
    };
  }, [token]);
  if (!entry) return null;
  const style = {'--entry-paper': entry.paper, '--entry-ink': entry.ink, '--entry-desk': entry.desk, '--entry-width': entry.width} as CSSProperties;
  return <div ref={panel} tabIndex={-1} className="chapter-loading-page" style={style} data-chapter-loading={entry.chapterId}>
    <div className="chapter-loading-sheet">
      <div role={entry.error ? 'alert' : 'status'} aria-live="polite" className="chapter-loading-message">
        <h2>{entry.title}</h2><p>{entry.error || '正在加载'}</p>
        {entry.error && <div className="chapter-loading-actions"><button onClick={() => {beginChapterEntry(entry.href, entry.title); window.location.replace(entry.href);}}>重试</button><button onClick={() => window.history.back()}>返回</button></div>}
      </div>
    </div>
  </div>;
}
