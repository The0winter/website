'use client';
import {useRef, useState} from 'react';
import {LockKeyhole, Trash2, Settings, Pencil} from 'lucide-react';
import {type Book} from '@/lib/api';
import {safeFetch} from '@/lib/request';
import './work-actions.css';
import WorkEditor from './WorkEditor';
import WorkCoverButton from './WorkCoverButton';

export default function WorkActions({book, onChanged}: {book: Book; onChanged: () => void}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const change = async (action: 'delete' | 'private' | 'public') => {
    if (busy) return;
    if (action === 'delete' && !confirm(`确定删除《${book.title}》？${book.manuscriptKey ? '文稿删除后无法恢复。' : '删除后作品及章节将不再显示。'}`)) return;
    setBusy(true); setError('');
    try {
      const url = book.manuscriptKey ? `/api/manuscripts/${book.manuscriptKey}` : `/api/books/${book.id}`;
      const response = await safeFetch(url, {method: action === 'delete' ? 'DELETE' : 'PATCH',
        ...(action !== 'delete' ? {headers: {'Content-Type': 'application/json'}, body: JSON.stringify({visibility: action})} : {})});
      if (!response.ok) throw Error((await response.json()).error || '操作失败，请重试');
      if (menu.current) menu.current.open = false;
      onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : '操作失败，请重试'); }
    finally { setBusy(false); }
  };
  return <div className="work-management">
    <WorkCoverButton book={book} onChanged={onChanged}/>
    <details ref={menu} onKeyDown={event => {if (event.key === 'Escape' && menu.current) {menu.current.open = false; menu.current.querySelector('summary')?.focus();}}}>
      <summary aria-label={`管理《${book.title}》`} title="管理作品"><Settings size={22} aria-hidden="true"/></summary>
      <div className="work-management-menu">
        <button type="button" disabled={busy} onClick={()=>{if(menu.current)menu.current.open=false;setEditing(true);}}><Pencil size={16}/>编辑作品</button>
        <button type="button" disabled={busy || Boolean(book.manuscriptKey)} onClick={() => void change(book.visibility === 'private' ? 'public' : 'private')}><LockKeyhole size={16}/>{book.manuscriptKey ? '已为私密' : book.visibility === 'private' ? '公开作品' : '转为私密'}</button>
        <button type="button" className="work-delete" disabled={busy} onClick={() => void change('delete')}><Trash2 size={16}/>删除作品</button>
      </div>
    </details>
    {error && <p role="alert">{error}</p>}
    {editing && <WorkEditor book={book} onClose={()=>setEditing(false)} onChanged={onChanged}/>}
  </div>;
}
