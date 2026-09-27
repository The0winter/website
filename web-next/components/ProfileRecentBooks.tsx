'use client';

import {useEffect, useState} from 'react';
import type {Book} from '@/lib/api';
import {safeFetch} from '@/lib/request';
import BookShelf from './BookShelf';
import {LoadingText} from './BrandLoading';

export default function ProfileRecentBooks({userId}: {userId: string}) {
  const [result, setResult] = useState<{books: Book[]; failed: boolean} | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    safeFetch(`/api/users/${userId}/recent-books`, {cache:'no-store', signal:controller.signal})
      .then(async response => {
        if (!response.ok) throw Error('阅读记录暂时无法读取');
        const books: Book[] = await response.json();
        if (!controller.signal.aborted) setResult({books:books.slice(0,8), failed:false});
      }).catch(() => {if (!controller.signal.aborted) setResult({books:[], failed:true});});
    return () => controller.abort();
  }, [userId, retry]);
  return <section className="public-profile-recent" aria-label="最近读过" aria-busy={!result}>
    <h2>最近读过</h2>
    {!result ? <p role="status"><LoadingText>正在加载阅读记录</LoadingText></p>
      : result.failed ? <p role="alert">阅读记录暂时无法读取 <button onClick={() => {setResult(null); setRetry(value => value+1);}}>重试</button></p>
      : result.books.length ? <BookShelf books={result.books} title="最近读过"/>
      : <p>还没有阅读记录</p>}
  </section>;
}
