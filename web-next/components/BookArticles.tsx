'use client';
import {useEffect, useId, useRef, useState} from 'react';
import {safeFetch} from '@/lib/request';
import type {ForumPost} from '@/lib/api';
import ForumPostList from './ForumPostList';

function ArticleCarousel({posts}: {posts:ForumPost[]}) {
  const track = useRef<HTMLDivElement>(null);
  const id = useId();
  const [current, setCurrent] = useState(0);
  const position = useRef(0);
  const looping = posts.length > 1;
  // The two inert edge copies let a native swipe cross either end of the list.
  useEffect(() => {
    const element = track.current;
    if (!element) return;
    const mobile = window.matchMedia('(max-width: 767px)');
    let timer:ReturnType<typeof setTimeout>;
    const align = () => {
      clearTimeout(timer);
      element.scrollTo({left:mobile.matches ? (position.current + (looping ? 1 : 0)) * element.clientWidth : 0, behavior:'instant'});
    };
    const settle = () => {
      if (!mobile.matches || !looping || !element.clientWidth) return;
      const index = Math.round(element.scrollLeft / element.clientWidth);
      if (Math.abs(element.scrollLeft - index * element.clientWidth) > 1) return;
      if (index === 0 || index === posts.length + 1) {
        element.scrollTo({left:(index === 0 ? posts.length : 1) * element.clientWidth, behavior:'instant'});
      }
    };
    const scroll = () => {
      if (!mobile.matches || !element.clientWidth) return;
      const index = Math.round(element.scrollLeft / element.clientWidth) - (looping ? 1 : 0);
      position.current = (index + posts.length) % posts.length;
      setCurrent(position.current);
      clearTimeout(timer);
      timer = setTimeout(settle, 160);
    };
    align();
    element.addEventListener('scroll', scroll, {passive:true});
    element.addEventListener('scrollend', settle);
    mobile.addEventListener('change', align);
    const resize = new ResizeObserver(align);
    resize.observe(element);
    return () => {
      clearTimeout(timer);
      resize.disconnect();
      element.removeEventListener('scroll', scroll);
      element.removeEventListener('scrollend', settle);
      mobile.removeEventListener('change', align);
    };
  }, [looping, posts.length]);
  const move = (index:number) => {
    const element = track.current;
    if (!element) return;
    element.scrollTo({left:(index + (looping ? 1 : 0)) * element.clientWidth,
      behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
  };
  const dotStart = Math.max(0, Math.min(current - 1, posts.length - 3));
  const dots = Array.from({length:Math.min(3, posts.length)}, (_, index) => dotStart + index);
  return <>
    <div id={id} ref={track} className="book-article-track" role="group" aria-label="文章列表" tabIndex={posts.length > 1 ? 0 : undefined}
      onKeyDown={event => {
        if (event.target !== event.currentTarget || !window.matchMedia('(max-width: 767px)').matches) return;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          move(current + (event.key === 'ArrowLeft' ? -1 : 1));
        }
      }}>
      {looping && <div className="book-article-slide" data-clone="true" aria-hidden="true" inert>
        <ForumPostList posts={[posts[posts.length - 1]]} loading={false}/>
      </div>}
      {posts.map(post => <div className="book-article-slide" key={post.entryId || post.topReply?.id || post.id}>
        <ForumPostList posts={[post]} loading={false}/>
      </div>)}
      {looping && <div className="book-article-slide" data-clone="true" aria-hidden="true" inert>
        <ForumPostList posts={[posts[0]]} loading={false}/>
      </div>}
    </div>
    {posts.length > 1 && <nav className="book-article-controls" aria-label="文章切换">
      {dots.map((index, slot) => <button key={slot} type="button" aria-label={`第 ${index + 1} 篇文章`} aria-current={current === index ? 'true' : undefined} aria-controls={id} onClick={() => move(index)}><span/></button>)}
      <span className="sr-only" aria-live="polite" aria-atomic="true">{current + 1} / {posts.length}</span>
    </nav>}
  </>;
}

export default function BookArticles({bookId}: {bookId:string}) {
  const [result, setResult] = useState<{key:string; items:ForumPost[]; total:number; error:string}>({key:'',items:[],total:0,error:''});
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const key = `${bookId}:${page}:${retry}`;
  const loading = result.key !== key;
  const {items, total} = result;
  const error = loading ? '' : result.error;
  useEffect(() => {
    const controller = new AbortController();
    safeFetch('/api/books/' + bookId + '/discussions?page=' + page, {signal:controller.signal})
      .then(async response => {if (!response.ok) throw Error('讨论加载失败，请重试'); return response.json();})
      .then(data => {if (!controller.signal.aborted) setResult({key,items:data.items,total:data.total,error:''});})
      .catch(error => {if (!controller.signal.aborted) setResult({key,items:[],total:0,error:error.message});});
    return () => controller.abort();
  }, [bookId, page, key]);
  return <div className="book-articles forum-surface">
    {error ? <p className="forum-list-state" role="alert">{error} <button onClick={() => setRetry(v => v + 1)}>重试</button></p>
      : loading || !items.length ? <ForumPostList posts={[]} loading={loading} emptyText="还没有相关文章，来分享你的阅读感受吧。"/>
      : <ArticleCarousel key={key} posts={items}/>}
    {total > 20 && <nav aria-label="文章分页" className="forum-pagination"><button disabled={loading || page === 1} onClick={() => setPage(p => p - 1)}>上一页</button><span>{page} / {Math.ceil(total / 20)}</span><button disabled={loading || page * 20 >= total} onClick={() => setPage(p => p + 1)}>下一页</button></nav>}
  </div>;
}
