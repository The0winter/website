'use client';

import {useCallback, useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {BookOpen, LayoutGrid, Flame, Mountain, Building2, ScrollText, Orbit, Sparkles, ScanSearch, Check, Ellipsis, X} from 'lucide-react';

export const mobileCategories = [
  {name: '全部', icon: LayoutGrid}, {name: '玄幻', icon: Flame},
  {name: '仙侠', icon: Mountain}, {name: '都市', icon: Building2},
  {name: '历史', icon: ScrollText}, {name: '科幻', icon: Orbit},
  {name: '奇幻', icon: Sparkles}, {name: '悬疑', icon: ScanSearch},
  {name: '轻小说', icon: BookOpen}, {name: '诸天无限', icon: Sparkles},
  {name: '游戏', icon: LayoutGrid}, {name: '体育', icon: Flame},
  {name: '军事', icon: ScrollText}, {name: '武侠', icon: Mountain},
  {name: '现实', icon: Building2}, {name: '言情', icon: BookOpen},
  {name: '文学', icon: BookOpen},
];
const preferenceKey = 'mobile-home:pinned-category:v1';
const preferenceEvent = 'mobile-home-category-changed';
let remembered: string | null | undefined;
const validCategory = (value: string | null) => mobileCategories.some(category => category.name === value && value !== '全部') ? value : null;
function snapshot() {
  if (remembered === undefined) {
    try {remembered = validCategory(localStorage.getItem(preferenceKey));} catch {remembered = null;}
  }
  return remembered;
}
function subscribe(notify: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === preferenceKey || event.key === null) {remembered = undefined; notify();}
  };
  window.addEventListener('storage', storage);
  window.addEventListener(preferenceEvent, notify);
  return () => {window.removeEventListener('storage', storage); window.removeEventListener(preferenceEvent, notify);};
}
function remember(name: string) {
  remembered = validCategory(name);
  try {localStorage.setItem(preferenceKey, name);} catch { /* Keep the selection for this visit if storage is unavailable. */ }
  window.dispatchEvent(new Event(preferenceEvent));
}
const serverSnapshot = () => null;
const motionDuration = 420;

