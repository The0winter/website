'use client';

import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {ChevronRight} from 'lucide-react';
import type {Book} from '@/lib/api';
import BookLink from './BookLink';
import BookCover from './BookCover';

export default function MobileFeaturedBanner({books}: {books: Book[]}) {
  const root = useRef<HTMLElement>(null), track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const activeIndex = useRef(0);
  const restartTimer = useRef<() => void>(() => {});
  const requested = useRef<number | null>(null), touching = useRef(false);
  const count = Math.min(3, books.length);
  const offset = count > 1 ? 1 : 0;
  function interact() {requested.current = null; restartTimer.current();}
  function move(index: number) {
    restartTimer.current();
    const host = track.current;
    if (!host || count < 2 || !host.clientWidth) return;
    const current = Math.round(host.scrollLeft / host.clientWidth) - offset;
    // The duplicate at either edge keeps the last/first transition one slide long.
    const target = current === count - 1 && index === 0 ? count + offset :
      current === 0 && index === count - 1 ? 0 : index + offset;
    requested.current = target;
    host.scrollTo({left: target * host.clientWidth, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
  }
  useLayoutEffect(() => {
    const rail = track.current;
    if (!rail || !count) return;
    let timeout: ReturnType<typeof setTimeout>;
    let width = rail.clientWidth;
    rail.scrollTo({left: (activeIndex.current + offset) * width, behavior: 'instant'});
    const settle = () => {
      if (touching.current || !rail.clientWidth) return;
      // A tap can arrive while native touch momentum is still settling. Honor
      // that selection after the gesture's snap rather than losing the tap.
      if (requested.current !== null) {
        const left = requested.current * rail.clientWidth;
        if (Math.abs(rail.scrollLeft - left) > 2) {
          rail.scrollTo({left, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
          return;
        }
        // Keep the explicit selection until the next interaction. Some touch
        // browsers emit scrollend before their previous snap has fully stopped.
      }
      const position = Math.round(rail.scrollLeft / rail.clientWidth);
      if (count > 1 && Math.abs(rail.scrollLeft - position * rail.clientWidth) < 2 && (position === 0 || position === count + 1)) {
        // Both copies look identical. Recenter only after the animation ends.
        const canonical = position === 0 ? count : 1;
        if (requested.current !== null) requested.current = canonical;
        rail.scrollTo({left: canonical * rail.clientWidth, behavior: 'instant'});
      }
    };
    const scroll = () => {clearTimeout(timeout); timeout = setTimeout(settle, 180);};
    const resize = new ResizeObserver(() => {
      if (rail.clientWidth === width) return;
      width = rail.clientWidth;
      requested.current = null;
      rail.scrollTo({left: (activeIndex.current + offset) * width, behavior: 'instant'});
    });
    resize.observe(rail);
    rail.addEventListener('scrollend', settle);
    rail.addEventListener('scroll', scroll, {passive: true});
    rail.addEventListener('touchend', scroll);
    rail.addEventListener('touchcancel', scroll);
    return () => {clearTimeout(timeout); resize.disconnect(); rail.removeEventListener('scrollend', settle); rail.removeEventListener('scroll', scroll); rail.removeEventListener('touchend', scroll); rail.removeEventListener('touchcancel', scroll);};
  }, [count, offset]);
  useEffect(() => {
    const host = root.current, rail = track.current;
    if (!host || !rail || count < 2) return;
    let visible = false;
    let timer: ReturnType<typeof setTimeout>;
    const restart = () => {clearTimeout(timer); timer = setTimeout(advance, 6000);};
    const advance = () => {
      if (visible && !touching.current && document.visibilityState === 'visible' && location.pathname === '/' &&
        !document.documentElement.dataset.mobileSectionTransition && !host.contains(document.activeElement) &&
        !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const current = Math.round(rail.scrollLeft / rail.clientWidth);
        requested.current = null;
        rail.scrollTo({left: Math.min(current + 1, count + 1) * rail.clientWidth, behavior: 'smooth'});
      }
      restart();
    };
    restartTimer.current = restart;
    const observer = new IntersectionObserver(entries => {visible = entries[0].isIntersecting; restart();}, {threshold: .6});
    observer.observe(host);
    const transition = new MutationObserver(restart);
    transition.observe(document.documentElement, {attributes: true, attributeFilter: ['data-mobile-section-transition']});
    document.addEventListener('visibilitychange', restart);
    host.addEventListener('focusout', restart);
    restart();
    return () => {clearTimeout(timer); restartTimer.current = () => {}; observer.disconnect(); transition.disconnect(); document.removeEventListener('visibilitychange', restart); host.removeEventListener('focusout', restart);};
  }, [count]);
  if (!count) return null;
  const selected = books.slice(0, count);
  const slides = count > 1 ? [selected[count - 1], ...selected, selected[0]] : selected;
  return <section ref={root} className="mh-carousel" aria-label="每日精选推荐" aria-roledescription="轮播图"
    onPointerDown={interact}
    onWheel={interact}
    onTouchStart={() => {touching.current = true; interact();}}
    onTouchEnd={() => {touching.current = false; restartTimer.current();}}
    onTouchCancel={() => {touching.current = false; restartTimer.current();}}>
    <div ref={track} className="mh-banner-track" onScroll={event => {
      const host = event.currentTarget;
      if (!host.clientWidth) return;
      const index = (Math.round(host.scrollLeft / host.clientWidth) - offset + count) % count;
      activeIndex.current = index;
      setActive(index);
    }} onKeyDown={event => {
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        move((active + (event.key === 'ArrowRight' ? 1 : count - 1)) % count);
      }
    }}>
      {slides.map((book, position) => {
        const index = (position - offset + count) % count;
        const clone = count > 1 && (position === 0 || position === count + 1);
        return <BookLink key={`${position}-${book.id}`} href={`/book/${book.id}`} className="mh-banner" data-banner-clone={clone || undefined}
          tabIndex={!clone && index === active ? 0 : -1} aria-hidden={clone || index !== active} aria-label={`推荐 ${index + 1}/${count}：${book.title}`}>
          <div className="mh-banner-backdrop" aria-hidden="true"><BookCover src={book.cover_image} alt="" sizes="240px" loading="eager"/></div>
          <div className="mh-banner-copy"><h2>{book.title}</h2><span className="mh-banner-sub"><span>{book.author || '九天小说'}</span><ChevronRight size={14}/></span></div>
          <div className="mh-cover"><BookCover src={book.cover_image} alt={`${book.title}封面`} sizes="72px" loading="eager" priority={!clone && index === 0}/></div>
        </BookLink>;
      })}
    </div>
    {count > 1 && <div className="mh-banner-controls">
      <div className="mh-banner-dots" aria-label="选择推荐作品">{books.slice(0, count).map((book, index) =>
        <button key={book.id} type="button" aria-label={`查看推荐：${book.title}`} aria-pressed={index === active} onClick={() => move(index)}><span/></button>)}</div>
    </div>}
  </section>;
}
