'use client';

import {useEffect, useRef} from 'react';
import {createPortal} from 'react-dom';
import type {Book} from '@/lib/api';
import WorkCreator from './WorkCreator';
import {lockBodyScroll} from '@/lib/body-scroll-lock';

export default function WorkEditor({book, onClose, onChanged}: {book:Book; onClose:()=>void; onChanged:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const close=useRef<()=>void>(()=>{});
  const complete=useRef(false);
  const marker=useRef<string | null>(null);
  const callbacks=useRef({onClose,onChanged});
  useEffect(()=>{callbacks.current={onClose,onChanged};},[onClose,onChanged]);
  useEffect(()=>{
    const element=dialog.current!;
    const opener=document.activeElement as HTMLElement | null;
    const unlockScroll=lockBodyScroll();
    marker.current ||= crypto.randomUUID();
    const id=marker.current;
    if(history.state?.workEditor!==id)history.pushState({...history.state,workEditor:id},'',location.href);
    const pop=()=>{
      if(history.state?.workEditor===id)return;
      const form=element.querySelector<HTMLElement>('form');
      if(form?.dataset.busy==='true' || (form?.dataset.dirty==='true' && !confirm('修改还未保存，确定关闭？'))) {history.forward();return;}
      callbacks.current.onClose();
      if(complete.current)callbacks.current.onChanged();
    };
    close.current=()=>{if(history.state?.workEditor===id)history.back();};
    window.addEventListener('popstate',pop);
    element.showModal();
    return ()=>{
      window.removeEventListener('popstate',pop);
      element.close();
      unlockScroll();
      if(opener?.isConnected)opener.focus({preventScroll:true});
    };
  },[]);
  return createPortal(<dialog ref={dialog} className="work-edit-dialog" aria-label="编辑作品" onCancel={event=>{event.preventDefault();event.stopPropagation();close.current();}}>
    <WorkCreator work={book} embedded={false} onClose={()=>close.current()} onComplete={()=>{complete.current=true;close.current();}}/>
  </dialog>,document.body);
}