export default function MobileCategoryPicker({selected, onSelect}: {selected: string; onSelect: (name: string) => void}) {
  const pinned = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const [expanded, setExpanded] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const animation = useRef<Animation | null>(null);
  const closing = useRef(false);
  const ordered = pinned ? [mobileCategories[0], mobileCategories.find(item => item.name === pinned)!, ...mobileCategories.filter(item => item.name !== '全部' && item.name !== pinned)] : mobileCategories;
  const primary = ordered.slice(0, 9), more = ordered.slice(9);
  const selectedInMore = more.some(item => item.name === selected);

  const positionDialog = useCallback(() => {
    const element = dialog.current, button = trigger.current;
    if (!element?.open || !button) return;
    const anchor = button.getBoundingClientRect();
    const margin = 12, gap = 10, width = Math.min(360, innerWidth - margin * 2);
    element.style.width = `${width}px`;
    element.style.maxHeight = 'none';
    const height = element.offsetHeight;
    const below = innerHeight - anchor.bottom - gap - margin;
    const above = anchor.top - gap - margin;
    const placement = below >= height || below >= above ? 'below' : 'above';
    const available = Math.max(0, placement === 'below' ? below : above);
    const left = Math.max(margin, Math.min(anchor.right - width, innerWidth - width - margin));
    const origin = Math.max(20, Math.min(width - 20, anchor.left + anchor.width / 2 - left));
    element.style.maxHeight = `${available}px`;
    element.style.left = `${left}px`;
    element.style.top = `${placement === 'below' ? anchor.bottom + gap : anchor.top - gap - Math.min(height, available)}px`;
    element.style.transformOrigin = `${origin}px ${placement === 'below' ? 'top' : 'bottom'}`;
    element.style.setProperty('--category-anchor', `${origin}px`);
    element.dataset.placement = placement;
  }, []);

  function open() {
    const element = dialog.current;
    if (!element || element.open) return;
    closing.current = false;
    element.dataset.phase = 'opening';
    element.showModal();
    positionDialog();
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const origin = `translateY(${element.dataset.placement === 'below' ? -10 : 10}px) scale(.94)`;
    const enter = element.animate([
      {opacity: 0, transform: reducedMotion ? 'none' : origin},
      {opacity: 1, transform: 'none'},
    ], {duration: motionDuration, easing: 'cubic-bezier(.22,.68,.25,1)'});
    animation.current = enter;
    void enter.finished.then(() => {element.dataset.phase = 'open';}).catch(() => {});
    setExpanded(true);
  }

  function close(afterClose?: () => void) {
    const element = dialog.current;
    if (!element?.open || closing.current) return;
    closing.current = true;
    const current = getComputedStyle(element);
    const from = {opacity: current.opacity, transform: current.transform};
    element.style.setProperty('--category-backdrop-opacity', getComputedStyle(element, '::backdrop').opacity);
    animation.current?.cancel();
    element.dataset.phase = 'closing';
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const exit = element.animate([from, {
      opacity: 0,
      transform: reducedMotion ? 'none' : `translateY(${element.dataset.placement === 'below' ? -10 : 10}px) scale(.94)`,
    }], {duration: motionDuration, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards'});
    animation.current = exit;
    void exit.finished.then(() => {element.close(); afterClose?.();}).catch(() => {});
  }

  useEffect(() => {
    if (!expanded) return;
    const element = dialog.current, overflow = document.body.style.overflow;
    const viewport = matchMedia('(max-width: 767px)');
    const resize = () => {if (!viewport.matches) element?.close(); else positionDialog();};
    document.body.style.overflow = 'hidden';
    viewport.addEventListener('change', resize);
    window.addEventListener('resize', resize);
    return () => {
      viewport.removeEventListener('change', resize);
      window.removeEventListener('resize', resize);
      document.body.style.overflow = overflow;
      animation.current?.cancel();
      element?.close();
    };
  }, [expanded, positionDialog]);

  function choose(name: string, fromMore = false) {
    if (fromMore) close(() => {remember(name); onSelect(name);});
    else onSelect(name);
  }
  const categoryButton = ({name, icon: Icon}: typeof mobileCategories[number], fromMore = false) => <button type="button" key={name} aria-pressed={selected === name} onClick={() => choose(name, fromMore)}>
    <Icon className="mh-category-icon" size={18} aria-hidden="true"/>
    <span className={name.length > 3 ? 'mh-category-label-long' : undefined}>{name}</span>
    {selected === name && <Check className="mh-category-check" size={10} aria-hidden="true"/>}
  </button>;

  return <>
    <div className="mh-categories mh-categories-primary" role="group" aria-label="小说分类">
      {primary.map(item => categoryButton(item))}
      <button ref={trigger} type="button" className={`mh-category-more${selectedInMore ? ' is-selected' : ''}`} aria-haspopup="dialog" aria-expanded={expanded} aria-controls="mh-more-categories" onClick={open}>
        <Ellipsis className="mh-category-icon" size={18} aria-hidden="true"/><span className="mh-category-label-long">更多分类</span>
      </button>
    </div>
    <dialog ref={dialog} id="mh-more-categories" className="mh-category-dialog" aria-labelledby="mh-more-categories-title" onClose={() => {animation.current?.cancel(); closing.current = false; setExpanded(false);}} onCancel={event => {event.preventDefault(); close();}} onClick={event => {if (event.target === event.currentTarget) close();}}>
      <div className="mh-category-dialog-content">
        <div className="mh-category-dialog-heading"><h3 id="mh-more-categories-title">更多分类</h3><button type="button" onClick={() => close()} aria-label="关闭更多分类"><X size={21}/></button></div>
        <p>选中后，固定在“全部”后面</p>
        <div className="mh-categories" role="group" aria-label="更多小说分类">{more.map(item => categoryButton(item, true))}</div>
      </div>
    </dialog>
  </>;
}
