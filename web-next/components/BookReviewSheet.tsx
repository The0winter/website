'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {X} from 'lucide-react';
import {safeFetch,requestSignal} from '@/lib/request';
import {lockBodyScroll} from '@/lib/body-scroll-lock';
import BookReviewList,{type Review} from './BookReviewList';
import {LoadingText} from './BrandLoading';

type Props={bookId:string;title:string;userId:string;preview:Review[];cursor:string|null;total:number;onClose:()=>void;onWrite:()=>void};
export default function BookReviewSheet(props:Props) {
  const dialog=useRef<HTMLDialogElement>(null),body=useRef<HTMLDivElement>(null);
  const [rows,setRows]=useState(props.preview),[total,setTotal]=useState(props.total);
  const [cursor,setCursor]=useState(props.cursor),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const progress=useRef({cursor:props.cursor,count:props.preview.length,first:true});
  const request=useRef<AbortController|null>(null);
  const failed=useRef(false);
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
      setRows(previous=>{const known=new Set(previous.map(row=>row._id));return [...previous,...next.filter(row=>!known.has(row._id))];});
      setTotal(Number(response.headers.get('X-Total-Count'))||0);setCursor(nextCursor);
    }catch{if(!controller.signal.aborted){failed.current=true;setError('评论加载失败，请重试');}}
    finally{if(request.current===controller){request.current=null;if(!controller.signal.aborted)setLoading(false);}}
  },[props.bookId]);
  useEffect(()=>{
    const element=dialog.current!,opener=document.activeElement as HTMLElement|null;
    const unlock=lockBodyScroll();element.showModal();
    element.querySelector<HTMLButtonElement>('[aria-label="关闭全部评论"]')?.focus({preventScroll:true});
    const start=window.setTimeout(()=>void load(),0);
    return()=>{clearTimeout(start);request.current?.abort();request.current=null;element.close();unlock();if(opener?.isConnected)opener.focus({preventScroll:true});};
  },[load]);
  return createPortal(<dialog ref={dialog} className="book-review-sheet book-community" aria-label="全部评论" onCancel={event=>{event.preventDefault();props.onClose();}}
    onClick={event=>{if(event.target===event.currentTarget){const r=event.currentTarget.getBoundingClientRect();if(event.clientY<r.top||event.clientX<r.left||event.clientX>r.right)props.onClose();}}}>
    <div className="book-review-sheet-handle" aria-hidden="true"/>
    <header className="book-review-sheet-header"><div><h2>全部评论 <small>{total}</small></h2><p>{props.title}</p></div><button className="book-review-compose" onClick={props.onWrite}>写书评</button><button className="book-review-sheet-close" aria-label="关闭全部评论" onClick={props.onClose}><X size={22}/></button></header>
    <div ref={body} className="book-review-sheet-body" aria-busy={loading} onScroll={()=>{const el=body.current;if(el&&el.scrollTop>0&&el.scrollHeight-el.clientHeight-el.scrollTop<120&&!error)void load();}}>
      {rows.some(row=>row.isTestData)&&<p className="book-review-test-notice">含 AI 测试评论，测试评分不计入本书评分。</p>}
      <BookReviewList bookId={props.bookId} reviews={rows} userId={props.userId}/>
      <div className="book-review-load-more">
        {error?<p role="alert">{error} <button onClick={()=>void load(true)}>重试</button></p>:loading?<p role="status"><LoadingText>正在加载评论</LoadingText></p>:cursor!==null?<button onClick={()=>void load()}>加载更多评论</button>:<p>{rows.length?'已显示全部评论':'还没有文字评论，可以先评分，也可以写下读后感。'}</p>}
      </div>
    </div>
  </dialog>,document.body);
}
