'use client';
import {useEffect, useRef, type ReactNode} from 'react';
import {X} from 'lucide-react';

export default function ForumReaderDialog({title, onClose, children}: {title:string; onClose:()=>void; children:ReactNode}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {close.current = onClose;}, [onClose]);
  useEffect(() => {
    const overflow = document.body.style.overflow;
    const focus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    panel.current?.focus({preventScroll:true});
    const keydown = (event:KeyboardEvent) => {
      if (event.key === 'Escape') close.current();
      if (event.key !== 'Tab') return;
      const nodes = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],textarea,input,select');
      if (!nodes?.length) return;
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {event.preventDefault(); last.focus();}
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) {event.preventDefault(); first.focus();}
    };
    document.addEventListener('keydown', keydown);
    return () => {document.body.style.overflow = overflow; document.removeEventListener('keydown', keydown); focus?.focus({preventScroll:true});};
  }, []);
  return <div className="qa-dialog-backdrop" onClick={onClose}>
    <div ref={panel} className="qa-dialog" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} onClick={event => event.stopPropagation()}>
      <header><h2>{title}</h2><button aria-label="关闭弹窗" onClick={onClose}><X size={22}/></button></header>
      {children}
    </div>
  </div>;
}
