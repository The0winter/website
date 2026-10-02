'use client';
import {useEffect, useRef} from 'react';

// One idle follow-up batch, then only scroll/explicit requests. Keeping the
// observer behind user scrolling prevents a short/filtered list draining itself.
export function useForumPagination({identity, enabled, loading, hasMore, error, preload, loadMore}: {
  identity:string; enabled:boolean; loading:boolean; hasMore:boolean; error?:string; preload:boolean; loadMore:()=>void;
}) {
  const sentinel = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);
  const action = useRef(loadMore);
  useEffect(() => {action.current = loadMore;}, [loadMore]);
  useEffect(() => {scrolled.current = false;}, [identity]);
  useEffect(() => {
    if (!enabled || loading || !hasMore || error) return;
    let observer:IntersectionObserver|undefined, timer:ReturnType<typeof setTimeout>|undefined, idle:number|undefined;
    const visible = () => document.visibilityState === 'visible' && navigator.onLine;
    const next = () => {if (visible()) {scrolled.current = false; action.current();}};
    const nearEnd = () => sentinel.current && sentinel.current.getBoundingClientRect().top <= innerHeight * 2;
    const onScroll = () => {if (scrollY <= 0) return; scrolled.current = true; if (nearEnd()) next();};
    const onVisible = () => {if (scrolled.current && nearEnd()) next();};
    if (preload) {
      timer = setTimeout(() => {
        if (typeof requestIdleCallback === 'function') idle = requestIdleCallback(next, {timeout:1000});
        else next();
      }, 450);
    }
    if (typeof IntersectionObserver !== 'undefined' && sentinel.current) {
      observer = new IntersectionObserver(entries => {if (scrolled.current && entries.some(entry => entry.isIntersecting)) next();}, {rootMargin:`${innerHeight}px 0px`});
      observer.observe(sentinel.current);
    }
    window.addEventListener('scroll', onScroll, {passive:true});
    document.addEventListener('visibilitychange', onVisible);
    return () => {clearTimeout(timer); if (idle !== undefined) cancelIdleCallback(idle); observer?.disconnect(); window.removeEventListener('scroll', onScroll); document.removeEventListener('visibilitychange', onVisible);};
  }, [identity, enabled, loading, hasMore, error, preload]);
  return sentinel;
}
