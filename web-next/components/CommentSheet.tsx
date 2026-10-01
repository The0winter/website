'use client';
import {useCallback,useEffect,useRef,useState,type CSSProperties,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {X} from 'lucide-react';
import {lockBodyScroll} from '@/lib/body-scroll-lock';
import './book-detail.css';

export default function CommentSheet({title,label,closeLabel='关闭评论',onClose,leading,children,className='',duration=240}: {
  title:ReactNode;label:string;closeLabel?:string;onClose:()=>void;leading?:ReactNode;children:ReactNode;className?:string;duration?:number;
}) {
  const dialog=useRef<HTMLDialogElement>(null),close=useRef(onClose),started=useRef(false),finished=useRef(false);
  const [closing,setClosing]=useState(false);
  useEffect(()=>{close.current=onClose;},[onClose]);
  const finishClose=useCallback(()=>{if(!finished.current){finished.current=true;close.current();}},[]);
  const requestClose=()=>{
    if(started.current)return;
    started.current=true;
    if(matchMedia('(prefers-reduced-motion:reduce)').matches){finishClose();return;}
    if(dialog.current)dialog.current.style.setProperty('--review-close-start',getComputedStyle(dialog.current).transform);
    setClosing(true);
  };
  useEffect(()=>{
    if(!closing)return;
    const timer=setTimeout(finishClose,duration+80);
    return()=>clearTimeout(timer);
  },[closing,duration,finishClose]);
  useEffect(()=>{
    const node=dialog.current!,opener=document.activeElement as HTMLElement|null,unlock=lockBodyScroll();
    node.showModal();node.querySelector<HTMLButtonElement>('[data-sheet-close]')?.focus({preventScroll:true});
    const viewport=visualViewport;
    const fitKeyboard=()=>{
      const bottom=viewport&&viewport.scale===1?Math.max(0,innerHeight-viewport.height-viewport.offsetTop):0;
      if(viewport&&bottom>80){node.style.bottom=`${bottom}px`;node.style.height=`${viewport.height*.95}px`;node.style.maxHeight=`${viewport.height*.95}px`;}
      else {node.style.removeProperty('bottom');node.style.removeProperty('height');node.style.removeProperty('max-height');}
    };
    viewport?.addEventListener('resize',fitKeyboard);viewport?.addEventListener('scroll',fitKeyboard);fitKeyboard();
    return()=>{viewport?.removeEventListener('resize',fitKeyboard);viewport?.removeEventListener('scroll',fitKeyboard);node.close();unlock();if(opener?.isConnected)opener.focus({preventScroll:true});};
  },[]);
  return createPortal(<dialog ref={dialog} className={`book-review-sheet book-community ${className}`} aria-label={label} style={{'--comment-sheet-duration':`${duration}ms`} as CSSProperties} data-closing={closing||undefined}
    onCancel={event=>{event.preventDefault();requestClose();}}
    onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();requestClose();}}}
    onAnimationEnd={event=>{if(closing&&event.target===event.currentTarget&&event.animationName==='book-review-slide-down')finishClose();}}
    onClick={event=>{if(event.target===event.currentTarget){const box=event.currentTarget.getBoundingClientRect();if(event.clientY<box.top||event.clientY>box.bottom||event.clientX<box.left||event.clientX>box.right)requestClose();}}}>
    <div className="book-review-sheet-handle" aria-hidden="true"/>
    <header className="book-review-sheet-header">{leading}<h2>{title}</h2><button data-sheet-close className="book-review-sheet-close" aria-label={closeLabel} onClick={requestClose}><X size={22}/></button></header>
    <div className="comment-sheet-content" inert={closing}>{children}</div>
  </dialog>,document.body);
}
