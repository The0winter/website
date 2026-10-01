'use client';
import {useEffect, useRef, useState, type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {X} from 'lucide-react';
import './forum-dialog.css';

type Dismiss = (after?:()=>void)=>void;
export default function ForumReaderDialog({title, onClose, children, className = ''}: {title:string; onClose:()=>void; children:ReactNode|((dismiss:Dismiss)=>ReactNode); className?:string}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const [closing, setClosing] = useState<{after?:()=>void}|null>(null);
  const dismiss:Dismiss = after => setClosing(previous => previous || {after});
  useEffect(() => {
    if (!closing) return;
    const finish = () => {close.current(); closing.after?.();};
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {finish(); return;}
    const timer = setTimeout(finish,400);
    return () => clearTimeout(timer);
  },[closing]);
  const requestClose = useRef(dismiss);
  useEffect(() => {requestClose.current = dismiss;});
  useEffect(() => {close.current = onClose;}, [onClose]);
  useEffect(() => {
    const overflow = document.body.style.overflow;
    const focus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    panel.current?.focus({preventScroll:true});
    const keydown = (event:KeyboardEvent) => {
      if (event.key === 'Escape') requestClose.current();
      if (event.key !== 'Tab') return;
      const nodes = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],textarea,input,select');
      if (!nodes?.length) return;
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {event.preventDefault(); last.focus();}
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) {event.preventDefault(); first.focus();}
    };
    document.addEventListener('keydown', keydown);
    return () => {document.body.style.overflow = overflow; document.removeEventListener('keydown', keydown); if (focus?.isConnected) focus.focus({preventScroll:true});};
  }, []);
  return createPortal(<div className={`forum-surface qa-dialog-backdrop ${className}`} data-closing={!!closing || undefined} onClick={() => dismiss()}>
    <div ref={panel} className="qa-dialog" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} inert={!!closing} onClick={event => event.stopPropagation()}>
      <header><h2>{title}</h2><button aria-label="关闭弹窗" onClick={() => dismiss()}><X size={22}/></button></header>
      {typeof children === 'function' ? children(dismiss) : children}
    </div>
  </div>, document.body);
}
