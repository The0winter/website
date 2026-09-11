'use client';
import BookCover from '@/components/BookCover';

import {useEffect,useLayoutEffect,useState} from 'react';
import {useRouter,useSearchParams} from 'next/navigation';
import HomeSearchHeader from './HomeSearchHeader';
import Link from './PrefetchLink';
import MobileBottomNav from './MobileBottomNav';
import BookLink from './BookLink';
import {BookOpen,LayoutGrid,Trophy,CalendarDays,ChevronRight,ArrowLeft} from 'lucide-react';
import type {Book} from '@/lib/api';
import {safeFetch} from '@/lib/request';
import {syncBookRoute} from '@/lib/book-navigation';
import './mobile-home.css';

const categories=['全部','玄幻','仙侠','都市','历史','科幻','奇幻','悬疑'];
const browseCache = new Map<string, {books: Book[]; total: number}>();
function Cover({book,priority=false}:{book:Book;priority?:boolean}){
  const [failed,setFailed]=useState(false);
  return <div className="mh-cover">{book.cover_image&&!failed?<BookCover priority={priority} sizes="80px" src={book.cover_image} alt={`${book.title}封面`} onError={()=>setFailed(true)}/>:<><BookOpen size={26}/><span>{book.title}</span></>}</div>;
}
function BookRows({books}:{books:Book[]}){
  return <div className="mh-rows">{books.length?books.map((book,index)=><BookLink className="mh-book" key={book.id} href={`/book/${book.id}`}><Cover book={book} priority={index<3}/><div className="mh-book-info"><h3>{book.title}</h3><p>{book.description&&book.description!=='暂无简介'?book.description:'打开这本书，开始一段新的阅读旅程。'}</p><div className="mh-book-meta"><span>{book.category?.split('>').pop()||'综合'} · {book.author||'未知作者'}</span><small>{['completed','完结'].includes(book.status||'')?'完结':'连载'}</small></div></div></BookLink>):<p className="mh-empty">暂时没有书籍</p>}</div>;
}
export default function MobileHome({featured,recommended,newBooks}:{featured:Book[];recommended:Book[];newBooks:Book[]}){
  const router=useRouter();
  const search=useSearchParams();
  const mode=search.get('view')==='new'?'new':search.get('view')==='category'?'category':'home';
  const category=categories.find(name=>name===search.get('category'))||'全部';
  const requestedPage=Number(search.get('page')||1);
  const page=Number.isSafeInteger(requestedPage)&&requestedPage>0&&requestedPage<=100000?requestedPage:1;
  const key=`${mode}:${category}:${page}`;
  const [result,setResult]=useState<{key:string;books:Book[];total:number}|null>(null);
  const cached=result?.key===key?result:browseCache.get(key);
  const rows=cached?.books||[];
  const total=cached?.total||0;
  const [error,setError]=useState('');
  const [retry,setRetry]=useState(0);
  const loading=mode!=='home'&&!cached&&!error;
  const hero=featured[0];
  const query=search.toString();
  useLayoutEffect(()=>{syncBookRoute('/'+(query?`?${query}`:''));},[query]);
  useEffect(()=>{
    if(mode==='home')return;
    const controller=new AbortController();
    const params=new URLSearchParams({page:String(page),limit:'20',order:'desc',orderBy:mode==='new'?'createdAt':'views'});
    if(mode==='category'&&category!=='全部')params.set('category',category);
    setError('');
    safeFetch(`/api/books?${params}`,{signal:controller.signal}).then(async response=>{
      if(!response.ok)throw Error('书籍加载失败，请重试');
      const books:Book[]=await response.json();
      if(!controller.signal.aborted){
        const data={books,total:Number(response.headers.get('X-Total-Count')||page*20+(books.length===20?1:0))};
        browseCache.set(key,data);
        if(browseCache.size>8)browseCache.delete(browseCache.keys().next().value!);
        setResult({key,...data});
      }
    }).catch(error=>{if(!controller.signal.aborted)setError(error.message);});
    return()=>controller.abort();
  },[mode,category,page,key,retry]);
  function browse(next:'category'|'new',nextPage=1,nextCategory=category,replace=false){
    const params=new URLSearchParams({view:next});
    if(next==='category'&&nextCategory!=='全部')params.set('category',nextCategory);
    if(nextPage>1)params.set('page',String(nextPage));
    const state={homeBrowse:replace?Boolean(history.state?.homeBrowse):true};
    if(replace)history.replaceState(state,'',`/?${params}`);else history.pushState(state,'',`/?${params}`);
    window.scrollTo({top:0,behavior:'instant'});
  }
  function back(){if(history.state?.homeBrowse)router.back();else router.replace('/');}
  return <div className="mobile-home md:hidden">
    <h1 className="sr-only">九天小说 · 精选</h1>
    <HomeSearchHeader/>
    {mode==='home'?<>
      {hero&&<BookLink href={`/book/${hero.id}`} className="mh-banner"><div><span className="mh-kicker">九天精选 · 好书推荐</span><h2>{hero.title}</h2><span className="mh-banner-sub">{hero.author||'九天小说'} <ChevronRight size={13}/></span></div><Cover book={hero} priority/><div className="mh-banner-seal" aria-hidden="true">阅</div></BookLink>}
      <nav className="mh-shortcuts" aria-label="找书入口"><button onClick={()=>browse('category')}><span className="mh-icon coral"><LayoutGrid/></span>分类</button><Link href="/ranking"><span className="mh-icon purple"><Trophy/></span>排行</Link><button onClick={()=>browse('new')}><span className="mh-icon rose"><CalendarDays/></span>新书</button></nav>
      <section className="mh-section"><header><h2>热门精选</h2><Link href="/ranking">更多 <ChevronRight size={14}/></Link></header><BookRows books={featured.slice(0,3)}/></section>
      <section className="mh-section"><header><h2>精选推荐</h2><Link href="/ranking">更多 <ChevronRight size={14}/></Link></header><BookRows books={recommended.slice(0,3)}/></section>
      <section className="mh-section"><header><h2>新书上架</h2><button onClick={()=>browse('new')}>更多 <ChevronRight size={14}/></button></header><BookRows books={newBooks.slice(0,3)}/></section>
    </>:<section className="mh-section mh-browse"><header><button className="mh-back" onClick={back}><ArrowLeft size={20}/>返回精选</button><h2>{mode==='new'?'新书上架':'分类找书'}</h2></header>{mode==='category'&&<div className="mh-categories" aria-label="小说分类">{categories.map(name=><button key={name} aria-pressed={category===name} onClick={()=>browse('category',1,name,true)}>{name}</button>)}</div>}
      {loading?<p className="mh-empty" role="status">正在加载…</p>:error?<p role="alert" className="mh-empty">{error} <button onClick={()=>setRetry(n=>n+1)}>重试</button></p>:<BookRows books={rows}/>}
      <nav className="mh-pagination" aria-label="书籍分页"><button disabled={loading||page===1} onClick={()=>browse(mode,page-1,category,true)}>上一页</button><span>第 {page} 页</span><button disabled={loading||page*20>=total} onClick={()=>browse(mode,page+1,category,true)}>下一页</button></nav>
    </section>}
    <MobileBottomNav/>
  </div>;
}
