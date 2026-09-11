'use client';

import {useEffect, useMemo, useRef, useSyncExternalStore} from 'react';
import {ArrowUpDown, X} from 'lucide-react';
import {Virtuoso, type VirtuosoHandle} from 'react-virtuoso';
import Link from './PrefetchLink';
import {formatChapterTitle} from '@/lib/catalog-title';
import {beginChapterEntry} from '@/lib/chapter-entry';
import './book-detail.css';

type CatalogChapter = {id: string; title: string; chapter_number: number};
type Props = {
  open: boolean; onClose: () => void; bookId: string; chapters: CatalogChapter[];
  total: number | null; loading: boolean; error: string; onRetry: () => void;
  reversed: boolean; onToggleOrder: () => void; activeChapterId?: string;
  onSelect?: (id: string) => void; onPrefetch?: (id: string) => void;
};
const subscribeWidth = (notify: () => void) => {
  window.addEventListener('resize', notify);
  return () => window.removeEventListener('resize', notify);
};
const columnCount = () => innerWidth >= 1024 ? 3 : innerWidth >= 768 ? 2 : 1;

export default function BookCatalogSheet({open, onClose, bookId, chapters, total, loading, error, onRetry, reversed, onToggleOrder, activeChapterId, onSelect, onPrefetch}: Props) {
  const columns = useSyncExternalStore(subscribeWidth, columnCount, () => 1);
  const list = useRef<VirtuosoHandle>(null);
  const rows = useMemo(() => {
    const result: CatalogChapter[][] = [];
    for (let index = 0; index < chapters.length; index += columns) result.push(chapters.slice(index, index + columns));
    return result;
  }, [chapters, columns]);
  const activeIndex = chapters.findIndex(chapter => chapter.id === activeChapterId);
  const activeRow = Math.max(0, Math.floor(activeIndex / columns));
  useEffect(() => {
    if (!open) return;
    // Virtuoso must receive the new row count before locating a chapter in a
    // later batch, especially when descending order moves it towards the end.
    const frame = requestAnimationFrame(() => list.current?.scrollToIndex({index: activeRow, align: activeIndex >= 0 ? 'center' : 'start'}));
    return () => cancelAnimationFrame(frame);
  }, [open, activeRow, activeIndex, reversed]);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>('[aria-label="关闭目录"]')?.focus({preventScroll: true}));
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key !== 'Tab' || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),[tabindex="0"]')].filter(element => element.getBoundingClientRect().width > 0);
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keyboard);
    return () => {
      cancelAnimationFrame(frame); document.body.style.overflow = overflow;
      document.removeEventListener('keydown', keyboard);
      if (previousFocus?.isConnected) previousFocus.focus({preventScroll: true});
    };
  }, [open, onClose]);
  return <div className="book-catalog-overlay" data-open={open} aria-hidden={!open} inert={!open} onClick={onClose}>
    <div ref={panel} role="dialog" aria-modal="true" aria-label="全部目录" className="book-catalog-sheet" onClick={event => event.stopPropagation()}>
      <header className="book-catalog-header">
        <div><h2>全部目录</h2><p>共 {total ?? chapters.length} 章</p></div>
        <div className="book-catalog-actions">
          <button onClick={onToggleOrder} aria-label={reversed ? '倒序' : '正序'}><ArrowUpDown size={16}/><span>{reversed ? '倒序' : '正序'}</span></button>
          <button onClick={onClose} aria-label="关闭目录"><X size={24}/></button>
        </div>
      </header>
      <div role="region" aria-label="阅读目录" aria-busy={loading} className="book-catalog-body">
        {loading && !chapters.length && <p role="status" className="book-catalog-message">加载目录…</p>}
        {error && <p role="alert" className="book-catalog-message">{error} <button onClick={onRetry}>重试</button></p>}
        {!loading && !error && !chapters.length && <p className="book-catalog-message">暂无章节</p>}
        {open && rows.length > 0 && <Virtuoso ref={list} className="book-catalog-list" style={{height: '100%'}} data={rows}
          initialTopMostItemIndex={{index: activeRow, align: activeIndex >= 0 ? 'center' : 'start'}}
          itemContent={(_, row) => <div className="book-catalog-row" style={{gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`}}>
            {row.map(chapter => <Link key={chapter.id} href={`/book/${bookId}/${chapter.id}`} prefetchMode="intent"
              className="book-catalog-chapter" aria-current={chapter.id === activeChapterId ? 'location' : undefined}
              onMouseEnter={() => onPrefetch?.(chapter.id)} onFocus={() => onPrefetch?.(chapter.id)} onTouchStart={() => onPrefetch?.(chapter.id)}
              onNavigate={event => {
                beginChapterEntry(`/book/${bookId}/${chapter.id}`, formatChapterTitle(chapter.title, chapter.chapter_number));
                if (onSelect) {event.preventDefault(); onSelect(chapter.id);}
              }}>
              <span>{formatChapterTitle(chapter.title, chapter.chapter_number)}</span>
            </Link>)}
          </div>}/>}
      </div>
    </div>
  </div>;
}
