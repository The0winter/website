'use client';

import {Suspense, useEffect, useState, type FormEvent} from 'react';
import {useSearchParams, useRouter} from 'next/navigation';
import Link from 'next/link';
import {ArrowLeft, ArrowRight, Search, BookOpen, UserRound, X, RotateCcw} from 'lucide-react';
import BookLink from '@/components/BookLink';
import {safeFetch} from '@/lib/request';
import type {Book} from '@/lib/api';
import './search.css';

const pageSize = 20;
const searchHref = (query: string, page = 1) => `/search?${new URLSearchParams({q: query, ...(page > 1 ? {page: String(page)} : {})})}`;

function SearchForm({query}: {query: string}) {
  const [draft, setDraft] = useState(query);
  const router = useRouter();
  function submit(event: FormEvent) {
    event.preventDefault();
    const next = draft.trim();
    router.push(next ? searchHref(next) : '/search');
  }
  return <form className="search-form" role="search" onSubmit={submit}>
    <Search size={20} aria-hidden="true"/>
    <input type="search" name="q" aria-label="搜索书名或作者" placeholder="搜索书名、作者" value={draft} onChange={event => setDraft(event.target.value)} maxLength={200}/>
    {draft && <button className="search-clear" type="button" aria-label="清空搜索词" onClick={() => setDraft('')}><X size={17}/></button>}
    <button className="search-submit" type="submit">搜索</button>
  </form>;
}

function BookCover({book}: {book: Book}) {
  const [failed, setFailed] = useState(false);
  return <div className="search-cover">{book.cover_image && !failed
    ? <img src={book.cover_image} alt={`${book.title}封面`} loading="lazy" onError={() => setFailed(true)}/>
    : <><BookOpen size={25}/><span>{book.title}</span></>}
  </div>;
}

function SearchSkeleton() {
  return <div className="search-results search-skeleton" role="status" aria-label="正在搜索">
    {Array.from({length: 4}, (_, index) => <div key={index} className="search-book" aria-hidden="true"><div className="search-cover"/><div className="search-book-info"><i/><i/><i/></div></div>)}
  </div>;
}

function SearchContent() {
  const params = useSearchParams();
  const router = useRouter();
  const query = (params.get('q') || '').trim();
  const rawPage = params.get('page') || '1';
  const page = /^\d+$/.test(rawPage) ? Math.max(1, Math.min(100000, Number(rawPage))) : 1;
  const [retry, setRetry] = useState(0);
  const key = JSON.stringify([query, page, retry]);
  const [result, setResult] = useState<{key: string; books: Book[]; total: number | null; error: string}>({key: '', books: [], total: null, error: ''});
  const loading = Boolean(query) && result.key !== key;
  const books = loading || !query ? [] : result.books;
  const error = loading || !query ? '' : result.error;
  const total = loading ? null : result.total;
  const pages = total === null ? null : Math.max(1, Math.ceil(total / pageSize));
  const hasNext = pages === null ? books.length === pageSize : page < pages;

  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    void (async () => {
      try {
        const response = await safeFetch(`/api/books?${new URLSearchParams({q: query, limit: String(pageSize), page: String(page)})}`, {signal: controller.signal});
        if (!response.ok) throw new Error('搜索暂时不可用，请重试');
        const books: Book[] = await response.json();
        const header = response.headers.get('X-Total-Count');
        const count = header === null ? NaN : Number(header);
        if (active) setResult({key, books, total: Number.isSafeInteger(count) && count >= 0 ? count : null, error: ''});
      } catch {
        if (active) setResult({key, books: [], total: null, error: '搜索暂时不可用，请重试'});
      } finally {
        window.clearTimeout(timeout);
      }
    })();
    return () => {active = false; window.clearTimeout(timeout); controller.abort();};
  }, [query, page, key]);

  return <div className="search-page"><div className="search-shell">
    <header className="search-header">
      <Link href="/" className="search-home"><ArrowLeft size={17}/>返回首页</Link>
      <div className="search-intro"><span>九天书库</span><h1>搜索书籍</h1><p>从书名或作者开始，找到下一本想读的书。</p></div>
      <SearchForm key={query} query={query}/>
    </header>
    {!query ? <section className="search-empty"><BookOpen size={38}/><h2>好故事，等你发现</h2><p>输入书名或作者，开始搜索。</p></section> : <section className="search-body" aria-label="搜索结果" aria-busy={loading}>
      <div className="search-summary"><h2>“{query}” 的搜索结果</h2><p aria-live="polite">{loading ? '正在查找相关书籍…' : error ? '搜索未完成' : total === null ? `第 ${page} 页 · 本页 ${books.length} 本` : `共 ${total} 本相关书籍`}</p></div>
      {loading ? <SearchSkeleton/> : error ? <div className="search-empty" role="alert"><Search size={32}/><h2>暂时没能完成搜索</h2><p>{error}</p><button onClick={() => setRetry(value => value + 1)}><RotateCcw size={16}/>重新搜索</button></div> : books.length === 0 ? <div className="search-empty"><BookOpen size={38}/><h2>{page > 1 ? '这一页没有更多书籍了' : '没有找到相关书籍'}</h2><p>{page > 1 ? '可以返回上一页，继续挑选。' : '试试更短的书名，或搜索作者的名字。'}</p></div> : <div className="search-results">
        {books.map(book => {
          const author = typeof book.author_id === 'object' && book.author_id?.username || book.author || '佚名';
          const category = book.category?.split('>').at(-1)?.trim();
          const completed = ['completed', '完结', '已完结'].includes(book.status || '');
          return <BookLink key={book.id} href={`/book/${book.id}`} className="search-book">
            <BookCover book={book}/><div className="search-book-info"><h3>{book.title}</h3><p className="search-author"><UserRound size={13}/><span>{author}</span></p><p className="search-description">{book.description || '暂无简介'}</p><div className="search-book-meta">{category && <span>{category}</span>}{book.status && <span className={completed ? 'is-complete' : ''}>{completed ? '已完结' : '连载中'}</span>}</div></div>
          </BookLink>;
        })}
      </div>}
      {!loading && !error && (books.length > 0 || page > 1) && <nav className="search-pagination" aria-label="搜索结果分页">
        <button disabled={page === 1} onClick={() => router.push(searchHref(query, page - 1))}><ArrowLeft size={16}/>上一页</button>
        <span aria-current="page">第 {page} 页{pages !== null && ` / 共 ${pages} 页`}</span>
        <button disabled={!hasNext} onClick={() => router.push(searchHref(query, page + 1))}>下一页<ArrowRight size={16}/></button>
      </nav>}
    </section>}
  </div></div>;
}

export default function SearchPage() {
  return <Suspense fallback={<div className="search-page"><div className="search-shell"><SearchSkeleton/></div></div>}><SearchContent/></Suspense>;
}
