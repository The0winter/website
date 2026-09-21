'use client';

import {useEffect, useRef, useState} from 'react';
import {ChevronRight, Pause, Play} from 'lucide-react';
import type {Book} from '@/lib/api';
import BookLink from './BookLink';
import BookCover from './BookCover';

export default function MobileFeaturedBanner({books}: {books: Book[]}) {
  const root = useRef<HTMLElement>(null), track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0), [paused, setPaused] = useState(false);
  const lastInteraction = useRef(0);
  const requested = useRef<number | null>(null), touching = useRef(false);
  const count = Math.min(3, books.length);
  function move(index: number) {
    const host = track.current;
    requested.current = index;
    if (host) host.scrollTo({left: index * host.clientWidth, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
  }
  useEffect(() => {
    const rail = track.current;
    if (!rail) return;
    const settle = () => {
      if (requested.current === null) return;
      const left = requested.current * rail.clientWidth;
      // A tap can arrive while native touch momentum is still settling. Honor
      // that selection after the gesture's snap rather than losing the tap.
      if (Math.abs(rail.scrollLeft - left) > 2) rail.scrollTo({left, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
      else requested.current = null;
    };
    rail.addEventListener('scrollend', settle);
    return () => rail.removeEventListener('scrollend', settle);
  }, [count]);
  useEffect(() => {
    const host = root.current, rail = track.current;
    if (!host || !rail || count < 2 || paused) return;
    let visible = false;
    const observer = new IntersectionObserver(entries => {visible = entries[0].isIntersecting;}, {threshold: .6});
    observer.observe(host);
    const timer = setInterval(() => {
      if (!visible || touching.current || document.visibilityState !== 'visible' || location.pathname !== '/' ||
        host.contains(document.activeElement) || matchMedia('(prefers-reduced-motion: reduce)').matches ||
        Date.now() - lastInteraction.current < 6000) return;
      const current = Math.round(rail.scrollLeft / rail.clientWidth);
      rail.scrollTo({left: ((current + 1) % count) * rail.clientWidth, behavior: 'smooth'});
    }, 6000);
    return () => {clearInterval(timer); observer.disconnect();};
  }, [count, paused]);
  if (!count) return null;
  return <section ref={root} className="mh-carousel" aria-label="每日精选推荐" aria-roledescription="轮播图"
    onPointerDown={() => {lastInteraction.current = Date.now();}}
    onTouchStart={() => {touching.current = true; requested.current = null; lastInteraction.current = Date.now();}}
    onTouchEnd={() => {touching.current = false; lastInteraction.current = Date.now();}}
    onTouchCancel={() => {touching.current = false; lastInteraction.current = Date.now();}}>
    <div ref={track} className="mh-banner-track" onScroll={event => {
      const host = event.currentTarget;
      setActive(Math.max(0, Math.min(count - 1, Math.round(host.scrollLeft / host.clientWidth))));
    }} onKeyDown={event => {
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault(); lastInteraction.current = Date.now();
        move((active + (event.key === 'ArrowRight' ? 1 : count - 1)) % count);
      }
    }}>
      {books.slice(0, count).map((book, index) => <BookLink key={book.id} href={`/book/${book.id}`} className="mh-banner"
        tabIndex={index === active ? 0 : -1} aria-hidden={index !== active} aria-label={`推荐 ${index + 1}/${count}：${book.title}`}>
        <div><span className="mh-kicker">九天精选 · 每日书单</span><h2>{book.title}</h2><span className="mh-banner-sub">{book.author || '九天小说'} <ChevronRight size={13}/></span></div>
        <div className="mh-cover"><BookCover src={book.cover_image} alt={`${book.title}封面`} sizes="56px" priority={index === 0}/></div>
        <div className="mh-banner-seal" aria-hidden="true">阅</div>
      </BookLink>)}
    </div>
    {count > 1 && <div className="mh-banner-controls">
      <div className="mh-banner-dots" aria-label="选择推荐作品">{books.slice(0, count).map((book, index) =>
        <button key={book.id} type="button" aria-label={`查看推荐：${book.title}`} aria-pressed={index === active} onClick={() => move(index)}><span/></button>)}</div>
      <button type="button" className="mh-banner-pause" aria-label={paused ? '继续自动轮播' : '暂停自动轮播'} onClick={() => setPaused(value => !value)}>{paused ? <Play size={12}/> : <Pause size={12}/>}</button>
    </div>}
  </section>;
}
