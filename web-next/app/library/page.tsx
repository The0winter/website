'use client';

import {useEffect, useRef, useState} from 'react';
import {useRouter} from 'next/navigation';
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
import {formatRelativeUpdate} from '@/lib/relative-update';
import type {Book} from '@/lib/api';
import './library.css';

type Tab = 'shelf' | 'history';
type Sort = 'combined' | 'read' | 'updated';
type Entry = {bookId: string; book: Book | null; lastReadAt?: string; lastVisitedAt?: string; chapterId?: string; chapterTitle?: string; latestChapterTitle?: string};
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

export default function Library() {
  const {user, loading: authLoading} = useAuth();
  const {setTheme} = useReadingSettings();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('shelf');
  const [sort, setSort] = useStoredState<Sort>('library-sort', 'combined', value => typeof value === 'string' && Object.hasOwn(sorts, value));
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [managing, setManaging] = useState(false);
  const [target, setTarget] = useState<Entry | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState('');
  const [result, setResult] = useState<{key: string; rows: Entry[]; total: number; error: string}>({key: '', rows: [], total: 0, error: ''});
  const userId = user?.id;
  const key = `${userId}:${tab}:${sort}:${page}:${refresh}`;
  const loading = result.key !== key;
  const rows = loading ? [] : result.rows;
  useEffect(() => {setTheme('light');}, [setTheme]);
  useEffect(() => {if (!authLoading && !user) router.replace('/login');}, [authLoading, user, router]);
  useEffect(() => {
    if (!userId) return;
    let active = true;
    safeFetch(`/api/users/${userId}/library?tab=${tab}&sort=${sort}&page=${page}&limit=20`).then(async response => {
      if (!response.ok) throw new Error('暂时加载失败，请重试');
      const entries: Entry[] = await response.json();
      if (active) setResult({key, rows: entries, total: Number(response.headers.get('X-Total-Count') || entries.length), error: ''});
    }).catch(error => {if (active) setResult({key, rows: [], total: 0, error: error.message});});
    return () => {active = false;};
  }, [userId, tab, sort, page, key]);

  async function remove() {
    if (!target || !userId || removing) return;
    setRemoving(true); setRemoveError('');
    try {
      const response = await safeFetch(`/api/users/${userId}/${tab === 'shelf' ? 'bookmarks' : 'history'}/${target.bookId}`, {method: 'DELETE'});
      if (!response.ok) throw new Error('操作失败，请重试');
      setTarget(null);
      if (rows.length === 1 && page > 1) setPage(page - 1);
      setRefresh(value => value + 1);
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
            {(['shelf', 'history'] as const).map(value => <button key={value} id={`tab-${value}`} role="tab" aria-selected={tab === value} aria-controls="shelf-content" onClick={() => {setTab(value); setPage(1); setManaging(false);}}>{value === 'shelf' ? '书架' : '浏览记录'}</button>)}
          </div>
          <div className="shelf-actions">
            <button aria-pressed={managing} onClick={() => setManaging(!managing)}>{managing ? '完成' : '管理'}</button>
            <label className="shelf-sort" title={sorts[sort]}><span>排序</span><ArrowUpDown size={13}/><select aria-label="书架排序" value={sort} onChange={event => {setSort(event.target.value as Sort); setPage(1);}}>{Object.entries(sorts).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          </div>
        </header>
        <div id="shelf-content" role="tabpanel" aria-labelledby={`tab-${tab}`} aria-busy={loading}>
          {loading ? <div className="shelf-empty" role="status"><BookOpen size={32}/><p>正在整理你的书架…</p></div> : result.error ? <div className="shelf-empty" role="alert"><p>{result.error}</p><button onClick={() => setRefresh(value => value + 1)}>重新加载</button></div> : rows.length === 0 ? <div className="shelf-empty">
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
            {result.total > 20 && <nav className="shelf-pagination" aria-label={tab === 'shelf' ? '书架分页' : '浏览记录分页'}><button disabled={page === 1} onClick={() => setPage(page - 1)}>上一页</button><span>{page} / {Math.ceil(result.total / 20)}</span><button disabled={page * 20 >= result.total} onClick={() => setPage(page + 1)}>下一页</button></nav>}
          </>}
        </div>
      </section>
    </div>
    <MobileBottomNav/>
    {target && <RemoveDialog entry={target} tab={tab} busy={removing} error={removeError} onClose={() => setTarget(null)} onRemove={remove}/>}
  </div>;
}
