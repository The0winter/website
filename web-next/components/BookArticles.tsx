'use client';
import {useEffect, useId, useRef, useState} from 'react';
import {ChevronLeft, ChevronRight} from 'lucide-react';
import {safeFetch} from '@/lib/request';
import type {ForumPost} from '@/lib/api';
import ForumPostList from './ForumPostList';

function ArticleCarousel({posts}: {posts:ForumPost[]}) {
  const track = useRef<HTMLDivElement>(null);
  const id = useId();
  const [current, setCurrent] = useState(0);
  const move = (index:number) => {
    const element = track.current;
    if (!element) return;
    element.scrollTo({left:Math.max(0, Math.min(posts.length - 1, index)) * element.clientWidth,
      behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
  };
  return <>
    <div id={id} ref={track} className="book-article-track" role="group" aria-label="文章列表" tabIndex={posts.length > 1 ? 0 : undefined}
      onScroll={event => {
        const element = event.currentTarget;
        if (element.clientWidth) setCurrent(Math.min(posts.length - 1, Math.round(element.scrollLeft / element.clientWidth)));
      }}
      onKeyDown={event => {
        if (event.target !== event.currentTarget || !window.matchMedia('(max-width: 767px)').matches) return;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          move(current + (event.key === 'ArrowLeft' ? -1 : 1));
        }
      }}>
      {posts.map(post => <div className="book-article-slide" key={post.entryId || post.topReply?.id || post.id}>
        <ForumPostList posts={[post]} loading={false}/>
      </div>)}
    </div>
    {posts.length > 1 && <nav className="book-article-controls" aria-label="文章切换">
      <button type="button" aria-label="上一篇文章" aria-controls={id} disabled={current === 0} onClick={() => move(current - 1)}><ChevronLeft size={18}/></button>
      <span aria-live="polite" aria-atomic="true">{current + 1} / {posts.length}</span>
      <span className="book-article-hint">左右滑动切换</span>
      <button type="button" aria-label="下一篇文章" aria-controls={id} disabled={current === posts.length - 1} onClick={() => move(current + 1)}><ChevronRight size={18}/></button>
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
