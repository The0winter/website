'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import {safeFetch,requestSignal} from './request';
import type {Review} from '@/components/BookReviewList';

type Batch={rows:Review[];cursor:string|null;total:number};
export function useReviewFeed(bookId:string,preview:Review[],initialCursor:string|null,initialTotal:number) {
  const [rows,setRows]=useState(preview),[total,setTotal]=useState(initialTotal),[cursor,setCursor]=useState(initialCursor);
  const [ready,setReady]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const state=useRef({rows:preview,cursor:initialCursor,first:true,replace:false});
  const originalTotal=useRef(initialTotal);
  const request=useRef<AbortController|null>(null),buffer=useRef<Batch|null>(null),wanted=useRef(false),failed=useRef(false);
  const load=useCallback(async(show:boolean,retry=false)=>{
    if(failed.current&&!retry)return;
    if(show)wanted.current=true;
    const accept=(batch:Batch)=>{
      const current=state.current;
      current.rows=[...new Map([...(current.replace?[]:current.rows),...batch.rows].map(row=>[row._id,row])).values()];
      current.cursor=batch.cursor;current.first=false;current.replace=false;
      setRows(current.rows);setTotal(batch.total);setCursor(batch.cursor);setReady(true);setLoading(false);wanted.current=false;buffer.current=null;
    };
    if(buffer.current){if(show)accept(buffer.current);return;}
    if(request.current){if(show)setLoading(true);return;}
    const current=state.current;
    if(!current.first&&current.cursor===null)return;
    failed.current=false;setError('');
    if(show||current.first)setLoading(true);
    const controller=new AbortController();request.current=controller;
    const first=current.first;
    const started=Date.now();
    try {
      let batch:Batch={rows:[],cursor:current.cursor,total:originalTotal.current};
      if(current.cursor!==null||current.replace){
        const query=new URLSearchParams({limit:String(first?Math.max(1,10-current.rows.length):10)});
        if(current.cursor)query.set('cursor',current.cursor);
        const response=await safeFetch(`/api/books/${bookId}/reviews?${query}`,{cache:'no-store',signal:requestSignal(controller.signal)});
        if(!response.ok)throw Error();
        const next=await response.json();if(!Array.isArray(next))throw Error();
        batch={rows:next,cursor:response.headers.get('X-Next-Cursor')||null,total:Number(response.headers.get('X-Total-Count'))||0};
      }
      // Even a completely cached first batch gets the same brief entrance skeleton.
      if(first)await new Promise(resolve=>setTimeout(resolve,Math.max(0,280-(Date.now()-started))));
      if(controller.signal.aborted)return;
      if(first||wanted.current)accept(batch);else buffer.current=batch;
    }catch{if(!controller.signal.aborted){failed.current=true;setError('评论加载失败，请重试');setLoading(false);}}
    finally{if(request.current===controller)request.current=null;}
  },[bookId]);
  useEffect(()=>{const timer=setTimeout(()=>void load(true),0);return()=>{clearTimeout(timer);request.current?.abort();request.current=null;};},[load]);
  // Keep exactly one next batch ready while the reader looks at the current ten.
  useEffect(()=>{if(ready&&cursor!==null)void load(false);},[ready,cursor,rows,load]);
  const more=(retry=false)=>void load(true,retry);
  function refresh() {
    request.current?.abort();request.current=null;buffer.current=null;failed.current=false;
    state.current={rows:[],cursor:'',first:true,replace:true};setReady(false);setLoading(true);void load(true);
  }
  function update(review:Review) {
    state.current.rows=state.current.rows.map(row=>row._id===review._id?review:row);
    setRows(state.current.rows);
  }
  return {rows,total,cursor,ready,loading,error,more,refresh,update};
}
