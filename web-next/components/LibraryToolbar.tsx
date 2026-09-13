'use client';

import type {Ref} from 'react';
import {ArrowUpDown} from 'lucide-react';
import type {LibrarySort, LibraryTab} from '@/lib/library-cache';

export const sorts = {combined: '综合排序（默认）', read: '按最近阅读排序', updated: '按最近更新排序'};

export default function LibraryToolbar({tab = 'shelf', sort = 'combined', managing = false, empty = true, tabs, onTab, onManage, onSort}: {
  tab?: LibraryTab; sort?: LibrarySort; managing?: boolean; empty?: boolean; tabs?: Ref<HTMLDivElement>;
  onTab?: (tab: LibraryTab) => void; onManage?: () => void; onSort?: (sort: LibrarySort) => void;
}) {
  return <header className="shelf-toolbar">
    <div ref={tabs} className="shelf-tabs" role="tablist" aria-label="书架与浏览记录">
      {(['history', 'shelf'] as const).map(value => <button key={value} id={`tab-${value}`} role="tab" tabIndex={tab === value ? 0 : -1} aria-selected={tab === value} aria-controls={value === tab ? 'shelf-content' : `shelf-preview-${value}`} onClick={() => onTab?.(value)} onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'ArrowLeft' || event.key === 'Home' ? 'history' : 'shelf';
        onTab?.(next); document.getElementById(`tab-${next}`)?.focus();
      }}>{value === 'shelf' ? '书架' : '浏览记录'}</button>)}
    </div>
    <div className="shelf-actions">
      <button aria-pressed={managing} disabled={!managing && empty} onClick={onManage}>{managing ? '返回' : '管理'}</button>
      <label className="shelf-sort" title={sorts[sort]}><span>排序</span><ArrowUpDown size={13}/><select aria-label="书架排序" value={sort} onChange={event => onSort?.(event.target.value as LibrarySort)}>{Object.entries(sorts).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </div>
  </header>;
}
