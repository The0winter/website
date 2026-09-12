'use client';

import {useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {flushSync} from 'react-dom';
import {ArrowLeft, ChevronDown} from 'lucide-react';
import {Virtuoso} from 'react-virtuoso';
import Link from './PrefetchLink';
import CatalogScrollbar from './CatalogScrollbar';
import {formatChapterTitle} from '@/lib/catalog-title';
import {beginChapterEntry, currentChapterEntry, subscribeChapterEntry} from '@/lib/chapter-entry';
import type {CatalogSnapshot, CatalogVolume} from '@/lib/book-catalog';
import {catalogLayout} from '@/lib/catalog-layout';
import {splitCatalogTitle} from '../../shared/catalog-volumes.mjs';
import './book-detail.css';

type Props = {
  open: boolean; onClose: () => void; bookId: string; bookTitle: string; catalog: CatalogSnapshot;
  onRange: (start: number, end: number) => void; onRetry: () => void;
  activeChapterId?: string;
  activeChapterLabel?: string;
  onSelect?: (id: string, title: string) => void; onPrefetch?: (id: string) => void;
};
const subscribeWidth = (notify: () => void) => {
  window.addEventListener('resize', notify);
  return () => window.removeEventListener('resize', notify);
};
const columnCount = () => innerWidth >= 1024 ? 3 : innerWidth >= 768 ? 2 : 1;

export default function BookCatalogSheet({open, onClose, bookTitle, ...props}: Props) {
  const {onSelect} = props;
  const columns = useSyncExternalStore(subscribeWidth, columnCount, () => 1);
  const openingChapter = useSyncExternalStore(subscribeChapterEntry, () => Boolean(currentChapterEntry()?.href.startsWith(`/book/${props.bookId}/`)), () => false);
  const panel = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<ContentsProps | null>(null);
  const selecting = useRef(false);
  const contents = selection ?? {...props, columns};
  useEffect(() => {
    if (!selection) return;
    let cancelled = false;
    const cancel = () => {cancelled = true; selecting.current = false; setSelection(null);};
    window.addEventListener('book-navigation-leave', cancel);
    // Keep the original list mounted while the selected chapter loads below
    // the sliding sheet. History and reader props may already have changed.
    const frame = requestAnimationFrame(() => {
      if (!panel.current) {cancel(); return;}
      const animations = panel.current.parentElement!.getAnimations({subtree: true});
      void Promise.allSettled(animations.map(animation => animation.finished)).then(() => {
        if (cancelled || !panel.current?.isConnected) return;
        selecting.current = false; setSelection(null);
      });
    });
    return () => {cancelled = true; cancelAnimationFrame(frame); window.removeEventListener('book-navigation-leave', cancel);};
  }, [selection]);
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
  return <div className="book-catalog-overlay" data-reader={Boolean(onSelect)} data-open={open && !selection} data-selecting={Boolean(selection)} data-chapter-entry={openingChapter} aria-hidden={!open || openingChapter || Boolean(selection)} inert={!open || openingChapter || Boolean(selection)} onClick={onClose}>
    <div ref={panel} role="dialog" aria-modal="true" aria-label="全部目录" className="book-catalog-sheet" onClick={event => event.stopPropagation()}>
      <header className="book-catalog-header">
        <button className="book-catalog-back" onClick={onClose} aria-label="关闭目录"><ArrowLeft size={22}/></button>
        <h2 title={bookTitle}>{bookTitle}</h2><p>{props.catalog.total === null ? '加载中…' : `共 ${props.catalog.total} 章`}</p>
      </header>
      {(open || selection) && <CatalogContents key={`${contents.bookId}:${contents.columns}:${contents.activeChapterId ?? ''}:${contents.catalog.generation}`} {...contents}
        onSelect={onSelect ? (id, title) => {
          if (selecting.current) return;
          selecting.current = true;
          // Raise the opaque catalog before painting the loading paper in the
          // same click. The request and exit animation then run together.
          flushSync(() => setSelection({...props, columns}));
          beginChapterEntry(`/book/${props.bookId}/${id}`, title, 'start', 0);
          onSelect(id, title);
        } : undefined}/>}
    </div>
  </div>;
}

type ContentsProps = Omit<Props, 'open' | 'onClose' | 'bookTitle'> & {columns: number};
function CatalogContents(props: ContentsProps) {
  const {catalog, activeChapterId} = props;
  const activeIndex = catalog.indices.get(activeChapterId ?? '') ?? -1;
  const waiting = !catalog.volumes || (activeChapterId ? activeIndex < 0 && !catalog.resolved.has(activeChapterId) : catalog.total === null || (catalog.total > 0 && !catalog.rows.has(0)));
  if (waiting || !catalog.total) return <div role="region" aria-label="阅读目录" aria-busy={waiting} className="book-catalog-body">
    {catalog.error ? <p role="alert" className="book-catalog-message">{catalog.error} <button onClick={props.onRetry}>重试</button></p>
      : <p role="status" className="book-catalog-message book-catalog-loading">{waiting ? '加载目录…' : '暂无章节'}</p>}
  </div>;
  return <VolumeCatalog {...props} volumes={catalog.volumes!} activeIndex={activeIndex}/>;
}

type VolumeProps = ContentsProps & {volumes: readonly CatalogVolume[]; activeIndex: number};
type View = {expanded: ReadonlySet<string>; targetVolume?: string; focusVolume?: string};
function VolumeCatalog(props: VolumeProps) {
  const {volumes, activeIndex} = props;
  const [view, setView] = useState<View>(() => {
    const initial = volumes.find(volume => activeIndex >= volume.start && activeIndex < volume.start + volume.count)
      ?? volumes.find(volume => volume.title === '正文') ?? volumes[0];
    return {expanded: new Set([initial.id]), targetVolume: activeIndex < 0 ? initial.id : undefined};
  });
  const toggle = (id: string) => setView(previous => {
    const expanded = new Set(previous.expanded);
    if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
    return {...previous, expanded, focusVolume: id};
  });
  // Folding only changes the visible rows; retain the scroller and its ready state.
  return <CatalogVolumeRows {...props} view={view} onToggle={toggle}/>;
}

function CatalogVolumeRows({bookId, catalog, onRange, onRetry, activeChapterId, activeChapterLabel = '正在阅读', onSelect, onPrefetch, columns, volumes, activeIndex, view, onToggle}: VolumeProps & {view: View; onToggle: (id: string) => void}) {
  const listId = useId();
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const [listHeight, setListHeight] = useState(0);
  const [ready, setReady] = useState(false);
  const scrollerRef = useCallback((element: HTMLElement | Window | null) => setScroller(element instanceof HTMLElement ? element : null), []);
  const layout = useMemo(() => catalogLayout(volumes, view.expanded, columns), [volumes, view.expanded, columns]);
  const [initialLocation] = useState(() => ({index: view.targetVolume ? layout.groups.find(group => group.volume.id === view.targetVolume)?.header ?? 0 : layout.chapter(activeIndex), align: view.targetVolume ? 'start' as const : 'center' as const}));
  const itemKey = useCallback((rowIndex: number) => {
    const {group, chapterStart} = layout.at(rowIndex);
    return chapterStart === null ? `volume:${group.volume.id}` : `chapter:${chapterStart}`;
  }, [layout]);
  const rangeChanged = useCallback(({startIndex, endIndex}: {startIndex: number; endIndex: number}) => {
    for (const group of layout.groups) {
      const start = Math.max(startIndex, group.header + 1), end = Math.min(endIndex, group.header + group.rows);
      if (start <= end) onRange(group.volume.start + (start - group.header - 1) * columns,
        Math.min(group.volume.start + group.volume.count - 1, group.volume.start + (end - group.header) * columns - 1));
    }
  }, [layout, onRange, columns]);
  useLayoutEffect(() => {
    if (!scroller || ready) return;
    let frame = 0, stableFrames = 0, previousTop = -1, previousHeight = -1;
    const revealWhenLocated = () => {
      const target = scroller.querySelector<HTMLElement>(view.targetVolume ? `[data-volume-id="${CSS.escape(view.targetVolume)}"]` : '[aria-current="location"]');
      const viewport = scroller.getBoundingClientRect(), item = (target?.closest('.book-catalog-row') ?? target)?.getBoundingClientRect();
      const maximum = scroller.scrollHeight - scroller.clientHeight;
      const desiredTop = item ? Math.max(0, Math.min(maximum, scroller.scrollTop + item.top - viewport.top - (view.targetVolume ? 0 : (viewport.height - item.height) / 2))) : -1;
      const located = target && getComputedStyle(target).visibility === 'visible' && item && listHeight > 0 && viewport.height > 0 && item.bottom > viewport.top && item.top < viewport.bottom
        && Math.abs(desiredTop - scroller.scrollTop) < 2;
      stableFrames = located && scroller.scrollTop === previousTop && scroller.scrollHeight === previousHeight ? stableFrames + 1 : 0;
      previousTop = scroller.scrollTop; previousHeight = scroller.scrollHeight;
      if (stableFrames >= 2) {
        setReady(true);
      } else frame = requestAnimationFrame(revealWhenLocated);
    };
    frame = requestAnimationFrame(revealWhenLocated);
    return () => cancelAnimationFrame(frame);
  }, [scroller, ready, listHeight, view.targetVolume, view.focusVolume]);
  useEffect(() => {
    if (!ready || !view.focusVolume) return;
    const id = view.focusVolume;
    // Let the virtual list finish its visibility update before restoring focus.
    const frame = requestAnimationFrame(() => {
      const target = scroller?.querySelector<HTMLElement>(`[data-volume-id="${CSS.escape(id)}"]`);
      target?.focus({preventScroll: true});
    });
    return () => cancelAnimationFrame(frame);
  }, [ready, scroller, view.focusVolume, view.expanded]);
  return <div role="region" aria-label="阅读目录" aria-busy={!ready} className="book-catalog-body">
    {!ready && !catalog.error && <p role="status" className="book-catalog-message book-catalog-loading">加载目录…</p>}
    {catalog.error && <p role="alert" className="book-catalog-message">{catalog.error} <button onClick={onRetry}>重试</button></p>}
    <div className="book-catalog-scroll-area" data-ready={ready} aria-hidden={!ready} inert={!ready}>
      <Virtuoso id={listId} scrollerRef={scrollerRef} totalListHeightChanged={setListHeight} className="book-catalog-list" style={{height: '100%'}} totalCount={layout.total} rangeChanged={rangeChanged}
        defaultItemHeight={48} initialTopMostItemIndex={initialLocation} computeItemKey={itemKey}
        itemContent={rowIndex => {
          const {group, chapterStart} = layout.at(rowIndex), {volume} = group;
          if (chapterStart === null) return <h3 className="book-catalog-volume-heading"><button type="button" data-volume-id={volume.id} className="book-catalog-volume-toggle" aria-expanded={view.expanded.has(volume.id)} aria-controls={listId} onClick={() => onToggle(volume.id)}>
            <ChevronDown size={18} aria-hidden="true"/><span className="book-catalog-volume-title">{volume.title}</span><span className="book-catalog-volume-count">{volume.count} 章</span>
            {activeIndex >= volume.start && activeIndex < volume.start + volume.count && <span className="book-catalog-progress">{activeChapterLabel}</span>}
          </button></h3>;
          return <div className="book-catalog-row" style={{gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`}}>
            {Array.from({length: Math.min(columns, volume.start + volume.count - chapterStart)}, (_, column) => {
              const index = chapterStart + column, chapter = catalog.rows.get(index);
              if (!chapter) return <span key={index} className="book-catalog-placeholder" aria-label="章节加载中"/>;
              const title = formatChapterTitle(splitCatalogTitle(chapter.title).chapterTitle, chapter.chapter_number);
              return <Link key={chapter.id} href={`/book/${bookId}/${chapter.id}`} prefetchMode="intent"
                className="book-catalog-chapter" aria-current={chapter.id === activeChapterId ? 'location' : undefined}
                aria-description={chapter.id === activeChapterId ? activeChapterLabel : undefined}
                onMouseEnter={() => onPrefetch?.(chapter.id)} onFocus={() => onPrefetch?.(chapter.id)} onTouchStart={() => onPrefetch?.(chapter.id)}
                onNavigate={event => {
                  const entryTitle = formatChapterTitle(chapter.title, chapter.chapter_number);
                  if (onSelect) {event.preventDefault(); onSelect(chapter.id, entryTitle);}
                  else beginChapterEntry(`/book/${bookId}/${chapter.id}`, entryTitle);
                }}>
                <span>{title}</span>
                {chapter.id === activeChapterId && <span aria-hidden="true" className="book-catalog-progress">{activeChapterLabel}</span>}
              </Link>;
            })}
          </div>;
        }}/>
      <CatalogScrollbar scroller={scroller} contentHeight={listHeight} controls={listId}/>
    </div>
  </div>;
}
