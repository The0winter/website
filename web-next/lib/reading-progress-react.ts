'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {safeFetch} from './request';
import {ReadingProgress,accountBoundProgressRequest,type ProgressState,type ReadingPosition,type ReadingAnchor} from './reading-progress';
import {readingPosition,resolveReadingAnchor} from './reading-progress-dom';
import type {Chapter} from './api';

const empty:ProgressState={remote:null,local:null,pending:null,conflict:null,ready:false,error:''};
export function useReadingProgress(account:string|null,book:string,authLoading:boolean){
  const [state,setState]=useState(empty);
  const [owner,setOwner]=useState('');
  const [restore,setRestore]=useState<{position:ReadingPosition|null;token:number}>({position:null,token:0});
  const engine=useRef<ReadingProgress|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  useEffect(()=>{
    if(authLoading)return;
    let live=true,initialized=false;
    const storage={getItem:(key:string)=>window.localStorage.getItem(key),setItem:(key:string,value:string)=>window.localStorage.setItem(key,value)};
    const accountRequest=accountBoundProgressRequest(account,safeFetch,()=>live);
    const controller=new ReadingProgress(account||'guest',book,storage,accountRequest,value=>{
      if(!live)return;setOwner(`${account||'guest'}:${book}`);setState(value);
      if(!initialized&&value.ready){initialized=true;setRestore(old=>({position:value.local,token:old.token+1}));}
    });
    engine.current=controller;
    const background=new Set<ReadingProgress>();
    const refresh=()=>{
      void controller.open();
      if(!account)return;
      // Books left while offline keep their own operation/revision. Reconnect replays
      // those outboxes too; conflicts remain stored for an explicit choice on opening.
      try{for(let index=0;index<localStorage.length;index++){
        const key=localStorage.key(index);if(!key?.startsWith(`reader-progress:v1:${encodeURIComponent(account)}:`)||key===controller.key)continue;
        const saved=JSON.parse(localStorage.getItem(key)||'null');
        if(saved?.account!==account||!saved.pending||saved.conflict||[...background].some(c=>c.book===saved.book))continue;
        const other=new ReadingProgress(account,saved.book,storage,accountRequest,()=>{});background.add(other);
        void other.open().finally(()=>{other.close();background.delete(other);});
      }}catch{/* Disabled storage does not stop the current reader. */}
    };
    const flush=()=>{if(timer.current)clearTimeout(timer.current);void controller.flush();};
    refresh();window.addEventListener('online',refresh);window.addEventListener('focus',refresh);window.addEventListener('pagehide',flush);
    const interval=window.setInterval(()=>{void controller.flush();},10000);
    return()=>{live=false;controller.close();for(const other of background)other.close();engine.current=null;if(timer.current)clearTimeout(timer.current);window.clearInterval(interval);window.removeEventListener('online',refresh);window.removeEventListener('focus',refresh);window.removeEventListener('pagehide',flush);};
  },[account,book,authLoading]);
  const report=useCallback((chapter:Chapter,anchor:ReadingAnchor,intentional=false)=>{
    const controller=engine.current;if(!controller)return;
    controller.record(readingPosition(chapter,anchor),intentional);
    if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>{void controller.flush();},700);
  },[]);
  const contentChanged=useCallback((chapter:Chapter,anchor:ReadingAnchor)=>engine.current?.contentChanged(readingPosition(chapter,anchor)),[]);
  const chooseCloud=useCallback(()=>{const value=engine.current?.chooseCloud()??null;setRestore(old=>({position:value,token:old.token+1}));return value;},[]);
  const chooseLocal=useCallback(async(chapter?:Chapter)=>{
    const controller=engine.current;if(!controller)return;
    const local=controller.state.local;
    const resolved=chapter?resolveReadingAnchor(chapter,local):null;
    const next=chapter&&resolved?readingPosition(chapter,resolved):local;
    if(chapter)setRestore(old=>({position:next,token:old.token+1}));
    await controller.chooseLocal(next);
  },[]);
  const retry=useCallback(()=>{void engine.current?.open();},[]);
  // An account switch must not expose or write the prior account's in-memory anchor.
  const ready=!authLoading&&owner===`${account||'guest'}:${book}`&&state.ready;
  return {state,ready,restore,report,contentChanged,chooseCloud,chooseLocal,retry};
}
