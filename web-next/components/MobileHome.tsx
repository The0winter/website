'use client';
import BookCover from '@/components/BookCover';
import {LoadingText} from './BrandLoading';

import {useEffect,useLayoutEffect,useState} from 'react';
import {useRouter,useSearchParams} from 'next/navigation';
import HomeSearchHeader from './HomeSearchHeader';
import MobileBottomNav from './MobileBottomNav';
import BookLink from './BookLink';
import {BookOpen,LayoutGrid,ChevronRight,ArrowLeft,Flame,Mountain,Building2,ScrollText,Orbit,Sparkles,ScanSearch,Check} from 'lucide-react';
import type {Book} from '@/lib/api';
import {safeFetch} from '@/lib/request';
import {navigateBookLink,syncBookRoute} from '@/lib/book-navigation';
import {useMobileHomeSwipe} from '@/lib/useMobileHomeSwipe';
import './mobile-home.css';
import {MobileHomeSection, MobileHomeShortcuts} from './MobileHomeFrame';

const categories=[
  {name:'全部',icon:LayoutGrid},
  {name:'玄幻',icon:Flame},
  {name:'仙侠',icon:Mountain},
  {name:'都市',icon:Building2},
  {name:'历史',icon:ScrollText},
  {name:'科幻',icon:Orbit},
  {name:'奇幻',icon:Sparkles},
  {name:'悬疑',icon:ScanSearch},
];
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
  const swipeRoot=useMobileHomeSwipe(mode==='home');
  const category=categories.find(({name})=>name===search.get('category'))?.name||'全部';
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
  const hero=featured[0];
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
    <HomeSearchHeader/>
    {mode==='home'?<>
      {hero&&<BookLink href={`/book/${hero.id}`} className="mh-banner"><div><span className="mh-kicker">九天精选 · 好书推荐</span><h2>{hero.title}</h2><span className="mh-banner-sub">{hero.author||'九天小说'} <ChevronRight size={13}/></span></div><Cover book={hero} priority/><div className="mh-banner-seal" aria-hidden="true">阅</div></BookLink>}
      <MobileHomeShortcuts onCategory={()=>browse('category')} onNew={()=>browse('new')}/>
      <MobileHomeSection title="热门精选"><BookRows books={featured.slice(0,3)}/></MobileHomeSection>
      <MobileHomeSection title="精选推荐"><BookRows books={recommended.slice(0,3)}/></MobileHomeSection>
      <MobileHomeSection title="新书上架" onMore={()=>browse('new')}><BookRows books={newBooks.slice(0,3)}/></MobileHomeSection>
    </>:<section className="mh-section mh-browse">
      <header className="mh-browse-header"><button type="button" className="mh-back" onClick={back} aria-label="返回精选"><ArrowLeft size={20} aria-hidden="true"/></button><h2>{mode==='new'?'新书上架':'分类找书'}</h2></header>
      {mode==='category'&&<>
        <div className="mh-categories" role="group" aria-label="小说分类">
          {categories.map(({name,icon:Icon})=><button type="button" key={name} aria-pressed={category===name} onClick={()=>browse('category',1,name,true)}>
            <Icon className="mh-category-icon" size={22} aria-hidden="true"/><span>{name}</span>
            {category===name&&<Check className="mh-category-check" size={12} aria-hidden="true"/>}
          </button>)}
        </div>
        <div className="mh-browse-summary"><h3>{category==='全部'?'全部作品':`${category}作品`}</h3><span>{cached?`共 ${total.toLocaleString('zh-CN')} 本 · `:''}按热度排序</span></div>
      </>}
      {loading?<p className="mh-empty" role="status"><LoadingText>正在加载</LoadingText></p>:error?<p role="alert" className="mh-empty">{error} <button onClick={()=>setRetry(n=>n+1)}>重试</button></p>:<BookRows books={rows}/>}
      <nav className="mh-pagination" aria-label="书籍分页"><button disabled={loading||page===1} onClick={()=>browse(mode,page-1,category,true)}>上一页</button><span>第 {page} 页</span><button disabled={loading||page*20>=total} onClick={()=>browse(mode,page+1,category,true)}>下一页</button></nav>
    </section>}
    {mode==='home'&&<MobileBottomNav/>}
  </div>;
}
