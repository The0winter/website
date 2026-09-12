'use client';

import {useCallback,useLayoutEffect,useRef} from 'react';
import {flushSync} from 'react-dom';
import {readerColumnGap} from '@/lib/reader-layout';
import {readerPaperPosition} from '@/lib/reader-paper';

export type ReaderTurnMode='horizontal'|'scroll'|'vertical';
export const READER_TURN_DURATION_MS=200;
type Options={
  mode:ReaderTurnMode;
  onCommit:(page:number)=>void;
};
type Motion={target:number;direction:number;extent:number;axis:'X'|'Y';moving:HTMLElement;offset:number;settling:boolean;animation?:Animation};

// Only the active page is interactive. A short-lived, inert copy supplies the
// adjacent sheet during a turn; no duplicate chapter trees remain after it.
export function useReaderPageTurn({mode,onCommit}:Options) {
  const viewport=useRef<HTMLDivElement>(null);
  const columns=useRef<HTMLDivElement>(null);
  const textWindow=useRef<HTMLDivElement>(null);
  const surface=useRef<HTMLDivElement>(null);
  const preview=useRef<HTMLDivElement>(null);
  const motion=useRef<Motion|null>(null);
  const cancel=useCallback(()=>{
    const current=motion.current;motion.current=null;
    current?.animation?.cancel();
    for(const element of [surface.current,preview.current]){
      if(!element)continue;
      element.style.transform='';element.style.zIndex='';element.removeAttribute('data-moving');
    }
    preview.current?.replaceChildren();
    preview.current?.setAttribute('hidden','');
    viewport.current?.removeAttribute('data-turning');
  },[viewport,surface,preview]);

  useLayoutEffect(()=>cancel,[cancel,mode]);

  const begin=useCallback((target:number,direction:number,prepared?:HTMLElement,progress?:string)=>{
    if(motion.current?.settling || mode==='scroll')return false;
    if(motion.current?.target===target)return true;
    const frame=viewport.current,body=columns.current,active=surface.current,adjacent=preview.current;
    if(!frame || !body || !active || !adjacent)return false;
    // Read the already-measured sheet before mutating the preview DOM. Reading
    // it after insertion synchronously lays out an entire cloned chapter.
    const box=frame.getBoundingClientRect();
    const step=prepared?0:body.getBoundingClientRect().width+readerColumnGap;
    cancel();
    const clone=(prepared || active).cloneNode(true) as HTMLDivElement;
    clone.style.transform='';clone.removeAttribute('data-moving');
    if(!prepared){
      clone.style.setProperty('--reader-paper-position',readerPaperPosition(target));
      clone.querySelector<HTMLElement>('.reader-columns')!.style.transform=`translateX(${-target*step}px)`;
      const page=clone.querySelector<HTMLElement>('[data-reader-page]');
      if(page)page.textContent=`${target+1}/${page.textContent?.split('/')[1] || 1}`;
      if(progress)clone.querySelector<HTMLElement>('.reader-progress span:last-child')!.textContent=progress;
    }
    clone.removeAttribute('id');
    for(const element of clone.querySelectorAll<HTMLElement>('[id],[tabindex]')){element.removeAttribute('id');element.tabIndex=-1;}
    adjacent.replaceChildren(clone);adjacent.removeAttribute('hidden');
    const axis=mode==='vertical'?'Y':'X',extent=axis==='X'?box.width:box.height;
    const moving=direction>0?active:adjacent;
    active.style.setProperty('z-index',direction>0?'2':'1');adjacent.style.setProperty('z-index',direction>0?'1':'2');
    moving.setAttribute('data-moving',axis);frame.setAttribute('data-turning','dragging');
    motion.current={target,direction,extent,axis,moving,offset:0,settling:false};
    moving.style.setProperty('transform',`translate${axis}(${direction>0?0:-extent}px)`);
    return true;
  },[cancel,viewport,columns,surface,preview,mode]);

  const drag=useCallback((offset:number)=>{
    const current=motion.current;if(!current || current.settling)return;
    current.offset=Math.min(current.extent,Math.max(0,Math.abs(offset)));
    current.moving.style.transform=`translate${current.axis}(${current.direction>0?-current.offset:-current.extent+current.offset}px)`;
  },[]);

  const finish=useCallback((commit:boolean)=>{
    const current=motion.current;if(!current || current.settling)return;
    current.settling=true;
    viewport.current?.setAttribute('data-turning','settling');
    const complete=()=>{
      if(motion.current!==current)return;
      cancel();
      if(commit)flushSync(()=>onCommit(current.target));
    };
    const remaining=commit?current.extent-current.offset:current.offset;
    const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if(reduced || remaining<1 || !current.moving.animate){complete();return;}
    const end=current.direction>0?(commit?-current.extent:0):(commit?0:-current.extent);
    current.animation=current.moving.animate([
      {transform:current.moving.style.transform},
      {transform:`translate${current.axis}(${end}px)`},
    ],{duration:Math.max(120,Math.min(READER_TURN_DURATION_MS,READER_TURN_DURATION_MS*remaining/current.extent)),easing:'cubic-bezier(.22,.68,.22,1)',fill:'forwards'});
    void current.animation.finished.then(complete).catch(()=>{});
  },[viewport,onCommit,cancel]);

  const busy=useCallback(()=>!!motion.current,[]);
  const settling=useCallback(()=>!!motion.current?.settling,[]);
  return {viewport,textWindow,columns,surface,preview,begin,drag,finish,cancel,busy,settling};
}
