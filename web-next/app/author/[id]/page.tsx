'use client';

import {useEffect, useLayoutEffect, useState} from 'react';
import {useParams, useRouter, useSearchParams} from 'next/navigation';
import {ArrowLeft, BookOpen, ChevronRight, RotateCcw, UserRound} from 'lucide-react';
import type {Book, Profile} from '@/lib/api';
import {safeFetch} from '@/lib/request';
import {syncBookRoute} from '@/lib/book-navigation';
import BookLink from '@/components/BookLink';
import './author.css';

export const dynamic = 'force-dynamic';

function Cover({book}: {book: Book}) {
  const [failed, setFailed] = useState(false);
  return <div className="author-book-cover">{book.cover_image && !failed
    ? <img src={book.cover_image} alt={book.title + '封面'} onError={() => setFailed(true)}/>
    : <BookOpen size={28} aria-hidden="true"/>}</div>;
}

export default function AuthorProfile() {
  const {id} = useParams<{id: string}>();
  const router = useRouter();
  const search = useSearchParams();
  const requestedPage = Number(search.get('page') || 1);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 && requestedPage <= 100000 ? requestedPage : 1;
  const key = id + ':' + page;
  const [result, setResult] = useState<{key: string; books: Book[]; total: number; profile: Profile} | null>(null);
  const [failure, setFailure] = useState<{key: string; message: string} | null>(null);
  const [retry, setRetry] = useState(0);
  const [avatarFailed, setAvatarFailed] = useState('');
  const error = failure?.key === key ? failure.message : '';
  const loading = result?.key !== key && !error;
  const profile = result?.profile.id === id ? result.profile : null;
  const total = result?.total || 0;
  const books = result?.books || [];
  const query = search.toString();
  useLayoutEffect(() => {syncBookRoute('/author/' + id + (query ? '?' + query : ''));}, [id, query]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      safeFetch('/api/books?author_id=' + encodeURIComponent(id) + '&page=' + page + '&limit=20&orderBy=updatedAt&order=desc', {signal: controller.signal}).then(async response => {
        if (!response.ok) throw new Error('作品暂时加载失败，请重试');
        const books: Book[] = await response.json();
        return {books, total: Number(response.headers.get('X-Total-Count') || books.length)};
      }),
      safeFetch('/api/authors/' + encodeURIComponent(id), {signal: controller.signal}).then(async response => {
        if (!response.ok) throw new Error(response.status === 404 ? '未找到这位作者' : '作者信息暂时加载失败，请重试');
        return response.json() as Promise<Profile>;
      }),
    ]).then(([data, profile]) => {
      if (!controller.signal.aborted) { setResult({key, ...data, profile}); setFailure(null); }
    }).catch(error => {
      if (!controller.signal.aborted) setFailure({key, message: error instanceof Error ? error.message : '加载失败，请重试'});
    });
    return () => controller.abort();
  }, [id, page, key, retry]);

  function changePage(next: number) {
    history.replaceState({}, '', '/author/' + encodeURIComponent(id) + (next > 1 ? '?page=' + next : ''));
    window.scrollTo({top: 0, behavior: 'instant'});
  }

  return <div className="author-page">
    <div className="author-shell">
      <header className="author-topbar"><button type="button" onClick={() => history.length > 1 ? router.back() : router.replace('/')}><ArrowLeft size={20}/>返回</button><span>作者主页</span></header>
      <section className="author-profile" aria-label="作者信息">
        <div className="author-avatar">{profile?.avatar && avatarFailed !== profile.avatar
          ? <img src={profile.avatar} alt="作者头像" onError={() => setAvatarFailed(profile.avatar!)}/>
          : <UserRound size={32} aria-hidden="true"/>}</div>
        <div className="author-identity"><p>作者</p><h1>{profile?.username || (loading ? '正在加载作者…' : '作者信息')}</h1><p>在这里阅读作者的公开作品</p></div>
        {profile && <div className="author-count"><strong>{total}</strong><span>部作品</span></div>}
      </section>
      <section className="author-works" aria-label="作者作品" aria-busy={loading}>
        <header className="author-works-heading"><h2><BookOpen size={20}/>全部作品{profile && <span>（{total}）</span>}</h2><span>最近更新</span></header>
        {error ? <div className="author-empty" role="alert"><BookOpen size={32}/><p>{error}</p><button onClick={() => {setFailure(null); setRetry(value => value + 1);}}><RotateCcw size={16}/>重新加载</button></div>
          : loading ? <div className="author-empty" role="status"><BookOpen size={32}/><p>正在加载作品…</p></div>
          : books.length ? <div className="author-book-list">{books.map(book => <BookLink key={book.id} href={'/book/' + book.id} className="author-book">
            <Cover book={book}/>
            <div className="author-book-info"><h3>{book.title}</h3><p>{book.description && book.description !== '暂无简介' ? book.description : '暂无简介，打开作品开始阅读。'}</p><div className="author-book-meta"><span>{book.category?.split('>').pop()?.trim() || '综合'}</span><span>{['completed', '完结'].includes(book.status || '') ? '完结' : '连载'}</span></div></div>
            <ChevronRight className="author-book-arrow" size={18} aria-hidden="true"/>
          </BookLink>)}</div>
          : <div className="author-empty"><BookOpen size={32}/><p>{page > 1 ? '这一页没有更多作品了' : '作者暂时还没有公开作品'}</p></div>}
        {(total > 20 || page > 1) && <nav className="author-pagination" aria-label="作品分页"><button disabled={loading || page === 1} onClick={() => changePage(page - 1)}>上一页</button><span>第 {page} 页</span><button disabled={loading || page * 20 >= total} onClick={() => changePage(page + 1)}>下一页</button></nav>}
      </section>
    </div>
  </div>;
}
