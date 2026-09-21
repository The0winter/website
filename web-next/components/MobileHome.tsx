'use client';
import BookCover from '@/components/BookCover';
import {LoadingText} from './BrandLoading';

import {useEffect,useLayoutEffect,useState} from 'react';
import {useRouter,useSearchParams} from 'next/navigation';
import HomeSearchHeader from './HomeSearchHeader';
import MobileBottomNav from './MobileBottomNav';
import BookLink from './BookLink';
import {BookOpen,ChevronRight,ArrowLeft} from 'lucide-react';
import MobileCategoryPicker, {mobileCategories} from './MobileCategoryPicker';
import type {Book} from '@/lib/api';
import {safeFetch} from '@/lib/request';
import {navigateBookLink,syncBookRoute} from '@/lib/book-navigation';
import {useMobileHomeSwipe} from '@/lib/useMobileHomeSwipe';
import './mobile-home.css';
import {MobileHomeSection, MobileHomeShortcuts} from './MobileHomeFrame';
import {discoverySections} from '@/lib/discovery-sections';

const browseCache = new Map<string, {books: Book[]; total: number}>();
function Cover({book,priority=false}:{book:Book;priority?:boolean}){
  const [failed,setFailed]=useState(false);
  return <div className="mh-cover">{book.cover_image&&!failed?<BookCover priority={priority} sizes="80px" src={book.cover_image} alt={`${book.title}封面`} onError={()=>setFailed(true)}/>:<><BookOpen size={26}/><span>{book.title}</span></>}</div>;
}
function BookRows({books,priority=false}:{books:Book[];priority?:boolean}){
  return <div className="mh-rows">{books.length?books.map(book=><BookLink className="mh-book" key={book.id} href={`/book/${book.id}`}><Cover book={book} priority={priority}/><div className="mh-book-info"><h3>{book.title}</h3><p>{book.description&&book.description!=='暂无简介'?book.description:'打开这本书，开始一段新的阅读旅程。'}</p><div className="mh-book-meta"><span>{book.category?.split('>').pop()||'综合'} · {book.author||'未知作者'}</span><small>{['completed','完结'].includes(book.status||'')?'完结':'连载'}</small></div></div></BookLink>):<p className="mh-empty">暂时没有书籍</p>}</div>;
}
function BookShelf({books,title}:{books:Book[];title:string}){
  return <div className="mh-shelf" role="region" aria-label={`${title}，左右滑动浏览`} tabIndex={0}>{books.map(book=><BookLink className="mh-shelf-book" key={book.id} href={`/book/${book.id}`}><Cover book={book}/><h3>{book.title}</h3><p>{book.category?.split('>').pop()||'综合'}</p></BookLink>)}</div>;
}
export default function MobileHome({books}:{books:Book[]}){
  const router=useRouter();
  const search=useSearchParams();
  const mode=search.get('view')==='new'?'new':search.get('view')==='category'?'category':'home';
  const swipeRoot=useMobileHomeSwipe(mode==='home');
  const category=mobileCategories.find(({name})=>name===search.get('category'))?.name||'全部';
  const requestedPage=Number(search.get('page')||1);
  const page=Number.isSafeInteger(requestedPage)&&requestedPage>0&&requestedPage<=100000?requestedPage:1;
  const key=`${mode}:${category}:${page}`;
  const [result,setResult]=useState<{key:string;books:Book[];total:number}|null>(null);
  const cached=result?.key===key?result:browseCache.get(key);
  const rows=cached?.books||[];
  const total=cached?.total||0;
  const [failure,setFailure]=useState<{key:string;retry:number;message:string}|null>(null);
  const [retry,setRetry]=useState(0);
  const error=failure?.key===key&&failure.retry===retry?failure.message:'';
  const loading=mode!=='home'&&!cached&&!error;
  const hero=books[0];
  const sections=discoverySections.map(section=>({...section,books:books.slice(section.offset,section.offset+section.size)})).filter(section=>section.books.length);
  const query=search.toString();
  useLayoutEffect(()=>{syncBookRoute('/'+(query?`?${query}`:''));},[query]);
  useEffect(()=>{
    if(mode==='home')return;
    const controller=new AbortController();
    const params=new URLSearchParams({page:String(page),limit:'20',order:'desc',orderBy:mode==='new'?'createdAt':'views'});
    if(mode==='category'&&category!=='全部')params.set('category',category);
    safeFetch(`/api/books?${params}`,{signal:controller.signal}).then(async response=>{
      if(!response.ok)throw Error('书籍加载失败，请重试');
      const books:Book[]=await response.json();
      if(!controller.signal.aborted){
        const data={books,total:Number(response.headers.get('X-Total-Count')||page*20+(books.length===20?1:0))};
        browseCache.set(key,data);
        if(browseCache.size>8)browseCache.delete(browseCache.keys().next().value!);
        setResult({key,...data});
        setFailure(null);
      }
    }).catch(error=>{if(!controller.signal.aborted)setFailure({key,retry,message:error.message});});
    return()=>controller.abort();
  },[mode,category,page,key,retry]);
  function browse(next:'category'|'new',nextPage=1,nextCategory=category,replace=false){
    const params=new URLSearchParams({view:next});
    if(next==='category'&&nextCategory!=='全部')params.set('category',nextCategory);
    if(nextPage>1)params.set('page',String(nextPage));
    if(!replace&&navigateBookLink(`/?${params}`))return;
    const state={homeBrowse:replace?Boolean(history.state?.homeBrowse):true};
    if(replace)history.replaceState(state,'',`/?${params}`);else history.pushState(state,'',`/?${params}`);
    window.scrollTo({top:0,behavior:'instant'});
  }
  function back(){if(navigateBookLink('/'))return;if(history.state?.homeBrowse)router.back();else router.replace('/');}
  return <div ref={swipeRoot} className={`mobile-home md:hidden${mode==='home'?'':' mobile-home-browse'}`} data-home-href={'/'+(query?`?${query}`:'')} aria-busy={loading}>
    {mode==='home'?<>
      <HomeSearchHeader/>
      {hero&&<BookLink href={`/book/${hero.id}`} className="mh-banner"><div><span className="mh-kicker">九天精选 · 好书推荐</span><h2>{hero.title}</h2><span className="mh-banner-sub">{hero.author||'九天小说'} <ChevronRight size={13}/></span></div><Cover book={hero} priority/><div className="mh-banner-seal" aria-hidden="true">阅</div></BookLink>}
      <MobileHomeShortcuts onCategory={()=>browse('category')} onNew={()=>browse('new')}/>
      {sections.map((section,index)=><MobileHomeSection key={section.title} title={section.title} layout={section.layout} onMore={()=>browse('category')}>
        {section.layout==='shelf'?<BookShelf books={section.books} title={section.title}/>:<BookRows books={section.books} priority={index===0}/>}
      </MobileHomeSection>)}
      <p className="mh-feed-end">{books.length?'今天的好书先逛到这里':'好故事正在路上'}<button type="button" onClick={()=>browse('category')}>去分类发现更多 <ChevronRight size={13}/></button></p>
    </>:<>
      <header className="mh-browse-header"><div className="mh-browse-titlebar"><button type="button" className="mh-back" onClick={back} aria-label="返回精选"><ArrowLeft size={21} aria-hidden="true"/></button><h2>{mode==='new'?'新书上架':'分类找书'}</h2></div></header>
      <section className="mh-section mh-browse">
      {mode==='category'&&<>
        <MobileCategoryPicker selected={category} onSelect={name=>browse('category',1,name,true)}/>
        <div className="mh-browse-summary"><h3>{category==='全部'?'全部作品':`${category}作品`}</h3><span>{cached?`共 ${total.toLocaleString('zh-CN')} 本 · `:''}按热度排序</span></div>
      </>}
      {loading?<p className="mh-empty" role="status"><LoadingText>正在加载</LoadingText></p>:error?<p role="alert" className="mh-empty">{error} <button onClick={()=>setRetry(n=>n+1)}>重试</button></p>:<BookRows books={rows}/>}
      <nav className="mh-pagination" aria-label="书籍分页"><button disabled={loading||page===1} onClick={()=>browse(mode,page-1,category,true)}>上一页</button><span>第 {page} 页</span><button disabled={loading||page*20>=total} onClick={()=>browse(mode,page+1,category,true)}>下一页</button></nav>
      </section>
    </>}
    {mode==='home'&&<MobileBottomNav/>}
  </div>;
}
