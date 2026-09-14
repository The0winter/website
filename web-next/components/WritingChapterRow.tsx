'use client';

import {useEffect, useRef, type PointerEvent} from 'react';
import {Check} from 'lucide-react';

export function chapterLabel(chapter: {title: string; number: number}) {
  const title = chapter.title.trim().replace(/^第\s*[0-9０-９零〇一二三四五六七八九十百千万两]+\s*[章回节]\s*[：:、.．—-]?\s*/, '');
  return `第${chapter.number}章${title ? ` ${title}` : ''}`;
}

export default function WritingChapterRow({chapter, words, status, managing, selected, disabled, onManage, onSelect, onOpen}: {
  chapter: {title: string; number: number; updatedAt: string}; words: number; status?: string;
  managing: boolean; selected: boolean; disabled: boolean; onManage: () => void; onSelect: () => void; onOpen: () => void;
}) {
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
  useEffect(() => {if (managing || disabled) cancelPress();}, [managing, disabled]);
  function startPress(event: PointerEvent) {
    cancelPress(); suppressClick.current = false;
    if (managing || disabled || !event.isPrimary || event.button !== 0) return;
    press.current = {x: event.clientX, y: event.clientY, timer: setTimeout(() => {
      press.current = null; suppressClick.current = true; onManage();
    }, 500)};
  }
  return <li data-selected={selected} onPointerDownCapture={() => {suppressClick.current = false;}} onClickCapture={event => {
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
        {edited && <time dateTime={edited.toISOString()} title={`最后编辑：${edited.toLocaleString('zh-CN')}`}>最后编辑 {edited.toLocaleString('zh-CN', {month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false})}</time>}
      </span></span>
    </button>
  </li>;
}

export function WritingBatchDialog({action, count, published, publicWork, onClose, onConfirm}: {
  action: 'delete' | 'publish'; count: number; published: boolean; publicWork: boolean; onClose: () => void; onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {dialog.current?.showModal();}, []);
  const label = action === 'delete' ? '删除' : '发布';
  return <dialog ref={dialog} className="writing-batch-dialog" aria-labelledby="writing-batch-title" onCancel={event => {event.preventDefault(); onClose();}}>
    <h2 id="writing-batch-title">{label}选中的 {count} 章？</h2>
    <p>{action === 'delete' ? published ? '这些章节将下架，读者将无法再查看。' : '选中的草稿将被删除，无法恢复；已发布章节不受影响。' : `将按章节顺序发布，修改稿会更新原章节。${publicWork ? '' : '首次发布后，作品也会公开。'}`}</p>
    <div><button type="button" autoFocus onClick={onClose}>取消</button><button type="button" className="writing-confirm" onClick={onConfirm}>确认{label}</button></div>
  </dialog>;
}
