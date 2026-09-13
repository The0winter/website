'use client';

import {useEffect, useRef} from 'react';
import {interruptMobileSectionTransition, navigateMobileSection, startMobileSectionDrag, type MobileSectionDrag} from './mobile-section-navigation';
import {sectionSwipeThreshold} from './section-swipe';

export function useMobileHomeSwipe(enabled: boolean) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = root.current;
    if (!host || !enabled) return;
    let gesture: {x: number; y: number; horizontal: boolean; dx: number; direction?: number; drag?: MobileSectionDrag} | null = null;
    let suppressClick = false;
    const cancel = () => {gesture?.drag?.release(false); gesture = null;};
    const start = (event: TouchEvent) => {
      suppressClick = false;
      cancel();
      if (event.touches.length !== 1 || !matchMedia('(max-width: 767px)').matches ||
        (event.target as Element).closest('button, input, select, textarea, [contenteditable], .mh-bottom, .mh-topbar, dialog')) return;
      const touch = event.touches[0];
      gesture = {x: touch.clientX, y: touch.clientY, horizontal: false, dx: 0};
    };
    const move = (event: TouchEvent) => {
      if (!gesture) return;
      if (event.touches.length !== 1) {cancel(); return;}
      const dx = event.touches[0].clientX - gesture.x, dy = event.touches[0].clientY - gesture.y;
      if (!gesture.horizontal) {
        if (Math.abs(dy) > 12 && Math.abs(dy) >= Math.abs(dx)) {cancel(); return;}
        if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
        if (!interruptMobileSectionTransition()) {cancel(); return;}
        gesture.horizontal = true;
      }
      gesture.dx = dx;
      const direction = Math.sign(dx);
      if (direction && direction !== gesture.direction) {
        gesture.drag?.cancel();
        gesture.direction = direction;
        gesture.drag = startMobileSectionDrag(host, dx > 0 ? 'library' : 'forum');
      }
      gesture.drag?.update(dx);
      suppressClick = true;
      if (event.cancelable) event.preventDefault();
    };
    const end = () => {
      const current = gesture;
      gesture = null;
      if (!current?.horizontal) return;
      const commit = Math.abs(current.dx) >= sectionSwipeThreshold(host.clientWidth);
      if (current.drag) current.drag.release(commit);
      else if (commit) navigateMobileSection(host, current.dx > 0 ? 'library' : 'forum');
    };
    const click = (event: MouseEvent) => {
      // Programmatic bottom-nav activation is intentional; suppress only the
      // touch's generated click so dragging a book never opens its details.
      if (suppressClick && event.isTrusted) {event.preventDefault(); event.stopPropagation(); suppressClick = false;}
    };
    host.addEventListener('touchstart', start, {passive: true});
    host.addEventListener('touchmove', move, {passive: false});
    host.addEventListener('touchend', end);
    host.addEventListener('touchcancel', cancel);
    host.addEventListener('click', click, true);
    window.addEventListener('resize', cancel);
    return () => {
      gesture?.drag?.cancel();
      host.removeEventListener('touchstart', start);
      host.removeEventListener('touchmove', move);
      host.removeEventListener('touchend', end);
      host.removeEventListener('touchcancel', cancel);
      host.removeEventListener('click', click, true);
      window.removeEventListener('resize', cancel);
    };
  }, [enabled]);
  return root;
}
