'use client';

import {useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore} from 'react';
import {ArrowLeft} from 'lucide-react';
import {Virtuoso} from 'react-virtuoso';
import Link from './PrefetchLink';
import CatalogScrollbar from './CatalogScrollbar';
import {formatChapterTitle} from '@/lib/catalog-title';
import {beginChapterEntry, currentChapterEntry, subscribeChapterEntry} from '@/lib/chapter-entry';
import type {CatalogSnapshot} from '@/lib/book-catalog';
import './book-detail.css';

type Props = {
  open: boolean; onClose: () => void; bookId: string; bookTitle: string; catalog: CatalogSnapshot;
  onRange: (start: number, end: number) => void; onRetry: () => void;
  activeChapterId?: string;
  activeChapterLabel?: string;
  onSelect?: (id: string) => void; onPrefetch?: (id: string) => void;
};
const subscribeWidth = (notify: () => void) => {
  window.addEventListener('resize', notify);
  return () => window.removeEventListener('resize', notify);
};
const columnCount = () => innerWidth >= 1024 ? 3 : innerWidth >= 768 ? 2 : 1;

export default function BookCatalogSheet({open, onClose, bookTitle, ...props}: Props) {
  const columns = useSyncExternalStore(subscribeWidth, columnCount, () => 1);
  const openingChapter = useSyncExternalStore(subscribeChapterEntry, () => Boolean(currentChapterEntry()?.href.startsWith(`/book/${props.bookId}/`)), () => false);
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
      const items = [...panel.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),[tabindex="0"]')].filter(element => !element.closest('[inert]') && element.getBoundingClientRect().width > 0);
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
  return <div className="book-catalog-overlay" data-open={open} data-chapter-entry={openingChapter} aria-hidden={!open || openingChapter} inert={!open || openingChapter} onClick={onClose}>
    <div ref={panel} role="dialog" aria-modal="true" aria-label="全部目录" className="book-catalog-sheet" onClick={event => event.stopPropagation()}>
      <header className="book-catalog-header">
        <button className="book-catalog-back" onClick={onClose} aria-label="关闭目录"><ArrowLeft size={22}/></button>
        <h2 title={bookTitle}>{bookTitle}</h2><p>{props.catalog.total === null ? '加载中…' : `共 ${props.catalog.total} 章`}</p>
      </header>
      {open && <CatalogContents key={`${props.bookId}:${columns}:${props.activeChapterId ?? ''}:${props.catalog.generation}`} {...props} columns={columns}/>}
    </div>
  </div>;
}

