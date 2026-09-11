'use client';
import BookCover from '@/components/BookCover';

import {Suspense, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type PointerEvent} from 'react';
import {usePathname, useRouter, useSearchParams} from 'next/navigation';
import Link from 'next/link';
import {ArrowUpDown, BookOpen, Check, ChevronRight, History, MoreHorizontal, Trash2} from 'lucide-react';
import BookLink from '@/components/BookLink';
import PrefetchLink from '@/components/PrefetchLink';
import HomeSearchHeader from '@/components/HomeSearchHeader';
import MobileBottomNav from '@/components/MobileBottomNav';
import AccountLoading from '@/components/AccountLoading';
import {useAuth} from '@/contexts/AuthContext';
import {useReadingSettings} from '@/contexts/ReadingSettingsContext';
import {useStoredState} from '@/lib/useStoredState';
import {safeFetch} from '@/lib/request';
import {getLibrarySnapshot, loadLibrary, removeLibraryEntries, serverLibrarySnapshot, subscribeLibrary, type LibraryEntry as Entry, type LibrarySort as Sort, type LibraryTab as Tab} from '@/lib/library-cache';
import {syncBookRoute} from '@/lib/book-navigation';
import {formatRelativeUpdate} from '@/lib/relative-update';
import {lastReadChapter, serverLastReadChapter, subscribeReadingSession} from '@/lib/reading-session';
import type {Book} from '@/lib/api';
import './library.css';

const sorts = {combined: '综合排序（默认）', read: '按最近阅读排序', updated: '按最近更新排序'};

function Cover({book}: {book: Book | null}) {
  const [failed, setFailed] = useState(false);
  return <div className="shelf-cover">{book?.cover_image && !failed ? <BookCover src={book.cover_image} alt={`${book.title}封面`} onError={() => setFailed(true)}/> : <><BookOpen size={24}/><span>{book?.title || '作品暂不可用'}</span></>}</div>;
}

function RemoveDialog({entries, tab, busy, error, onClose, onRemove}: {entries: Entry[]; tab: Tab; busy: boolean; error: string; onClose: () => void; onRemove: () => void}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {ref.current?.showModal();}, []);
  return <dialog ref={ref} className="shelf-dialog" aria-labelledby="remove-title" onCancel={event => {event.preventDefault(); if (!busy) onClose();}}>
    <h2 id="remove-title">{tab === 'shelf' ? `删除${entries.length > 1 ? `选中的 ${entries.length} 本书` : '这本书'}？` : `删除${entries.length > 1 ? `选中的 ${entries.length} 条浏览记录` : '这条浏览记录'}？`}</h2>
    <p>{entries.length === 1 ? `《${entries[0].book?.title || '作品暂不可用'}》` : '这些书'}{tab === 'shelf' ? '将移出书架，阅读记录会保留，之后可以重新加入。' : '的浏览和阅读进度将被清除，书架收藏会保留。'}</p>
    {error && <p role="alert">{error}</p>}
    <div><button autoFocus disabled={busy} onClick={onClose}>取消</button><button className="shelf-danger" disabled={busy} onClick={onRemove}>{busy ? '正在删除…' : '确认删除'}</button></div>
  </dialog>;
}

