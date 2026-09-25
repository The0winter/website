'use client';

import {useEffect, useId, useRef, useSyncExternalStore} from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {useRouter} from 'next/navigation';
import {ChevronLeft, Search, X} from 'lucide-react';
import BookSearch from './BookSearch';
import BookShare from './BookShare';
import {bookDetailReturnHref, bookSearchOpen, closeBookSearch, navigateDetailSearch, openBookSearch, serverCatalogClosed, subscribeBookNavigation} from '@/lib/book-navigation';

export default function BookDetailNavigation({bookId, title}: {bookId: string; title: string}) {
  const router = useRouter();
  const searchId = useId();
  const search = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const open = useSyncExternalStore(subscribeBookNavigation, () => bookSearchOpen(bookId), serverCatalogClosed);
  const returnHref = useSyncExternalStore(subscribeBookNavigation, () => bookDetailReturnHref(bookId), () => '/');

  useEffect(() => {
    if (!open) return;
    // Consume an outside tap before its control navigates or opens another sheet.
    const dismiss = (event: MouseEvent) => {
      if (search.current?.contains(event.target as Node)) return;
      event.preventDefault();
      event.stopPropagation();
      closeBookSearch();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeBookSearch(() => toggle.current?.focus());
    };
    const desktop = window.matchMedia('(min-width: 768px)');
    const resize = () => {if (desktop.matches) closeBookSearch();};
    resize();
    document.addEventListener('click', dismiss, true);
    document.addEventListener('keydown', escape);
    desktop.addEventListener('change', resize);
    return () => {
      document.removeEventListener('click', dismiss, true);
      document.removeEventListener('keydown', escape);
      desktop.removeEventListener('change', resize);
    };
  }, [open]);

  return <nav className="book-home-actions" aria-label="详情页导航">
    <Link href={returnHref} prefetch={false} aria-label={returnHref === '/' ? '返回精选' : '返回上一本书'} className="book-home-back"
      onNavigate={event => {if (returnHref !== '/') {event.preventDefault(); window.history.back();}}}>
      <ChevronLeft size={36} strokeWidth={1.35} aria-hidden="true"/>
    </Link>
    <Link href="/" prefetch={false} aria-label="精选主页" className="book-home-link" inert={open}>
      <Image src="/icon.png" alt="九天小说" width={24} height={24} sizes="24px" loading="eager" className="book-home-logo"/>
    </Link>
    <div ref={search} className="book-detail-search" data-open={open}>
      <div id={searchId} className="book-detail-search-input" inert={!open}>
        {open && <BookSearch autoFocus navigate={href => closeBookSearch(() => {
          if (href === location.pathname + location.search) return;
          if (!navigateDetailSearch(href)) router.push(href);
        })}/>}
      </div>
      <button ref={toggle} type="button" className="book-detail-search-toggle" aria-label={open ? '收起搜索' : '搜索书籍'}
        aria-expanded={open} aria-controls={searchId} onClick={() => open ? closeBookSearch() : openBookSearch(bookId)}>
        {open ? <X size={26} strokeWidth={1.4} aria-hidden="true"/> : <Search size={28} strokeWidth={1.5} aria-hidden="true"/>}
      </button>
    </div>
    <BookShare bookId={bookId} title={title}/>
  </nav>;
}
