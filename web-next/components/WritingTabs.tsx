'use client';

import {useEffect, useRef, useState, type PointerEvent, type ReactNode} from 'react';
import {sectionSwipeThreshold} from '@/lib/section-swipe';

export type WritingTab = 'drafts' | 'published' | 'trash';
type Tab = WritingTab;
type Props = {
  value: Tab; onChange: (tab: Tab) => void; draftCount: number; publishedCount: number; trashCount: number;
  disabled?: boolean; swipeDisabled?: boolean; notice?: ReactNode; children: [ReactNode, ReactNode, ReactNode];
};
const tabs = ['drafts', 'published', 'trash'] as const;

export default function WritingTabs({value, onChange, draftCount, publishedCount, trashCount, disabled, swipeDisabled, notice, children}: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const gesture = useRef<{id: number; x: number; y: number; horizontal: boolean; origin: number} | null>(null);
  const suppressClick = useRef(false);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const index = tabs.indexOf(value);
  const counts = [draftCount, publishedCount, trashCount];
  const cancel = () => {gesture.current = null; setDragging(false); setOffset(0);};

  useEffect(() => {
    const host = root.current;
    // Match the shelf's native-scroll handling: only consume a locked horizontal gesture.
    const move = (event: TouchEvent) => {
      if (gesture.current?.horizontal && event.touches.length === 1 && event.cancelable) event.preventDefault();
    };
    const reset = () => {gesture.current = null; setDragging(false); setOffset(0);};
    host?.addEventListener('touchmove', move, {passive: false});
    window.addEventListener('resize', reset);
    return () => {host?.removeEventListener('touchmove', move); window.removeEventListener('resize', reset);};
  }, []);

  function start(event: PointerEvent<HTMLDivElement>) {
    cancel(); suppressClick.current = false;
    if (!event.isPrimary || event.button !== 0 || disabled || swipeDisabled ||
      (event.target as Element).closest('input, textarea, select, [contenteditable], button:not(.writing-chapter)')) return;
    const active = viewport.current?.querySelector<HTMLElement>('[aria-hidden="false"]');
    const origin = active ? new DOMMatrix(getComputedStyle(active).transform).m41 : 0;
    gesture.current = {id: event.pointerId, x: event.clientX, y: event.clientY, horizontal: false, origin};
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    if (disabled || swipeDisabled) {cancel(); return;}
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.x, dy = event.clientY - current.y;
    if (!current.horizontal) {
      if (Math.abs(dy) > 12 && Math.abs(dy) >= Math.abs(dx)) {cancel(); return;}
      if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
      current.horizontal = true; setDragging(true); event.currentTarget.setPointerCapture(event.pointerId);
    }
    suppressClick.current = true; event.preventDefault();
    const width = viewport.current?.clientWidth || 1;
    const position = -index * width + current.origin + dx;
    const end = -(tabs.length - 1) * width;
    const bounded = position > 0 ? position * .18 : position < end ? end + (position - end) * .18 : position;
    setOffset(bounded + index * width);
  }
  function end(event: PointerEvent<HTMLDivElement>) {
    if (disabled || swipeDisabled) {cancel(); return;}
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.x, dy = event.clientY - current.y;
    if (current.horizontal && Math.abs(dx) >= sectionSwipeThreshold(viewport.current?.clientWidth || 300) && Math.abs(dx) >= Math.abs(dy) * 1.25) {
      onChange(tabs[Math.max(0, Math.min(tabs.length - 1, index + (dx < 0 ? 1 : -1)))]);
    }
    cancel();
  }
  function select(next: Tab) {if (!disabled) {cancel(); onChange(next);}}

  return <div ref={root} className="writing-tab-view" data-dragging={dragging || undefined}
    onDragStart={event => event.preventDefault()}
    onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={cancel}
    onLostPointerCapture={event => {if (event.target === event.currentTarget && gesture.current) cancel();}}
    onClickCapture={event => {if (suppressClick.current && event.nativeEvent.isTrusted) {event.preventDefault(); event.stopPropagation(); suppressClick.current = false;}}}>
    <div className="writing-tabs" role="tablist" aria-label="章节分类" onKeyDown={event => {
      if (disabled || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length;
      select(tabs[next]); root.current?.querySelector<HTMLButtonElement>(`#writing-${tabs[next]}-tab`)?.focus();
    }}>
      {tabs.map((tab, i) => <button key={tab} type="button" role="tab" disabled={disabled} id={`writing-${tab}-tab`} aria-controls={`writing-${tab}`} aria-selected={value === tab} tabIndex={value === tab ? 0 : -1} onClick={() => select(tab)}>
        {['草稿箱', '已发布', '回收站'][i]}{counts[i] > 0 && <span>{counts[i]}</span>}
      </button>)}
    </div>
    {notice}
    <div ref={viewport} className="writing-tab-panels">
      {tabs.map((tab, i) => <div key={tab} className="writing-tab-panel" role="tabpanel" id={`writing-${tab}`} aria-labelledby={`writing-${tab}-tab`} aria-hidden={value !== tab} inert={value !== tab}
        style={{transform: `translate3d(calc(${(i - index) * 100}% + ${offset}px),0,0)`}}>{children[i]}</div>)}
    </div>
  </div>;
}
