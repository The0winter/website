'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, BookOpen, ChevronLeft, ChevronRight, FilePenLine, Loader2, PenTool, Plus, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { booksApi, type Book } from '@/lib/api';
import BookCover from './BookCover';
import Link from './PrefetchLink';
import './mobile-writer.css';

export default function MobileWriterDialog({ onClose }: { onClose: () => void }) {
  const { user, loading: authLoading } = useAuth();
  const dialog = useRef<HTMLDialogElement>(null);
  const dismiss = useRef<() => void>(() => {});
  const navigate = useRef<() => void>(() => {});
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ key: string; books: Book[]; error?: string }>();
  const key = `${user?.id}:${page}:${retry}`;
  const books = result?.key === key ? result.books : [];
  const error = result?.key === key ? result.error : undefined;
  const loading = authLoading || Boolean(user && result?.key !== key);
  const userId = user?.id;
  const onCloseRef = useRef(onClose);
  const historyMarker = useRef<string | null>(null);

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
      element.dataset.closing = 'true';
      timer = setTimeout(finish, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 360);
    };
    const pop = () => { if (history.state?.mobileWriter !== marker) animateClose(); };
    dismiss.current = () => {
      if (history.state?.mobileWriter === marker) history.back();
      else animateClose();
    };
    navigate.current = () => {
      // Leave a normal reading entry behind when opening the editor or login.
      if (history.state?.mobileWriter === marker) {
        const state = { ...history.state };
        delete state.mobileWriter;
        history.replaceState(state, '', location.href);
      }
    };
    if (historyMarker.current || history.state?.mobileWriter) history.replaceState({ ...history.state, mobileWriter: marker }, '', location.href);
    else history.pushState({ ...history.state, mobileWriter: marker }, '', location.href);
    historyMarker.current = marker;
    element.showModal();
    document.body.style.overflow = 'hidden';
    window.addEventListener('popstate', pop);
    const desktop = matchMedia('(min-width: 768px)');
    const resize = () => { if (desktop.matches) dismiss.current(); };
    desktop.addEventListener('change', resize);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('popstate', pop);
      desktop.removeEventListener('change', resize);
      navigate.current();
      document.body.style.overflow = overflow;
      if (element.open) element.close();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    booksApi.getMyBooks(userId, page).then(books => {
      if (active) setResult({ key, books });
    }).catch(() => { if (active) setResult({ key, books: [], error: '作品暂时加载失败，请重试。' }); });
    return () => { active = false; };
  }, [userId, page, key]);

  const writerHref = (book: Book, action: 'write' | 'manage') => `/writer?book=${encodeURIComponent(book.id)}&action=${action}&page=${page}`;

  return createPortal(<dialog ref={dialog} className="mw-dialog" aria-labelledby="mw-title" onCancel={event => { event.preventDefault(); dismiss.current(); }}>
    <div className="mw-scroll">
      <header className="mw-header"><div><span className="mw-eyebrow">九天 · 创作者空间</span><h2 id="mw-title">创作中心</h2></div><button type="button" className="mw-close" aria-label="关闭创作中心" onClick={() => dismiss.current()}><X size={22}/></button></header>
      <section className="mw-welcome"><div><p>{user ? `${user.username}，落笔的时间到了` : '每个故事，都始于第一笔'}</p><h3>写下你的<br/>下一章<span>。</span></h3><small>留住灵感，让故事慢慢生长。</small></div><span className="mw-pen" aria-hidden="true"><PenTool size={49}/></span></section>
      {authLoading ? <p className="mw-status" role="status"><Loader2 className="animate-spin" size={19}/>正在确认登录状态…</p> : !user ? <section className="mw-guest"><FilePenLine size={32}/><h3>你的故事，值得被读到</h3><p>登录后创建作品、保存草稿，<br/>也可以接着写上次未完成的章节。</p><Link href="/login" className="mw-primary" onNavigate={() => navigate.current()}>登录并开始创作<ArrowRight size={17}/></Link></section> : <>
        <div className="mw-actions"><Link href="/writer?action=new" className="mw-action mw-action-primary" onNavigate={() => navigate.current()}><Plus size={23}/><strong>新建作品</strong><span>开启一个新故事</span></Link><Link href="/writer" className="mw-action" onNavigate={() => navigate.current()}><BookOpen size={23}/><strong>作品管理</strong><span>章节 · 草稿 · 设置</span></Link></div>
        <section className="mw-works" aria-label="我的作品"><div className="mw-section-heading"><h3>我的作品</h3><span>从上次落笔处继续</span></div>
          {loading ? <p className="mw-status" role="status"><Loader2 className="animate-spin" size={19}/>正在翻开你的作品…</p> : error ? <div className="mw-status" role="alert"><p>{error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>重新加载</button></div> : books.length ? <div className="mw-book-list">{books.map(book => <article className="mw-book" key={book.id}><div className="mw-cover">{book.cover_image ? <BookCover src={book.cover_image} alt={`${book.title}封面`} sizes="64px"/> : <BookOpen size={26}/>}</div><div className="mw-book-info"><h4>{book.title}</h4><p>{book.category || '未分类'} · {['completed', '完结'].includes(book.status || '') ? '已完结' : '连载中'}</p><div><Link href={writerHref(book, 'write')} onNavigate={() => navigate.current()}><PenTool size={14}/>写一章</Link><Link href={writerHref(book, 'manage')} onNavigate={() => navigate.current()}>目录与草稿<ChevronRight size={14}/></Link></div></div></article>)}</div> : <div className="mw-empty"><FilePenLine size={34}/><h4>{page === 1 ? '第一部作品，从这里开始' : '这一页还没有作品'}</h4><p>{page === 1 ? '先给故事起个名字，再慢慢写下它的世界。' : '返回上一页，继续你的故事。'}</p></div>}
          {(page > 1 || books.length === 20) && <nav className="mw-pagination" aria-label="作品分页"><button type="button" disabled={loading || page === 1} onClick={() => setPage(value => value - 1)}><ChevronLeft size={17}/>上一页</button><span>{page}</span><button type="button" disabled={loading || Boolean(error) || books.length < 20} onClick={() => setPage(value => value + 1)}>下一页<ChevronRight size={17}/></button></nav>}
        </section>
        <p className="mw-note">草稿仅自己可见，准备好后再发布。</p>
      </>}
    </div>
  </dialog>, document.body);
}