function ShelfRow({entry, tab, managing, selected, menuOpen, onMenu, onManage, onSelect, onRemove}: {
  entry: Entry; tab: Tab; managing: boolean; selected: boolean; menuOpen: boolean;
  onMenu: (open: boolean) => void; onManage: () => void; onSelect: () => void; onRemove: () => void;
}) {
  const title = entry.book?.title || '作品暂不可用';
  const recentChapter = useSyncExternalStore(subscribeReadingSession, () => lastReadChapter(entry.bookId), serverLastReadChapter);
  const readingChapter = recentChapter || entry.chapterId || entry.firstChapterId;
  const [readingError, setReadingError] = useState('');
  const press = useRef<{timer: ReturnType<typeof setTimeout>; x: number; y: number} | null>(null);
  const suppressClick = useRef(false);
  const menu = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const [menuAbove, setMenuAbove] = useState(false);
  function cancelPress() {if (press.current) clearTimeout(press.current.timer); press.current = null;}
  useEffect(() => {
    window.addEventListener('scroll', cancelPress, true);
    window.addEventListener('blur', cancelPress);
    return () => {cancelPress(); window.removeEventListener('scroll', cancelPress, true); window.removeEventListener('blur', cancelPress);};
  }, []);
  useEffect(() => {if (managing) cancelPress();}, [managing]);
  useEffect(() => {
    if (!menuOpen) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
    const dismiss = (event: globalThis.PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !menuButton.current?.contains(event.target as Node)) onMenu(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [menuOpen, onMenu]);
  function startPress(event: PointerEvent) {
    cancelPress(); suppressClick.current = false;
    if (managing || !event.isPrimary || event.button !== 0) return;
    press.current = {x: event.clientX, y: event.clientY, timer: setTimeout(() => {
      press.current = null; suppressClick.current = true; onManage();
    }, 500)};
  }
  return <article className="shelf-row" data-selected={selected} onPointerDownCapture={() => {suppressClick.current = false;}} onClickCapture={event => {
    // Touch release can land on the new checkbox after the row slides right.
    if (suppressClick.current) {event.preventDefault(); event.stopPropagation(); suppressClick.current = false;}
  }}>
    <div className="shelf-selection" aria-hidden={!managing}>
      <button type="button" role="checkbox" className="shelf-select" aria-checked={selected} aria-label={`选择：${title}`} tabIndex={managing ? 0 : -1} disabled={!managing} onClick={onSelect}><span>{selected && <Check size={14} strokeWidth={3}/>}</span></button>
    </div>
    <PrefetchLink href={readingChapter ? `/book/${entry.bookId}/${readingChapter}` : `/book/${entry.bookId}`} pendingLabel="正在打开章节…" className="shelf-book" aria-label={title} aria-disabled={!entry.book && !managing} tabIndex={managing ? -1 : 0}
      onPointerDown={startPress} onPointerUp={cancelPress} onPointerCancel={cancelPress} onPointerLeave={cancelPress}
      onPointerMove={event => {if (press.current && Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > 10) {suppressClick.current = true; cancelPress();}}}
      onContextMenu={event => event.preventDefault()} onDragStart={event => event.preventDefault()}
      onClick={event => {
        if (managing) {event.preventDefault(); onSelect();}
        else if (!entry.book) event.preventDefault();
        else if (!readingChapter) {event.preventDefault(); setReadingError('暂无可读章节');}
      }}>
      <Cover book={entry.book}/>
      <div className="shelf-info"><h2>{title}</h2>
        <p>{entry.book ? `${entry.book.author || '未知作者'} · ${['完结', 'completed'].includes(entry.book.status || '') ? '完结' : '连载'}` : '原记录已保留，可稍后重试或移除'}</p>
        {entry.book && <><p className="shelf-progress">{entry.chapterTitle ? `读至 · ${entry.chapterTitle}` : tab === 'history' ? '已浏览 · 还未开始阅读' : '还未开始阅读'}</p><p className="shelf-update">{formatRelativeUpdate(entry.book.lastUpdated)}{entry.latestChapterTitle ? ` · ${entry.latestChapterTitle}` : ''}</p></>}
        {readingError && <p role="status">{readingError}</p>}
      </div>
    </PrefetchLink>
    {!managing && <div className="shelf-more">
      <button ref={menuButton} className="shelf-more-button" aria-label={`更多：${title}`} aria-haspopup="menu" aria-expanded={menuOpen} aria-controls={menuOpen ? `shelf-menu-${entry.bookId}` : undefined} onClick={event => {
        const navTop = event.currentTarget.closest('.library-page')?.querySelector('.mh-bottom')?.getBoundingClientRect().top;
        const bottom = Math.min(window.innerHeight, navTop || window.innerHeight);
        setMenuAbove(event.currentTarget.getBoundingClientRect().bottom + 112 > bottom);
        onMenu(!menuOpen);
      }}><MoreHorizontal size={20}/></button>
      {menuOpen && <div ref={menu} id={`shelf-menu-${entry.bookId}`} className="shelf-menu" data-above={menuAbove} role="menu" aria-label={`${title}的操作`} onBlur={event => {if (!event.currentTarget.contains(event.relatedTarget as Node) && event.relatedTarget !== menuButton.current) onMenu(false);}} onKeyDown={event => {
        if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); onMenu(false); menuButton.current?.focus();}
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault(); const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)'));
          const current = items.indexOf(document.activeElement as HTMLElement);
          items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length]?.focus();
        }
      }}>
        {entry.book ? <BookLink role="menuitem" href={`/book/${entry.bookId}`} onClick={() => onMenu(false)}><BookOpen size={16}/>详情</BookLink> : <button role="menuitem" disabled><BookOpen size={16}/>详情</button>}
        <button role="menuitem" className="shelf-menu-delete" onClick={() => {onMenu(false); onRemove();}}><Trash2 size={16}/>删除</button>
      </div>}
    </div>}
  </article>;
}

export default function LibraryPage() {
  return <Suspense fallback={<AccountLoading checking/>}><Library/></Suspense>;
}

