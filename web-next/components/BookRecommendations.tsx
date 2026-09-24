'use client';

import {useEffect, useState} from 'react';
import {ChevronRight} from 'lucide-react';
import type {Book} from '@/lib/api';
import {safeFetch} from '@/lib/request';
import BookShelf from './BookShelf';
import {LoadingText} from './BrandLoading';

export default function BookRecommendations({book}: {book: Pick<Book, 'id' | 'category'>}) {
  const [result, setResult] = useState<{books: Book[]; failed: boolean} | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function load(category?: string): Promise<Book[]> {
      const query = new URLSearchParams({orderBy:'views', order:'desc', limit:'9'});
      if (category) query.set('category', category);
      const response = await safeFetch(`/api/books?${query}`, {signal:controller.signal});
      if (!response.ok) throw Error('推荐加载失败');
      return response.json();
    }
    void Promise.allSettled([...(book.category ? [load(book.category)] : []), load()]).then(results => {
      if (controller.signal.aborted) return;
      const seen = new Set([book.id]);
      const books = results.flatMap(result => result.status === 'fulfilled' ? result.value : []).filter(item => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      }).slice(0, 8);
      setResult({books, failed:results.every(result => result.status === 'rejected')});
    });
    return () => controller.abort();
  }, [book.id, book.category, retry]);

  return <section className="book-recommendations" aria-label="猜你喜欢" aria-busy={!result}>
    <header><h2>猜你喜欢</h2>{!!result?.books.length && <span>左右滑动 <ChevronRight size={13} aria-hidden="true"/></span>}</header>
    {!result ? <p className="book-recommendations-status" role="status"><LoadingText>正在加载推荐</LoadingText></p>
      : result.failed ? <p className="book-recommendations-status" role="alert">推荐暂时加载失败 <button onClick={() => {setResult(null); setRetry(value => value + 1);}}>重试</button></p>
      : result.books.length ? <BookShelf books={result.books} title="猜你喜欢"/>
      : <p className="book-recommendations-status">暂时没有其他书籍推荐</p>}
  </section>;
}
