'use client';
import {useEffect, useState} from 'react';
import {safeFetch} from '@/lib/request';
import type {ForumPost} from '@/lib/api';
import ForumPostList from './ForumPostList';

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
    {error ? <p className="forum-list-state" role="alert">{error} <button onClick={() => setRetry(v => v + 1)}>重试</button></p> : <ForumPostList posts={items} loading={loading}/>}
    {total > 20 && <nav aria-label="讨论分页" className="forum-pagination"><button disabled={page === 1} onClick={() => setPage(p => p - 1)}>上一页</button><span>{page} / {Math.ceil(total / 20)}</span><button disabled={page * 20 >= total} onClick={() => setPage(p => p + 1)}>下一页</button></nav>}
  </div>;
}
