'use client';

import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {X} from 'lucide-react';
import {safeFetch,requestSignal} from '@/lib/request';
import {lockBodyScroll} from '@/lib/body-scroll-lock';
import BookReviewList,{type Review} from './BookReviewList';
import {LoadingText} from './BrandLoading';
import BookReviewComposer from './BookReviewComposer';

type Props={bookId:string;userId:string;preview:Review[];cursor:string|null;total:number;onClose:()=>void;personalReview:Review|null;personalLoading:boolean;personalError:string;onRetryPersonal:()=>void;onSaved:()=>void};
export default function BookReviewSheet(props:Props) {
  const {onClose}=props;
  const dialog=useRef<HTMLDialogElement>(null),body=useRef<HTMLDivElement>(null);
  const [rows,setRows]=useState(props.preview),[total,setTotal]=useState(props.total);
  const [cursor,setCursor]=useState(props.cursor),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const progress=useRef({cursor:props.cursor,count:props.preview.length,first:true});
  const request=useRef<AbortController|null>(null);
  const failed=useRef(false);
  const replaceNext=useRef(false);
  const [closing,setClosing]=useState(false);
  const closeStarted=useRef(false),closeFinished=useRef(false);
  const finishClose=useCallback(()=>{
    if(closeFinished.current)return;
    closeFinished.current=true;onClose();
  },[onClose]);
  const requestClose=()=>{
    if(closeStarted.current)return;
    closeStarted.current=true;
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){finishClose();return;}
    // Closing during the entrance animation should continue from its current position.
    if(dialog.current)dialog.current.style.setProperty('--review-close-start',getComputedStyle(dialog.current).transform);
    setClosing(true);
  };
  useEffect(()=>{
    if(!closing)return;
    // Keep the modal and scroll lock until the exit finishes, even if animationend is lost.
    const timer=window.setTimeout(finishClose,320);
    return()=>clearTimeout(timer);
  },[closing,finishClose]);
  const [showDuplicates,setShowDuplicates]=useState(false);
  const unique=useMemo(()=>{
    const seen=new Set<string>();
    return rows.filter(row=>{
      const key=(row.isTestData?row.content.replace(/^【测试】/,''):row.content).normalize('NFKC').trim().replace(/\s+/gu,' ');
      if(seen.has(key))return false;
      seen.add(key);return true;
    });
  },[rows]);
  const duplicateCount=rows.length-unique.length;
  const load=useCallback(async(retry=false)=>{
    const state=progress.current;
    if(request.current||state.cursor===null||(failed.current&&!retry))return;
    failed.current=false;
    const controller=new AbortController();request.current=controller;
    setLoading(true);setError('');
    const limit=state.first?Math.max(1,5-state.count):5;
    try {
      const query=new URLSearchParams({limit:String(limit)});if(state.cursor)query.set('cursor',state.cursor);
      const response=await safeFetch(`/api/books/${props.bookId}/reviews?${query}`,{cache:'no-store',signal:requestSignal(controller.signal)});
      if(!response.ok)throw Error('评论加载失败，请重试');
      const next:Review[]=await response.json();
      if(controller.signal.aborted)return;
      const nextCursor=response.headers.get('X-Next-Cursor')||null;
      progress.current={cursor:nextCursor,count:state.count+next.length,first:false};
      if(replaceNext.current){setRows(next);replaceNext.current=false;}
      else setRows(previous=>{const known=new Set(previous.map(row=>row._id));return [...previous,...next.filter(row=>!known.has(row._id))];});
      setTotal(Number(response.headers.get('X-Total-Count'))||0);setCursor(nextCursor);
    }catch{if(!controller.signal.aborted){failed.current=true;setError('评论加载失败，请重试');}}
    finally{if(request.current===controller){request.current=null;if(!controller.signal.aborted)setLoading(false);}}
  },[props.bookId]);
  useEffect(()=>{
    const element=dialog.current!,opener=document.activeElement as HTMLElement|null;
    const unlock=lockBodyScroll();element.showModal();
    // Mobile keyboards can shrink only the visual viewport, leaving dvh unchanged.
    const viewport=window.visualViewport;
    const fitKeyboard=()=>{
      const bottom=viewport&&viewport.scale===1?Math.max(0,window.innerHeight-viewport.height-viewport.offsetTop):0;
      if(viewport&&bottom>80){element.style.bottom=`${bottom}px`;element.style.height=`${viewport.height*.95}px`;element.style.maxHeight=`${viewport.height*.95}px`;}
      else {element.style.removeProperty('bottom');element.style.removeProperty('height');element.style.removeProperty('max-height');}
    };
    viewport?.addEventListener('resize',fitKeyboard);viewport?.addEventListener('scroll',fitKeyboard);fitKeyboard();
    element.querySelector<HTMLButtonElement>('[aria-label="关闭全部评论"]')?.focus({preventScroll:true});
    const start=window.setTimeout(()=>void load(),0);
    return()=>{clearTimeout(start);request.current?.abort();request.current=null;viewport?.removeEventListener('resize',fitKeyboard);viewport?.removeEventListener('scroll',fitKeyboard);element.close();unlock();if(opener?.isConnected)opener.focus({preventScroll:true});};
  },[load]);
  return createPortal(<dialog ref={dialog} className="book-review-sheet book-community" aria-label="全部评论" data-closing={closing || undefined} onCancel={event=>{event.preventDefault();requestClose();}}
    onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();requestClose();}}}
    onAnimationEnd={event=>{if(closing&&event.target===event.currentTarget&&event.animationName==='book-review-slide-down')finishClose();}}
    onClick={event=>{if(event.target===event.currentTarget){const r=event.currentTarget.getBoundingClientRect();if(event.clientY<r.top||event.clientX<r.left||event.clientX>r.right)requestClose();}}}>
    <div className="book-review-sheet-handle" aria-hidden="true"/>
    <header className="book-review-sheet-header"><h2>全部评论 <small>{total}</small></h2><button className="book-review-sheet-close" aria-label="关闭全部评论" onClick={requestClose}><X size={22}/></button></header>
    <div ref={body} className="book-review-sheet-body" aria-busy={loading} onScroll={()=>{const el=body.current;if(el&&el.scrollTop>0&&el.scrollHeight-el.clientHeight-el.scrollTop<120&&!error)void load();}}>
      <BookReviewList bookId={props.bookId} reviews={showDuplicates?rows:unique} userId={props.userId}/>
      {duplicateCount>0&&<button className="book-review-duplicates" aria-expanded={showDuplicates} onClick={()=>setShowDuplicates(value=>!value)}>{showDuplicates?'收起重复评论':`已折叠重复评论（${duplicateCount} 条） · 展开`}</button>}
      <div className="book-review-load-more">
        {error?<p role="alert">{error} <button onClick={()=>void load(true)}>重试</button></p>:loading?<p role="status"><LoadingText>正在加载评论</LoadingText></p>:cursor!==null?<button onClick={()=>void load()}>加载更多评论</button>:rows.length===0?<p>还没有文字评论，可以先评分，也可以写下读后感。</p>:<p className="book-review-end">已折叠无效评论</p>}
      </div>
    </div>
    <BookReviewComposer bookId={props.bookId} review={props.personalReview} loading={props.personalLoading} error={props.personalError} onRetry={props.onRetryPersonal} onSaved={review=>{
      request.current?.abort();request.current=null;failed.current=false;replaceNext.current=true;
      progress.current={cursor:'',count:0,first:true};
      setRows(previous=>[...(review.content.trim()?[review]:[]),...previous.filter(row=>row._id!==review._id)]);
      body.current?.scrollTo({top:0});void load();props.onSaved();
    }}/>
  </dialog>,document.body);
}
