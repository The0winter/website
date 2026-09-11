'use client';

import {useEffect, useRef, useState, type PointerEvent} from 'react';

const clamp = (value: number, maximum: number) => Math.max(0, Math.min(maximum, value));

export default function CatalogScrollbar({scroller, contentHeight, controls}: {scroller: HTMLElement | null; contentHeight: number; controls: string}) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{pointer: number; offset: number} | null>(null);
  const [dragging, setDragging] = useState(false);
  const [position, setPosition] = useState({thumb: 48, top: 0, value: 0, maximum: 0});

  useEffect(() => {
    if (!scroller || !track.current) return;
    let frame = 0;
    const measure = () => {
      const height = track.current?.clientHeight ?? 0;
      const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const thumb = Math.min(height, Math.max(48, height * scroller.clientHeight / Math.max(1, scroller.scrollHeight)));
      const value = clamp(scroller.scrollTop, maximum);
      setPosition({thumb, top: maximum ? value / maximum * (height - thumb) : 0, value, maximum});
    };
    const schedule = () => {cancelAnimationFrame(frame); frame = requestAnimationFrame(measure);};
    const observer = new ResizeObserver(schedule);
    observer.observe(track.current);
    observer.observe(scroller);
    // Virtuoso changes this wrapper's height as batches load and rows are measured.
    if (scroller.firstElementChild) observer.observe(scroller.firstElementChild);
    scroller.addEventListener('scroll', schedule, {passive: true});
    schedule();
    return () => {observer.disconnect(); scroller.removeEventListener('scroll', schedule); cancelAnimationFrame(frame);};
  }, [scroller, contentHeight]);

  const seek = (event: PointerEvent<HTMLDivElement>) => {
    if (!scroller || !track.current || drag.current?.pointer !== event.pointerId) return;
    const height = track.current.clientHeight;
    const thumb = Math.min(height, Math.max(48, height * scroller.clientHeight / Math.max(1, scroller.scrollHeight)));
    const travel = height - thumb;
    if (travel <= 0) return;
    const top = event.clientY - track.current.getBoundingClientRect().top - drag.current.offset * thumb;
    scroller.scrollTo({top: clamp(top / travel, 1) * (scroller.scrollHeight - scroller.clientHeight), behavior: 'instant'});
  };
  const end = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointer !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return <div ref={track} role="scrollbar" aria-label="快速滚动目录" aria-controls={controls} aria-orientation="vertical"
    aria-valuemin={0} aria-valuemax={Math.round(position.maximum)} aria-valuenow={Math.round(position.value)}
    aria-valuetext={`${position.maximum ? Math.round(position.value / position.maximum * 100) : 0}%`}
    aria-hidden={position.maximum <= 1} tabIndex={position.maximum > 1 ? 0 : -1}
    className="book-catalog-scrollbar" data-visible={position.maximum > 1} data-dragging={dragging}
    onPointerDown={event => {
      if (!event.isPrimary || event.button !== 0 || !position.maximum) return;
      event.preventDefault();
      const thumb = event.currentTarget.querySelector('.book-catalog-thumb')!.getBoundingClientRect();
      const onThumb = event.clientY >= thumb.top && event.clientY <= thumb.bottom;
      drag.current = {pointer: event.pointerId, offset: onThumb ? (event.clientY - thumb.top) / thumb.height : .5};
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.focus({preventScroll: true});
      setDragging(true);
      seek(event);
    }}
    onPointerMove={seek} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}
    onKeyDown={event => {
      if (!scroller) return;
      const destinations: Record<string, number> = {
        ArrowDown: scroller.scrollTop + 58, ArrowUp: scroller.scrollTop - 58,
        PageDown: scroller.scrollTop + scroller.clientHeight, PageUp: scroller.scrollTop - scroller.clientHeight,
        Home: 0, End: scroller.scrollHeight,
      };
      if (event.key in destinations) {event.preventDefault(); event.stopPropagation(); scroller.scrollTo({top: destinations[event.key], behavior: 'instant'});}
    }}>
    <span aria-hidden="true" className="book-catalog-thumb" style={{height: position.thumb, transform: `translateY(${position.top}px)`}}/>
  </div>;
}
