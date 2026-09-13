'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, BookOpen, ChevronLeft, ChevronRight, FilePenLine, PenTool, Plus } from 'lucide-react';
import {LoadingLogo, LoadingText} from './BrandLoading';
import { useAuth } from '@/contexts/AuthContext';
import { booksApi, type Book } from '@/lib/api';
import BookCover from './BookCover';
import Link from './PrefetchLink';
import './mobile-writer.css';
import MobileWriterView, { historyWriterViews, type WriterView } from './MobileWriterView';

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
  const key = `${user?.id}:${page}:${retry}`;
  const books = result?.key === key ? result.books : [];
  const error = result?.key === key ? result.error : undefined;
  const loading = authLoading || Boolean(user && result?.key !== key);
  const userId = user?.id;
  const onCloseRef = useRef(onClose);
  const historyMarker = useRef<string | null>(null);
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
    const overflow = document.body.style.overflow;
    const marker = historyMarker.current || history.state?.mobileWriter || crypto.randomUUID();
    let closing = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = () => { element.close(); onCloseRef.current(); };
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
      if (history.state?.mobileWriter !== marker) { animateClose(); return; }
      const next = historyWriterViews();
      setViews(previous => [...next, ...previous.filter(view => !next.some(item => item.id === view.id)).map(view => ({ ...view, closing: true }))]);
    };
    dismiss.current = () => {
      if (history.state?.mobileWriter === marker) history.back();
      else animateClose();
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
    element.showModal();
    document.body.style.overflow = 'hidden';
    window.addEventListener('popstate', pop);
    const desktop = matchMedia('(min-width: 768px)');
    const resize = () => { if (desktop.matches) history.go(-(historyWriterViews().length + 1)); };
    desktop.addEventListener('change', resize);
    window.addEventListener('resize', sizeReveal);
    // Animation events can be interrupted when the tab or motion setting changes.
    const openingTimer = setTimeout(finishOpening, 380);
    return () => {
      clearTimeout(timer);
      clearTimeout(openingTimer);
      window.removeEventListener('popstate', pop);
      desktop.removeEventListener('change', resize);
      window.removeEventListener('resize', sizeReveal);
      document.body.style.overflow = overflow;
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
    setViews(previous => previous.filter(view => view.id !== id || !view.closing));
    requestAnimationFrame(() => {
      viewFocus.current.get(id)?.focus({ preventScroll: true });
      viewFocus.current.delete(id);
    });
  };
  const worksChanged = useCallback(() => setRefreshVersion(value => value + 1), []);

  const writerHref = (book: Book, action: 'write' | 'manage') => `/writer?book=${encodeURIComponent(book.id)}&action=${action}&page=${page}&from=creation`;

  return createPortal(<dialog ref={dialog} className="mw-dialog" aria-labelledby="mw-title" onCancel={event => { event.preventDefault(); dismiss.current(); }}>
    <div className="mw-reveal" aria-hidden="true"/>
    <div className="mw-scroll" inert={views.length > 0} aria-hidden={views.length > 0 || undefined} onAnimationEnd={event => { if (event.target === event.currentTarget && event.animationName === 'mw-content-in') finishOpening(); }}>
      <header className="mw-header"><button type="button" className="mw-back" aria-label="返回上一页" onClick={() => dismiss.current()}><ArrowLeft size={21}/></button><h2 id="mw-title">创作中心</h2></header>
      <section className="mw-welcome"><h3>每个故事，都有意义</h3><span className="mw-pen" aria-hidden="true"><PenTool size={24}/></span></section>
      {authLoading ? <p className="mw-status" role="status"><LoadingLogo size={28}/><LoadingText>正在确认登录状态</LoadingText></p> : !user ? <section className="mw-guest"><FilePenLine size={32}/><h3>你的故事，值得被读到</h3><p>登录后创建作品、保存草稿，<br/>也可以接着写上次未完成的章节。</p><Link prefetchMode="intent" href="/login" className="mw-primary" onNavigate={() => navigate.current()}>登录并开始创作<ArrowRight size={17}/></Link></section> : <>
        <div className="mw-actions"><Link prefetchMode="intent" href="/writer?action=new&from=creation" className="mw-action mw-action-primary" onNavigate={event => { event.preventDefault(); openView("/writer?action=new&from=creation"); }}><Plus size={23}/><strong>新建作品</strong><span>开启一个新故事</span></Link><Link prefetchMode="intent" href="/writer?from=creation" className="mw-action" onNavigate={event => { event.preventDefault(); openView("/writer?from=creation"); }}><BookOpen size={23}/><strong>作品管理</strong><span>章节 · 草稿 · 设置</span></Link></div>
        <section className="mw-works" aria-label="我的作品"><div className="mw-section-heading"><h3>我的作品</h3></div>
          {loading ? <p className="mw-status" role="status"><LoadingLogo size={28}/><LoadingText>正在翻开你的作品</LoadingText></p> : error ? <div className="mw-status" role="alert"><p>{error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>重新加载</button></div> : books.length ? <div className="mw-book-list">{books.map(book => <article className="mw-book" key={book.id}><div className="mw-cover">{book.cover_image ? <BookCover src={book.cover_image} alt={`${book.title}封面`} sizes="64px"/> : <BookOpen size={26}/>}</div><div className="mw-book-info"><h4>{book.title}</h4><p>{book.category || '未分类'} · {['completed', '完结'].includes(book.status || '') ? '已完结' : '连载中'}</p><div><Link prefetchMode="intent" href={writerHref(book, 'write')} onNavigate={event => { event.preventDefault(); openView(writerHref(book, 'write')); }}><PenTool size={14}/>写一章</Link><Link prefetchMode="intent" href={writerHref(book, 'manage')} onNavigate={event => { event.preventDefault(); openView(writerHref(book, 'manage')); }}>目录与草稿<ChevronRight size={14}/></Link></div></div></article>)}</div> : <div className="mw-empty"><FilePenLine size={34}/><h4>{page === 1 ? '第一部作品，从这里开始' : '这一页还没有作品'}</h4><p>{page === 1 ? '先给故事起个名字，再慢慢写下它的世界。' : '返回上一页，继续你的故事。'}</p></div>}
          {(page > 1 || books.length === 20) && <nav className="mw-pagination" aria-label="作品分页"><button type="button" disabled={loading || page === 1} onClick={() => setPage(value => value - 1)}><ChevronLeft size={17}/>上一页</button><span>{page}</span><button type="button" disabled={loading || Boolean(error) || books.length < 20} onClick={() => setPage(value => value + 1)}>下一页<ChevronRight size={17}/></button></nav>}
        </section>
        <p className="mw-note">草稿仅自己可见，准备好后再发布。</p>
      </>}
    </div>
    {views.map((view, index) => <MobileWriterView key={view.id} view={view} covered={index < views.length - 1} refreshVersion={refreshVersion} onBack={() => dismiss.current()} onExited={exitView} onOpenNew={() => openView('/writer?action=new&from=creation')} onChanged={worksChanged}/>)}
  </dialog>, document.body);
}