function CatalogContents({bookId, catalog, onRange, onRetry, activeChapterId, activeChapterLabel = '正在阅读', onSelect, onPrefetch, columns}: Omit<Props, 'open' | 'onClose' | 'bookTitle'> & {columns: number}) {
  const listId = useId();
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const [listHeight, setListHeight] = useState(0);
  const [ready, setReady] = useState(false);
  const scrollerRef = useCallback((element: HTMLElement | Window | null) => setScroller(element instanceof HTMLElement ? element : null), []);
  const {rows, total, error} = catalog;
  const activeIndex = catalog.indices.get(activeChapterId ?? '') ?? -1;
  const activeRow = Math.max(0, Math.floor(activeIndex / columns));
  // Do not mount a list at chapter one while the remembered chapter is still
  // in flight. A deleted/stale chapter falls back to the start once loading ends.
  const waitingForChapter = !ready && (activeChapterId ? activeIndex < 0 && !catalog.resolved.has(activeChapterId) : total === null || (total > 0 && !rows.has(0)));
  const showList = total !== null && total > 0 && !waitingForChapter;
  const rangeChanged = useCallback(({startIndex, endIndex}: {startIndex: number; endIndex: number}) => onRange(startIndex * columns, (endIndex + 1) * columns - 1), [onRange, columns]);
  useLayoutEffect(() => {
    if (!scroller || !showList || ready) return;
    let frame = 0, stableFrames = 0, previousTop = -1, previousHeight = -1;
    const revealWhenLocated = () => {
      const target = scroller.querySelector<HTMLElement>(activeIndex >= 0 ? '[aria-current="location"]' : '.book-catalog-chapter');
      const viewport = scroller.getBoundingClientRect(), item = target?.closest('.book-catalog-row')?.getBoundingClientRect();
      const maximum = scroller.scrollHeight - scroller.clientHeight;
      const desiredTop = item ? Math.max(0, Math.min(maximum, scroller.scrollTop + item.top - viewport.top - (viewport.height - item.height) / 2)) : -1;
      const located = item && listHeight > 0 && viewport.height > 0 && item.bottom > viewport.top && item.top < viewport.bottom
        && (activeIndex < 0 || Math.abs(desiredTop - scroller.scrollTop) < 2)
        && (activeRow === 0 || scroller.scrollTop + viewport.height >= activeRow * item.height);
      stableFrames = located && scroller.scrollTop === previousTop && scroller.scrollHeight === previousHeight ? stableFrames + 1 : 0;
      previousTop = scroller.scrollTop; previousHeight = scroller.scrollHeight;
      if (stableFrames >= 2) setReady(true);
      else frame = requestAnimationFrame(revealWhenLocated);
    };
    frame = requestAnimationFrame(revealWhenLocated);
    return () => cancelAnimationFrame(frame);
  }, [scroller, showList, ready, activeIndex, activeRow, listHeight]);
  return <div role="region" aria-label="阅读目录" aria-busy={waitingForChapter || (showList && !ready)} className="book-catalog-body">
        {!error && (waitingForChapter || (showList && !ready)) && <p role="status" className="book-catalog-message book-catalog-loading">加载目录…</p>}
        {error && <p role="alert" className="book-catalog-message">{error} <button onClick={onRetry}>重试</button></p>}
        {total === 0 && !error && <p className="book-catalog-message">暂无章节</p>}
        {showList && <div className="book-catalog-scroll-area" data-ready={ready} aria-hidden={!ready} inert={!ready}><Virtuoso id={listId} scrollerRef={scrollerRef} totalListHeightChanged={setListHeight} className="book-catalog-list" style={{height: '100%'}} totalCount={Math.ceil(total / columns)} rangeChanged={rangeChanged}
          initialTopMostItemIndex={{index: activeRow, align: activeIndex >= 0 ? 'center' : 'start'}}
          itemContent={rowIndex => <div className="book-catalog-row" style={{gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`}}>
            {Array.from({length: Math.min(columns, total - rowIndex * columns)}, (_, column) => {
              const index = rowIndex * columns + column, chapter = rows.get(index);
              if (!chapter) return <span key={index} className="book-catalog-placeholder" aria-label="章节加载中"/>;
              return <Link key={chapter.id} href={`/book/${bookId}/${chapter.id}`} prefetchMode="intent"
              className="book-catalog-chapter" aria-current={chapter.id === activeChapterId ? 'location' : undefined}
              aria-description={chapter.id === activeChapterId ? activeChapterLabel : undefined}
              onMouseEnter={() => onPrefetch?.(chapter.id)} onFocus={() => onPrefetch?.(chapter.id)} onTouchStart={() => onPrefetch?.(chapter.id)}
              onNavigate={event => {
                beginChapterEntry(`/book/${bookId}/${chapter.id}`, formatChapterTitle(chapter.title, chapter.chapter_number));
                if (onSelect) {event.preventDefault(); onSelect(chapter.id);}
              }}>
              <span>{formatChapterTitle(chapter.title, chapter.chapter_number)}</span>
              {chapter.id === activeChapterId && <span aria-hidden="true" className="book-catalog-progress">{activeChapterLabel}</span>}
            </Link>;})}
          </div>}/><CatalogScrollbar scroller={scroller} contentHeight={listHeight} controls={listId}/></div>}
      </div>;
}
