'use client';

import {useEffect,useState} from 'react';
import Link from './PrefetchLink';
import BookLink from './BookLink';
import {useRouter} from 'next/navigation';
import {BookOpen,Search,LayoutGrid,Trophy,CalendarDays,Library,Gem,MessageCircle,UserRound,ChevronRight,ArrowLeft} from 'lucide-react';
import type {Book} from '@/lib/api';
import {safeFetch} from '@/lib/request';
import './mobile-home.css';

const categories=['全部','玄幻','仙侠','都市','历史','科幻','奇幻','悬疑'];
function Cover({book}:{book:Book}){
  const [failed,setFailed]=useState(false);
  return <div className="mh-cover">{book.cover_image&&!failed?<img src={book.cover_image} alt={`${book.title}封面`} onError={()=>setFailed(true)}/>:<><BookOpen size={26}/><span>{book.title}</span></>}</div>;
}
function BookRows({books}:{books:Book[]}){
  return <div className="mh-rows">{books.length?books.map(book=><BookLink className="mh-book" key={book.id} href={`/book/${book.id}`}><Cover book={book}/><div className="mh-book-info"><h3>{book.title}</h3><p>{book.description&&book.description!=='暂无简介'?book.description:'打开这本书，开始一段新的阅读旅程。'}</p><div className="mh-book-meta"><span>{book.category?.split('>').pop()||'综合'} · {book.author||'未知作者'}</span><small>{['completed','完结'].includes(book.status||'')?'完结':'连载'}</small></div></div></BookLink>):<p className="mh-empty">暂时没有书籍</p>}</div>;
}
export default function MobileHome({featured,recommended,newBooks}:{featured:Book[];recommended:Book[];newBooks:Book[]}){
  const router=useRouter();
  const [query,setQuery]=useState('');
  const [mode,setMode]=useState<'home'|'category'|'new'>('home');
  const [category,setCategory]=useState('全部');
  const [page,setPage]=useState(1);
  const [rows,setRows]=useState<Book[]>([]);
  const [total,setTotal]=useState(0);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [retry,setRetry]=useState(0);
  const hero=featured[0];
  useEffect(()=>{
    if(mode==='home')return;
    const controller=new AbortController();
    const params=new URLSearchParams({page:String(page),limit:'20',order:'desc',orderBy:mode==='new'?'createdAt':'views'});
    if(mode==='category'&&category!=='全部')params.set('category',category);
    setLoading(true);setError('');
    safeFetch(`/api/books?${params}`,{signal:controller.signal}).then(async response=>{
      if(!response.ok)throw Error('书籍加载失败，请重试');
      const books:Book[]=await response.json();
      if(!controller.signal.aborted){setRows(books);setTotal(Number(response.headers.get('X-Total-Count')||page*20+(books.length===20?1:0)));}
    }).catch(error=>{if(!controller.signal.aborted)setError(error.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[mode,category,page,retry]);
  function browse(next:'category'|'new'){setMode(next);setPage(1);window.scrollTo({top:0,behavior:'smooth'});}
  return <div className="mobile-home md:hidden">
    <h1 className="sr-only">九天小说 · 精选</h1>
    <form className="mh-search" role="search" onSubmit={event=>{event.preventDefault();if(query.trim())router.push(`/search?q=${encodeURIComponent(query.trim())}`);}}><Search size={21}/><input aria-label="搜索书名或作者" placeholder="搜索书名、作者，发现好故事" value={query} onChange={event=>setQuery(event.target.value)}/>{query&&<button type="submit">搜索</button>}</form>
    {mode==='home'?<>
      {hero&&<BookLink href={`/book/${hero.id}`} className="mh-banner"><div><span className="mh-kicker">九天精选 · 好书推荐</span><h2>{hero.title}</h2><span className="mh-banner-sub">{hero.author||'九天小说'} <ChevronRight size={13}/></span></div><Cover book={hero}/><div className="mh-banner-seal" aria-hidden="true">阅</div></BookLink>}
      <nav className="mh-shortcuts" aria-label="找书入口"><button onClick={()=>browse('category')}><span className="mh-icon coral"><LayoutGrid/></span>分类</button><Link href="/ranking"><span className="mh-icon purple"><Trophy/></span>排行</Link><button onClick={()=>browse('new')}><span className="mh-icon rose"><CalendarDays/></span>新书</button></nav>
      <section className="mh-section"><header><h2>热门精选</h2><Link href="/ranking">更多 <ChevronRight size={14}/></Link></header><BookRows books={featured.slice(0,3)}/></section>
      <section className="mh-section"><header><h2>精选推荐</h2><Link href="/ranking">更多 <ChevronRight size={14}/></Link></header><BookRows books={recommended.slice(0,3)}/></section>
      <section className="mh-section"><header><h2>新书上架</h2><button onClick={()=>browse('new')}>更多 <ChevronRight size={14}/></button></header><BookRows books={newBooks.slice(0,3)}/></section>
    </>:<section className="mh-section mh-browse"><header><button className="mh-back" onClick={()=>setMode('home')}><ArrowLeft size={20}/>返回精选</button><h2>{mode==='new'?'新书上架':'分类找书'}</h2></header>{mode==='category'&&<div className="mh-categories" aria-label="小说分类">{categories.map(name=><button key={name} aria-pressed={category===name} onClick={()=>{setCategory(name);setPage(1);}}>{name}</button>)}</div>}
      {loading?<p className="mh-empty" role="status">正在加载…</p>:error?<p role="alert" className="mh-empty">{error} <button onClick={()=>setRetry(n=>n+1)}>重试</button></p>:<BookRows books={rows}/>}
      <nav className="mh-pagination" aria-label="书籍分页"><button disabled={loading||page===1} onClick={()=>setPage(n=>n-1)}>上一页</button><span>第 {page} 页</span><button disabled={loading||page*20>=total} onClick={()=>setPage(n=>n+1)}>下一页</button></nav>
    </section>}
    <nav className="mh-bottom" aria-label="移动端主导航"><Link href="/library"><Library/><span>书架</span></Link><Link href="/" aria-current="page" onClick={()=>setMode('home')}><Gem/><span>精选</span></Link><Link href="/forum"><MessageCircle/><span>论坛</span></Link><Link href="/profile"><UserRound/><span>我</span></Link></nav>
  </div>;
}
