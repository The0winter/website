'use client';
import {useEffect, useRef} from 'react';

// Only scroll/explicit requests. Keeping the observer behind user scrolling
// prevents a short/filtered list draining itself while the reader is idle.
export function useForumPagination({identity, enabled, loading, hasMore, error, loadMore}: {
  identity:string; enabled:boolean; loading:boolean; hasMore:boolean; error?:string; loadMore:()=>void;
}) {
  const sentinel = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);
  const action = useRef(loadMore);
  useEffect(() => {action.current = loadMore;}, [loadMore]);
  useEffect(() => {scrolled.current = false;}, [identity]);
  useEffect(() => {
    if (!enabled || loading || !hasMore || error) return;
    let observer:IntersectionObserver|undefined;
    const visible = () => document.visibilityState === 'visible' && navigator.onLine;
    const next = () => {if (visible()) {scrolled.current = false; action.current();}};
    const nearEnd = () => sentinel.current && sentinel.current.getBoundingClientRect().top <= innerHeight * 2;
    const onScroll = () => {if (scrollY <= 0) return; scrolled.current = true; if (nearEnd()) next();};
    const onVisible = () => {if (scrolled.current && nearEnd()) next();};
    if (typeof IntersectionObserver !== 'undefined' && sentinel.current) {
      observer = new IntersectionObserver(entries => {if (scrolled.current && entries.some(entry => entry.isIntersecting)) next();}, {rootMargin:`${innerHeight}px 0px`});
      observer.observe(sentinel.current);
    }
    window.addEventListener('scroll', onScroll, {passive:true});
    document.addEventListener('visibilitychange', onVisible);
    return () => {observer?.disconnect(); window.removeEventListener('scroll', onScroll); document.removeEventListener('visibilitychange', onVisible);};
  }, [identity, enabled, loading, hasMore, error]);
  return sentinel;
}
