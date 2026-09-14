'use client';

import {useEffect, useId, useRef, type PointerEvent} from 'react';
import {Check, MoreHorizontal} from 'lucide-react';

export function chapterLabel(chapter: {title: string; number: number}) {
  const title = chapter.title.trim().replace(/^第\s*[0-9０-９零〇一二三四五六七八九十百千万两]+\s*[章回节]\s*[：:、.．—-]?\s*/, '');
  return `第${chapter.number}章${title ? ` ${title}` : ''}`;
}

export default function WritingChapterRow({chapter, words, status, managing, selected, disabled, onManage, onSelect, onOpen, onPublish, onDelete, onRestore, published, expiresAt}: {
  chapter: {title: string; number: number; updatedAt: string}; words: number; status?: string;
  managing: boolean; selected: boolean; disabled: boolean; onManage: () => void; onSelect: () => void; onOpen: () => void;
  onPublish?: () => void; onDelete?: () => void; onRestore?: () => void; published?: boolean; expiresAt?: string;
}) {
  const menuId = useId();
  const menu = useRef<HTMLDivElement>(null);
  const press = useRef<{timer: ReturnType<typeof setTimeout>; x: number; y: number} | null>(null);
  const suppressClick = useRef(false);
  const title = chapterLabel(chapter);
  const date = chapter.updatedAt ? new Date(chapter.updatedAt) : null;
  const edited = date && Number.isFinite(date.getTime()) ? date : null;
  function cancelPress() {if (press.current) clearTimeout(press.current.timer); press.current = null;}
  useEffect(() => {
    window.addEventListener('scroll', cancelPress, true); window.addEventListener('blur', cancelPress);
    return () => {cancelPress(); window.removeEventListener('scroll', cancelPress, true); window.removeEventListener('blur', cancelPress);};
  }, []);
  useEffect(() => {if (managing || disabled) {cancelPress(); menu.current?.hidePopover();}}, [managing, disabled]);
  function startPress(event: PointerEvent) {
    cancelPress(); suppressClick.current = false;
    if (managing || disabled || !event.isPrimary || event.button !== 0) return;
    press.current = {x: event.clientX, y: event.clientY, timer: setTimeout(() => {
      press.current = null; suppressClick.current = true; onManage();
    }, 500)};
  }
  return <li data-selected={selected} onKeyDown={event => {
    if (event.key === 'Escape' && menu.current?.matches(':popover-open')) {
      event.preventDefault(); event.stopPropagation(); menu.current.hidePopover();
      event.currentTarget.querySelector<HTMLButtonElement>('.writing-chapter-more')?.focus({preventScroll:true});
    }
  }} onPointerDownCapture={() => {suppressClick.current = false;}} onClickCapture={event => {
    if (suppressClick.current) {event.preventDefault(); event.stopPropagation(); suppressClick.current = false;}
  }}>
    <button type="button" className="writing-chapter" disabled={disabled} role={managing ? 'checkbox' : undefined} aria-checked={managing ? selected : undefined}
      aria-label={managing ? `选择：${title}` : undefined}
      onPointerDown={startPress} onPointerUp={cancelPress} onPointerCancel={cancelPress} onPointerLeave={cancelPress}
      onPointerMove={event => {if (press.current && Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > 10) {suppressClick.current = true; cancelPress();}}}
      onContextMenu={event => event.preventDefault()} onDragStart={event => event.preventDefault()}
      onKeyDown={event => {if (!managing && event.shiftKey && event.key === 'F10') {event.preventDefault(); cancelPress(); onManage();}}}
      onClick={() => managing ? onSelect() : onOpen()}>
      <span className="writing-selection" aria-hidden="true"><span>{selected && <Check size={14} strokeWidth={3}/>}</span></span>
      <span className="writing-chapter-details"><strong>{title}</strong><span className="writing-chapter-meta"><small>{status ? `${status} · ` : ''}{words.toLocaleString()} 字</small>
        {edited && <time dateTime={edited.toISOString()} title={edited.toLocaleString('zh-CN')}>{edited.toLocaleString('zh-CN', {month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false})}</time>}
        {expiresAt && <span className="writing-trash-expiry">{new Date(expiresAt).toLocaleString('zh-CN', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})} 后自动清除</span>}
      </span></span>
    </button>
    {!managing && <>
      <button type="button" className="writing-chapter-more" disabled={disabled} aria-label={`更多：${title}`} aria-haspopup="menu" popoverTarget={menuId} onClick={event => {
        const box = event.currentTarget.getBoundingClientRect();
        if (menu.current) {menu.current.style.left = `${Math.max(12, Math.min(innerWidth - 152, box.right - 140))}px`; menu.current.style.top = `${box.bottom + 112 > innerHeight ? Math.max(8,box.top - 108) : box.bottom + 4}px`;}
      }}><MoreHorizontal size={21}/></button>
      <div ref={menu} id={menuId} popover="auto" className="writing-chapter-menu" role="menu" aria-label={`${title}的操作`} onToggle={event => {if (event.newState === 'open') menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({preventScroll:true});}} onKeyDown={event => {
        if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
        event.preventDefault(); const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length]?.focus();
      }}>
        {onRestore ? <button type="button" role="menuitem" onClick={() => {menu.current?.hidePopover(); onRestore();}}>复原</button> : <>
          <button type="button" role="menuitem" disabled={published} onClick={() => {menu.current?.hidePopover(); onPublish?.();}}>发布</button>
          <button type="button" role="menuitem" onClick={() => {menu.current?.hidePopover(); onDelete?.();}}>删除</button>
        </>}
      </div>
    </>}
  </li>;
}

export function WritingBatchDialog({action, count, published, publicWork, onClose, onConfirm}: {
  action: 'delete' | 'publish' | 'restore'; count: number; published: boolean; publicWork: boolean; onClose: () => void; onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {dialog.current?.showModal();}, []);
  const label = action === 'delete' ? '删除' : action === 'restore' ? '复原' : '发布';
  return <dialog ref={dialog} className="writing-batch-dialog" aria-labelledby="writing-batch-title" onCancel={event => {event.preventDefault(); onClose();}}>
    <h2 id="writing-batch-title">{label}选中的 {count} 章？</h2>
    <p>{action === 'delete' ? `选中的章节将移入回收站，七天内可复原，逾期自动清除。${published ? '已发布章节会暂时下架。' : '已发布章节不受影响。'}` : action === 'restore' ? '草稿会回到草稿箱，已发布章节会恢复发布状态。' : `将按章节顺序发布，修改稿会更新原章节。${publicWork ? '' : '首次发布后，作品也会公开。'}`}</p>
    <div><button type="button" autoFocus onClick={onClose}>取消</button><button type="button" className="writing-confirm" onClick={onConfirm}>确认{label}</button></div>
  </dialog>;
}
