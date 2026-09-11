'use client';

import {Suspense, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore} from 'react';
import {usePathname, useRouter, useSearchParams} from 'next/navigation';
import Link from 'next/link';
import {ArrowUpDown, BookOpen, ChevronRight, History, Trash2} from 'lucide-react';
import BookLink from '@/components/BookLink';
import ReadingEntryLink from '@/components/ReadingEntryLink';
import HomeSearchHeader from '@/components/HomeSearchHeader';
import MobileBottomNav from '@/components/MobileBottomNav';
import AccountLoading from '@/components/AccountLoading';
import {useAuth} from '@/contexts/AuthContext';
import {useReadingSettings} from '@/contexts/ReadingSettingsContext';
import {useStoredState} from '@/lib/useStoredState';
import {safeFetch} from '@/lib/request';
import {getLibrarySnapshot, loadLibrary, serverLibrarySnapshot, subscribeLibrary, type LibraryEntry as Entry, type LibrarySort as Sort, type LibraryTab as Tab} from '@/lib/library-cache';
import {syncBookRoute} from '@/lib/book-navigation';
import {formatRelativeUpdate} from '@/lib/relative-update';
import type {Book} from '@/lib/api';
import './library.css';

const sorts = {combined: '综合排序（默认）', read: '按最近阅读排序', updated: '按最近更新排序'};

function Cover({book}: {book: Book | null}) {
  const [failed, setFailed] = useState(false);
  return <div className="shelf-cover">{book?.cover_image && !failed ? <img src={book.cover_image} alt={`${book.title}封面`} onError={() => setFailed(true)}/> : <><BookOpen size={24}/><span>{book?.title || '作品暂不可用'}</span></>}</div>;
}

function RemoveDialog({entry, tab, busy, error, onClose, onRemove}: {entry: Entry; tab: Tab; busy: boolean; error: string; onClose: () => void; onRemove: () => void}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {ref.current?.showModal();}, []);
  return <dialog ref={ref} className="shelf-dialog" aria-labelledby="remove-title" onCancel={event => {event.preventDefault(); if (!busy) onClose();}}>
    <h2 id="remove-title">{tab === 'shelf' ? '移出书架？' : '删除这条浏览记录？'}</h2>
    <p>《{entry.book?.title || '作品暂不可用'}》{tab === 'shelf' ? '的阅读记录会保留，之后可以重新加入书架。' : '的浏览和阅读进度将被清除，书架收藏会保留。'}</p>
    {error && <p role="alert">{error}</p>}
    <div><button autoFocus disabled={busy} onClick={onClose}>取消</button><button className="shelf-danger" disabled={busy} onClick={onRemove}>{busy ? '正在处理…' : tab === 'shelf' ? '确认移出' : '确认删除'}</button></div>
  </dialog>;
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
  const [target, setTarget] = useState<Entry | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState('');
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

  function changeView(nextTab = tab, nextPage = page, nextSort = sort) {
    const params = new URLSearchParams();
    if (nextTab === 'history') params.set('tab', nextTab);
    params.set('sort', nextSort);
    if (nextPage > 1) params.set('page', String(nextPage));
    history.replaceState({}, '', '/library?' + params);
  }

  async function remove() {
    if (!target || !userId || removing) return;
    setRemoving(true); setRemoveError('');
    try {
      const response = await safeFetch(`/api/users/${userId}/${tab === 'shelf' ? 'bookmarks' : 'history'}/${target.bookId}`, {method: 'DELETE'});
      if (!response.ok) throw new Error('操作失败，请重试');
      setTarget(null);
      if (rows.length === 1 && page > 1) changeView(tab, page - 1);
      else await loadLibrary(query);
    } catch (error) {setRemoveError(error instanceof Error ? error.message : '操作失败，请重试');}
    finally {setRemoving(false);}
  }

  if (authLoading || !user) return <AccountLoading checking={authLoading}/>;
  return <div className="library-page">
    <div className="library-inner">
      <h1 className="sr-only">我的书架</h1>
      <HomeSearchHeader/>
      <section className="shelf-panel" aria-label="个人书架">
        <header className="shelf-toolbar">
          <div className="shelf-tabs" role="tablist" aria-label="书架与浏览记录">
            {(['shelf', 'history'] as const).map(value => <button key={value} id={`tab-${value}`} role="tab" aria-selected={tab === value} aria-controls="shelf-content" onClick={() => {changeView(value, 1); setManaging(false);}}>{value === 'shelf' ? '书架' : '浏览记录'}</button>)}
          </div>
          <div className="shelf-actions">
            <button aria-pressed={managing} onClick={() => setManaging(!managing)}>{managing ? '完成' : '管理'}</button>
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
            <div className="shelf-rows">{rows.map(entry => <article className="shelf-row" key={entry.bookId}>
              <BookLink href={`/book/${entry.bookId}`} className="shelf-book" aria-label={entry.book?.title || '作品暂不可用'} aria-disabled={!entry.book} onClick={event => {if (!entry.book) event.preventDefault();}}>
                <Cover book={entry.book}/>
                <div className="shelf-info"><h2>{entry.book?.title || '作品暂不可用'}</h2>
                  <p>{entry.book ? `${entry.book.author || '未知作者'} · ${['完结', 'completed'].includes(entry.book.status || '') ? '完结' : '连载'}` : '原记录已保留，可稍后重试或移除'}</p>
                  {entry.book && <><p className="shelf-progress">{entry.chapterTitle ? `读至 · ${entry.chapterTitle}` : tab === 'history' ? '已浏览 · 还未开始阅读' : '还未开始阅读'}</p><p className="shelf-update">{formatRelativeUpdate(entry.book.lastUpdated)}{entry.latestChapterTitle ? ` · ${entry.latestChapterTitle}` : ''}</p></>}
                </div>
              </BookLink>
              {managing ? <button className="shelf-remove" aria-label={`${tab === 'shelf' ? '移出书架' : '删除记录'}：${entry.book?.title || '作品暂不可用'}`} onClick={() => {setTarget(entry); setRemoveError('');}}><Trash2 size={18}/></button> : entry.book && entry.chapterId ? <ReadingEntryLink bookId={entry.bookId} firstChapterId={entry.chapterId} className="shelf-continue" label="继续"/> : null}
            </article>)}</div>
            {result.total <= 2 && !managing && <div className="shelf-discover"><span>下一本好书，等你发现</span><Link href="/">去精选 <ChevronRight size={14}/></Link></div>}
            {result.total > 20 && <nav className="shelf-pagination" aria-label={tab === 'shelf' ? '书架分页' : '浏览记录分页'}><button disabled={page === 1} onClick={() => changeView(tab, page - 1)}>上一页</button><span>{page} / {Math.ceil(result.total / 20)}</span><button disabled={page * 20 >= result.total} onClick={() => changeView(tab, page + 1)}>下一页</button></nav>}
          </>}
        </div>
      </section>
    </div>
    <MobileBottomNav/>
    {target && <RemoveDialog entry={target} tab={tab} busy={removing} error={removeError} onClose={() => setTarget(null)} onRemove={remove}/>}
  </div>;
}