function Library() {
  const {user, loading: authLoading} = useAuth();
  const {setTheme} = useReadingSettings();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const tab: Tab = search.get('tab') === 'history' ? 'history' : 'shelf';
  const [savedSort, setSort] = useStoredState<Sort>('library-sort', 'combined', value => typeof value === 'string' && Object.hasOwn(sorts, value));
  const requestedSort = search.get('sort');
  const sort = requestedSort && Object.hasOwn(sorts, requestedSort) ? requestedSort as Sort : savedSort;
  const requestedPage = Number(search.get('page') || 1);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 && requestedPage <= 100000 ? requestedPage : 1;
  const [managing, setManaging] = useState(false);
  const [selected, setSelected] = useState<Entry[]>([]);
  const [menu, setMenu] = useState<string | null>(null);
  const [targets, setTargets] = useState<Entry[] | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState('');
  const management = useRef<{token: string; afterClose?: () => void} | null>(null);
  const removalVersion = useRef({value: 0});
  const userId = user?.id;
  const query = {userId: userId || '', tab, sort, page};
  const result = useSyncExternalStore(subscribeLibrary, () => getLibrarySnapshot(query), serverLibrarySnapshot);
  const loading = result.rows === null && !result.error;
  const rows = result.rows || [];
  const searchString = search.toString();
  useLayoutEffect(() => {syncBookRoute('/library' + (searchString ? `?${searchString}` : ''));}, [searchString]);
  useEffect(() => {setTheme('light');}, [setTheme]);
  useEffect(() => {if (!authLoading && !user) router.replace('/login');}, [authLoading, user, router]);
  useEffect(() => {
    if (userId && pathname === '/library') void loadLibrary({userId, tab, sort, page});
  }, [userId, tab, sort, page, pathname, result.updatedAt]);
  useEffect(() => {
    const versionState = removalVersion.current;
    const popped = (event: PopStateEvent) => {
      const current = management.current;
      if (!current || event.state?.libraryManagement === current.token) return;
      management.current = null;
      removalVersion.current.value++;
      setManaging(false); setSelected([]); setTargets(null); setRemoveError(''); setMenu(null);
      current.afterClose?.();
    };
    window.addEventListener('popstate', popped);
    return () => {window.removeEventListener('popstate', popped); versionState.value++;};
  }, []);

  function startManaging(entry?: Entry) {
    if (management.current) return;
    const token = crypto.randomUUID();
    management.current = {token};
    history.pushState({...history.state, libraryManagement: token}, '', location.href);
    setManaging(true); setMenu(null); setSelected(entry ? [entry] : []);
  }

  function finishManaging(afterClose?: () => void) {
    const current = management.current;
    if (current && history.state?.libraryManagement === current.token) {
      if (current.afterClose) return;
      current.afterClose = afterClose || (() => {});
      history.back();
    } else {
      management.current = null; removalVersion.current.value++;
      setManaging(false); setSelected([]); setTargets(null); setMenu(null);
      afterClose?.();
    }
  }

  function confirmRemove(entries: Entry[]) {
    if (!entries.length || removing) return;
    removalVersion.current.value++;
    setTargets(entries); setRemoveError('');
  }

  function changeView(nextTab = tab, nextPage = page, nextSort = sort) {
    const params = new URLSearchParams();
    if (nextTab === 'history') params.set('tab', nextTab);
    params.set('sort', nextSort);
    if (nextPage > 1) params.set('page', String(nextPage));
    const change = () => {setMenu(null); history.replaceState({}, '', '/library?' + params);};
    if (management.current) finishManaging(change);
    else change();
  }

  async function remove() {
    if (!targets?.length || !userId || removing) return;
    const version = removalVersion.current.value;
    setRemoving(true); setRemoveError('');
    try {
      const deleted: string[] = [], failed: Entry[] = [];
      // Keep requests bounded; failed items remain selected for a safe retry.
      for (let index = 0; index < targets.length; index += 3) {
        await Promise.all(targets.slice(index, index + 3).map(async entry => {
          try {
            const response = await safeFetch(`/api/users/${userId}/${tab === 'shelf' ? 'bookmarks' : 'history'}/${entry.bookId}`, {method: 'DELETE'});
            if (!response.ok) throw new Error();
            deleted.push(entry.bookId);
          } catch {failed.push(entry);}
        }));
      }
      removeLibraryEntries(userId, tab, deleted);
      if (version !== removalVersion.current.value) return;
      const nextPage = Math.min(page, Math.max(1, Math.ceil((result.total - deleted.length) / 20)));
      if (failed.length) {
        setTargets(failed); setSelected(failed);
        setRemoveError(deleted.length ? `已删除 ${deleted.length} 项，剩余 ${failed.length} 项操作失败，请重试。` : '操作失败，请重试');
      } else {
        setTargets(null);
        finishManaging(() => {if (nextPage !== page) changeView(tab, nextPage);});
      }
      await loadLibrary({...query, page: failed.length ? page : nextPage}, true);
    }
    finally {setRemoving(false);}
  }

  if (authLoading || !user) return <AccountLoading checking={authLoading}/>;
  return <div className="library-page" data-managing={managing} onKeyDown={event => {if (event.key === 'Escape' && managing && !targets) {event.preventDefault(); finishManaging();}}}>
    <div className="library-inner">
      <h1 className="sr-only">我的书架</h1>
      <div inert={managing}><HomeSearchHeader/></div>
      <section className="shelf-panel" aria-label="个人书架">
        <header className="shelf-toolbar">
          <div className="shelf-tabs" role="tablist" aria-label="书架与浏览记录">
            {(['shelf', 'history'] as const).map(value => <button key={value} id={`tab-${value}`} role="tab" aria-selected={tab === value} aria-controls="shelf-content" onClick={() => changeView(value, 1)}>{value === 'shelf' ? '书架' : '浏览记录'}</button>)}
          </div>
          <div className="shelf-actions">
            <button aria-pressed={managing} disabled={!managing && !rows.length} onClick={() => managing ? finishManaging() : startManaging()}>{managing ? '返回' : '管理'}</button>
            <label className="shelf-sort" title={sorts[sort]}><span>排序</span><ArrowUpDown size={13}/><select aria-label="书架排序" value={sort} onChange={event => {const value = event.target.value as Sort; setSort(value); changeView(tab, 1, value);}}>{Object.entries(sorts).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          </div>
        </header>
        <div id="shelf-content" role="tabpanel" aria-labelledby={`tab-${tab}`} aria-busy={loading}>
          {result.error && result.rows !== null && <p className="shelf-refresh-error" role="alert">更新暂时失败，已保留上次的书架。<button onClick={() => void loadLibrary(query, true)}>重试</button></p>}
          {loading ? <div className="shelf-empty" role="status"><BookOpen size={32}/><p>正在整理你的书架…</p></div> : result.error && result.rows === null ? <div className="shelf-empty" role="alert"><p>{result.error}</p><button onClick={() => void loadLibrary(query, true)}>重新加载</button></div> : rows.length === 0 ? <div className="shelf-empty">
            <div className="shelf-empty-icon">{tab === 'shelf' ? <BookOpen size={32}/> : <History size={32}/>}</div>
            <h2>{tab === 'shelf' ? '把喜欢的故事，放进书架' : '读过的故事，在这里重逢'}</h2>
            <p>{tab === 'shelf' ? '找到喜欢的书，加入书架就能随时接着读。' : '浏览书籍或开始阅读后，记录会自动保存在这里。'}</p>
            <Link href="/">去发现好书 <ChevronRight size={15}/></Link>
          </div> : <>
            <div className="shelf-rows">{rows.map(entry => <ShelfRow key={entry.bookId} entry={entry} tab={tab} managing={managing} selected={selected.some(item => item.bookId === entry.bookId)} menuOpen={menu === entry.bookId}
              onMenu={open => setMenu(open ? entry.bookId : null)} onManage={() => startManaging(entry)}
              onSelect={() => setSelected(current => current.some(item => item.bookId === entry.bookId) ? current.filter(item => item.bookId !== entry.bookId) : [...current, entry])}
              onRemove={() => confirmRemove([entry])}/>)}</div>
            {result.total <= 2 && !managing && <div className="shelf-discover"><span>下一本好书，等你发现</span><Link href="/">去精选 <ChevronRight size={14}/></Link></div>}
            {result.total > 20 && <nav className="shelf-pagination" aria-label={tab === 'shelf' ? '书架分页' : '浏览记录分页'}><button disabled={page === 1} onClick={() => changeView(tab, page - 1)}>上一页</button><span>{page} / {Math.ceil(result.total / 20)}</span><button disabled={page * 20 >= result.total} onClick={() => changeView(tab, page + 1)}>下一页</button></nav>}
          </>}
        </div>
      </section>
    </div>
    {managing ? <div className="shelf-management-bar" role="region" aria-label="书架管理"><div>
      <span role="status">已选 {selected.length} {tab === 'shelf' ? '本' : '项'}</span>
      <button className="shelf-delete-selected" disabled={!selected.length || removing} onClick={() => confirmRemove(selected)}><Trash2 size={18}/>{selected.length ? `删除（${selected.length}）` : '删除'}</button>
    </div></div> : <MobileBottomNav/>}
    {targets && <RemoveDialog entries={targets} tab={tab} busy={removing} error={removeError} onClose={() => {removalVersion.current.value++; setTargets(null);}} onRemove={remove}/>}
  </div>;
}
