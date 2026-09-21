'use client';

import {useEffect, useRef, useState, useSyncExternalStore} from 'react';
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

export default function MobileCategoryPicker({selected, onSelect}: {selected: string; onSelect: (name: string) => void}) {
  const pinned = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const [expanded, setExpanded] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const ordered = pinned ? [mobileCategories[0], mobileCategories.find(item => item.name === pinned)!, ...mobileCategories.filter(item => item.name !== '全部' && item.name !== pinned)] : mobileCategories;
  const primary = ordered.slice(0, 9), more = ordered.slice(9);
  const selectedInMore = more.some(item => item.name === selected);

  useEffect(() => {
    if (!expanded) return;
    const element = dialog.current, overflow = document.body.style.overflow;
    const viewport = matchMedia('(max-width: 767px)');
    const resize = () => {if (!viewport.matches) element?.close();};
    document.body.style.overflow = 'hidden';
    viewport.addEventListener('change', resize);
    return () => {viewport.removeEventListener('change', resize); document.body.style.overflow = overflow; element?.close();};
  }, [expanded]);

  function choose(name: string, fromMore = false) {
    if (fromMore) remember(name);
    dialog.current?.close();
    onSelect(name);
  }
  const categoryButton = ({name, icon: Icon}: typeof mobileCategories[number], fromMore = false) => <button type="button" key={name} aria-pressed={selected === name} onClick={() => choose(name, fromMore)}>
    <Icon className="mh-category-icon" size={18} aria-hidden="true"/>
    <span className={name.length > 3 ? 'mh-category-label-long' : undefined}>{name}</span>
    {selected === name && <Check className="mh-category-check" size={10} aria-hidden="true"/>}
  </button>;

  return <>
    <div className="mh-categories mh-categories-primary" role="group" aria-label="小说分类">
      {primary.map(item => categoryButton(item))}
      <button type="button" className={`mh-category-more${selectedInMore ? ' is-selected' : ''}`} aria-haspopup="dialog" aria-expanded={expanded} aria-controls="mh-more-categories" onClick={() => {dialog.current?.showModal(); setExpanded(true);}}>
        <Ellipsis className="mh-category-icon" size={18} aria-hidden="true"/><span className="mh-category-label-long">更多分类</span>
      </button>
    </div>
    <dialog ref={dialog} id="mh-more-categories" className="mh-category-dialog" aria-labelledby="mh-more-categories-title" onClose={() => setExpanded(false)} onClick={event => {if (event.target === event.currentTarget) dialog.current?.close();}}>
      <div className="mh-category-dialog-content">
        <div className="mh-category-dialog-heading"><h3 id="mh-more-categories-title">更多分类</h3><button type="button" onClick={() => dialog.current?.close()} aria-label="关闭更多分类"><X size={21}/></button></div>
        <p>选中后，固定在“全部”后面</p>
        <div className="mh-categories" role="group" aria-label="更多小说分类">{more.map(item => categoryButton(item, true))}</div>
      </div>
    </dialog>
  </>;
}
