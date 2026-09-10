'use client';

import {useEffect, useRef, type ReactNode} from 'react';

export default function BookCatalogSheet({open, onClose, children}: {open: boolean; onClose: () => void; children: ReactNode}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>('[aria-label="关闭目录"]')?.focus({preventScroll: true}));
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key !== 'Tab' || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),[tabindex="0"]')].filter(element => element.getBoundingClientRect().width > 0);
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keyboard);
    return () => {
      cancelAnimationFrame(frame); document.body.style.overflow = overflow;
      document.removeEventListener('keydown', keyboard);
      if (previousFocus?.isConnected) previousFocus.focus({preventScroll: true});
    };
  }, [open, onClose]);
  return <div className="book-catalog-overlay" data-open={open} aria-hidden={!open} inert={!open} onClick={onClose}>
    <div ref={panel} role="dialog" aria-modal="true" aria-label="全部目录" className="book-catalog-sheet" onClick={event => event.stopPropagation()}>
      {children}
    </div>
  </div>;
}
