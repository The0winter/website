'use client';

import {useCallback,useLayoutEffect,useRef} from 'react';
import {flushSync} from 'react-dom';

export type ReaderTurnMode='horizontal'|'scroll'|'vertical';
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

  const begin=useCallback((target:number,direction:number)=>{
    if(motion.current?.settling || mode==='scroll')return false;
    if(motion.current?.target===target)return true;
    cancel();
    const frame=viewport.current,body=columns.current,active=surface.current,adjacent=preview.current;
    if(!frame || !body || !active || !adjacent)return false;
    const clone=body.cloneNode(true) as HTMLDivElement;
    clone.style.transform=`translateX(${-target*(frame.clientWidth+40)}px)`;
    clone.removeAttribute('id');
    for(const element of clone.querySelectorAll<HTMLElement>('[id],[tabindex]')){element.removeAttribute('id');element.tabIndex=-1;}
    adjacent.replaceChildren(clone);adjacent.removeAttribute('hidden');
    const axis=mode==='vertical'?'Y':'X',extent=axis==='X'?frame.clientWidth:frame.clientHeight;
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
    ],{duration:Math.max(120,Math.min(290,290*remaining/current.extent)),easing:'cubic-bezier(.22,.68,.22,1)',fill:'forwards'});
    void current.animation.finished.then(complete).catch(()=>{});
  },[viewport,onCommit,cancel]);

  const busy=useCallback(()=>!!motion.current,[]);
  const settling=useCallback(()=>!!motion.current?.settling,[]);
  return {viewport,columns,surface,preview,begin,drag,finish,cancel,busy,settling};
}
