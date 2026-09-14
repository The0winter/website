'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, BookOpen, ChevronLeft, ChevronRight, FilePenLine, PenTool, Plus, BarChart3, LockKeyhole } from 'lucide-react';
import {LoadingLogo, LoadingText} from './BrandLoading';
import { useAuth } from '@/contexts/AuthContext';
import { booksApi, type Book } from '@/lib/api';
import BookCover from './BookCover';
import Link from './PrefetchLink';
import './mobile-writer.css';
import WorkActions from './WorkActions';
import MobileWriterView, { historyWriterViews, type WriterView } from './MobileWriterView';
import {lockBodyScroll} from '@/lib/body-scroll-lock';

type WorksResult = { key: string; books: Book[]; error?: string };

export default function MobileWriterDialog({ onClose }: { onClose: () => void }) {
  const { user, loading: authLoading } = useAuth();
  const dialog = useRef<HTMLDialogElement>(null);
  const dismiss = useRef<() => void>(() => {});
  const navigate = useRef<() => void>(() => {});
  const [views, setViews] = useState<WriterView[]>(historyWriterViews);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const viewFocus = useRef(new Map<string, HTMLElement>());
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<WorksResult>();
  const entered = useRef(false);
  const pendingResult = useRef<WorksResult | null>(null);
  const key = `${user?.id}:${page}:${retry}:${refreshVersion}`;
  const books = result?.key === key ? result.books : [];
  const error = result?.key === key ? result.error : undefined;
  const loading = authLoading || Boolean(user && result?.key !== key);
  const userId = user?.id;
  const onCloseRef = useRef(onClose);
  const historyMarker = useRef<string | null>(null);
  const backPending = useRef(false);
  const finishOpening = useCallback(() => {
    if (dialog.current?.dataset.closing === 'true') return;
    entered.current = true;
    if (dialog.current) dialog.current.dataset.ready = 'true';
    if (pendingResult.current) { setResult(pendingResult.current); pendingResult.current = null; }
  }, []);

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const element = dialog.current!;
    const previousFocus = document.activeElement as HTMLElement | null;
    const unlockScroll = lockBodyScroll();
    const marker = historyMarker.current || history.state?.mobileWriter || crypto.randomUUID();
    let closing = false;
    let disposed = false;
    let finished = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = () => {
      if (finished || disposed) return;
      finished = true;
      element.close(); onCloseRef.current();
    };
    const animateClose = () => {
      if (closing) return;
      closing = true;
      const reveal = getComputedStyle(element.querySelector('.mw-reveal')!);
      const content = getComputedStyle(element.querySelector('.mw-scroll')!);
      element.style.setProperty('--mw-close-transform', reveal.transform === 'none' ? 'scale(1)' : reveal.transform);
      element.style.setProperty('--mw-close-content-transform', content.transform === 'none' ? 'translate3d(0,0,0)' : content.transform);
      element.style.setProperty('--mw-close-content-opacity', content.opacity);
      element.dataset.closing = 'true';
      timer = setTimeout(finish, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 260);
    };
    const pop = () => {
      const form = element.querySelector<HTMLElement>('.mw-view:not([inert]) .writer-dirty-form');
      const viewId = form?.closest<HTMLElement>('.mw-view')?.dataset.viewId;
      const removing = history.state?.mobileWriter !== marker || !historyWriterViews().some(view => view.id === viewId);
      if (form && removing) {
        const warning = form.classList.contains('work-create-form') ? '作品还未创建，确定关闭？已填写的内容不会保存。' : '还有未保存的内容，确定关闭？可以先保存草稿，之后继续整理。';
        if (form.dataset.busy === 'true' || (form.dataset.dirty === 'true' && !confirm(warning))) {
          history.forward(); return;
        }
        form.dataset.dirty = 'false';
      }
      if (history.state?.mobileWriter !== marker) { animateClose(); return; }
      // A cancelled native traversal or Forward can restore this visit before
      // its exit animation ends. The old timer must not tear it down later.
      closing = false;
      clearTimeout(timer);
      delete element.dataset.closing;
      const next = historyWriterViews();
      backPending.current = [...element.querySelectorAll<HTMLElement>('.mw-view')].some(view => !next.some(item => item.id === view.dataset.viewId));
      setViews(previous => [...next, ...previous.filter(view => !next.some(item => item.id === view.id)).map(view => ({ ...view, closing: true }))]);
    };
    dismiss.current = () => {
      if (backPending.current || closing) return;
      if (history.state?.mobileWriter === marker) { backPending.current = true; history.back(); }
      else animateClose();
    };
    const nativeClose = () => {
      if (disposed || finished || element.open) return;
      // Older browsers can close a dialog despite preventDefault on a
      // non-cancelable close request. Keep DOM visibility in sync with history.
      if (!closing && history.state?.mobileWriter === marker) element.showModal();
      else finish();
    };
    const clearHistoryMarker = () => {
      if (history.state?.mobileWriter === marker) {
        const state = { ...history.state };
        delete state.mobileWriter;
        delete state.mobileWriterViews;
        history.replaceState(state, '', location.href);
      }
    };
    navigate.current = clearHistoryMarker;
    if (historyMarker.current || history.state?.mobileWriter) history.replaceState({ ...history.state, mobileWriter: marker }, '', location.href);
    else history.pushState({ ...history.state, mobileWriter: marker }, '', location.href);
    historyMarker.current = marker;
    const sizeReveal = () => {
      const radius = Math.hypot(innerWidth, innerHeight) + 2;
      element.style.setProperty('--mw-reveal-radius', `${radius}px`);
      element.style.setProperty('--mw-reveal-start', String(76 / radius));
    };
    sizeReveal();
    // Child views already have real history entries. A second native close
    // watcher would consume system Back and eventually force-close the whole
    // retained dialog when its cancel event is no longer cancelable.
    element.setAttribute('closedby', 'none');
    element.addEventListener('close', nativeClose);
    element.showModal();
    window.addEventListener('popstate', pop);
    const desktop = matchMedia('(min-width: 768px)');
    const resize = () => { if (desktop.matches) history.go(-(historyWriterViews().length + 1)); };
    desktop.addEventListener('change', resize);
    window.addEventListener('resize', sizeReveal);
    // Animation events can be interrupted when the tab or motion setting changes.
    const openingTimer = setTimeout(finishOpening, 380);
    return () => {
      disposed = true;
      clearTimeout(timer);
      clearTimeout(openingTimer);
      window.removeEventListener('popstate', pop);
      desktop.removeEventListener('change', resize);
      window.removeEventListener('resize', sizeReveal);
      element.removeEventListener('close', nativeClose);
      unlockScroll();
      if (element.open) element.close();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [finishOpening]);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    const accept = (next: WorksResult) => {
      if (!active) return;
      // Keep list mounting, cover decoding and link prefetch out of the reveal.
      if (entered.current) setResult(next);
      else pendingResult.current = next;
    };
    booksApi.getMyBooks(userId, page).then(books => {
      accept({ key, books });
    }).catch(() => { accept({ key, books: [], error: '作品暂时加载失败，请重试。' }); });
    return () => { active = false; };
  }, [userId, page, key, refreshVersion]);

  const openView = (href: string) => {
    finishOpening();
    const entry = new URL(href, location.href).search.slice(1);
    const view = { id: crypto.randomUUID(), entry };
    const previousFocus = document.activeElement;
    if (previousFocus instanceof HTMLElement) viewFocus.current.set(view.id, previousFocus);
    const next = [...historyWriterViews(), view];
    history.pushState({ ...history.state, mobileWriterViews: next }, '', location.href);
    setViews(next);
  };
  const exitView = (id: string) => {
    backPending.current = false;
    setViews(previous => previous.filter(view => view.id !== id || !view.closing));
    requestAnimationFrame(() => {
      viewFocus.current.get(id)?.focus({ preventScroll: true });
      viewFocus.current.delete(id);
    });
  };
  const worksChanged = useCallback(() => setRefreshVersion(value => value + 1), []);
  const viewWorksChanged = useCallback(() => {
    setPage(1);
    dialog.current?.querySelector('.mw-scroll')?.scrollTo({top:0});
    worksChanged();
  }, [worksChanged]);

  const writerHref = (book: Book) => `/writer?action=chapters&work=${encodeURIComponent(book.manuscriptKey ? `m_${book.manuscriptKey}` : `b_${book.id}`)}&from=creation`;

  return createPortal(<dialog ref={dialog} className="mw-dialog" aria-labelledby="mw-title" onCancel={event => { event.preventDefault(); event.stopPropagation(); dismiss.current(); }} onKeyDown={event => {
    if (event.key !== 'Escape' || event.defaultPrevented || (event.target as Element).closest('dialog') !== event.currentTarget) return;
    event.preventDefault(); event.stopPropagation(); dismiss.current();
  }}>
    <div className="mw-reveal" aria-hidden="true"/>
    <div className="mw-scroll" inert={views.length > 0} aria-hidden={views.length > 0 || undefined} onAnimationEnd={event => { if (event.target === event.currentTarget && event.animationName === 'mw-content-in') finishOpening(); }}>
      <header className="mw-header"><button type="button" className="mw-back" aria-label="返回上一页" onClick={() => dismiss.current()}><ArrowLeft size={21}/></button><h2 id="mw-title">创作中心</h2></header>
      <section className="mw-welcome"><h3>每个故事，都有意义</h3><span className="mw-pen" aria-hidden="true"><PenTool size={24}/></span></section>
      {authLoading ? <p className="mw-status" role="status"><LoadingLogo size={28}/><LoadingText>正在确认登录状态</LoadingText></p> : !user ? <section className="mw-guest"><FilePenLine size={32}/><h3>你的故事，值得被读到</h3><p>登录后创建作品、保存草稿，<br/>也可以接着写上次未完成的章节。</p><Link prefetchMode="intent" href="/login" className="mw-primary" onNavigate={() => navigate.current()}>登录并开始创作<ArrowRight size={17}/></Link></section> : <>
        <div className="mw-actions"><Link prefetchMode="intent" href="/writer?action=new&from=creation" className="mw-action mw-action-primary" onNavigate={event => { event.preventDefault(); openView("/writer?action=new&from=creation"); }}><Plus size={23}/><strong>新建作品</strong><span>开启一个新故事</span></Link><Link prefetchMode="intent" href="/writer?action=statistics&from=creation" className="mw-action" onNavigate={event => { event.preventDefault(); openView("/writer?action=statistics&from=creation"); }}><BarChart3 size={23}/><strong>作品数据</strong><span>浏览趋势 · 阅读统计</span></Link></div>
        <section className="mw-works" aria-label="我的作品"><div className="mw-section-heading"><h3>我的作品</h3></div>
          {loading ? <p className="mw-status" role="status"><LoadingLogo size={28}/><LoadingText>正在翻开你的作品</LoadingText></p> : error ? <div className="mw-status" role="alert"><p>{error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>重新加载</button></div> : books.length ? <div className="mw-book-list">{books.map(book => <article className="mw-book" key={book.id}>
            <div className="mw-cover">{book.cover_image ? <BookCover src={book.cover_image} alt={`${book.title}封面`} sizes="120px"/> : <BookOpen size={40}/>}</div>
            <div className="mw-book-info"><h4>{book.title}</h4>{book.visibility === 'private' ? <span className="work-private"><LockKeyhole size={12}/>私密</span> : <p>{['completed', '完结'].includes(book.status || '') ? '已完结' : '连载中'}</p>}</div>
            <div className="mw-book-actions">
              <WorkActions book={book} onChanged={() => {if (books.length === 1 && page > 1) setPage(page - 1); worksChanged();}}/>
              <Link prefetchMode="intent" href={writerHref(book)} onNavigate={event => { event.preventDefault(); openView(writerHref(book)); }}>创作</Link>
            </div>
          </article>)}</div> : <div className="mw-empty"><FilePenLine size={34}/><h4>{page === 1 ? '第一部作品，从这里开始' : '这一页还没有作品'}</h4><p>{page === 1 ? '先给故事起个名字，再慢慢写下它的世界。' : '返回上一页，继续你的故事。'}</p></div>}
          {(page > 1 || books.length === 20) && <nav className="mw-pagination" aria-label="作品分页"><button type="button" disabled={loading || page === 1} onClick={() => setPage(value => value - 1)}><ChevronLeft size={17}/>上一页</button><span>{page}</span><button type="button" disabled={loading || Boolean(error) || books.length < 20} onClick={() => setPage(value => value + 1)}>下一页<ChevronRight size={17}/></button></nav>}
        </section>
      </>}
    </div>
    {views.map((view, index) => <MobileWriterView key={view.id} view={view} covered={index < views.length - 1} onBack={() => dismiss.current()} onExited={exitView} onChanged={viewWorksChanged}/>)}
  </dialog>, document.body);
}
