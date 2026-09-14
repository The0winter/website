'use client';

import {useEffect, useRef, useState} from 'react';
import {ImagePlus, Loader2, X} from 'lucide-react';
import {safeFetch} from '@/lib/request';
import BookCover from './BookCover';
import './work-creator.css';

async function readResult(response: Response) {
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(result.error || '创建失败，请重试');
  return result;
}

export default function WorkCreator({draftKey, embedded, onClose, onComplete}: {
  draftKey: string; embedded: boolean; onClose: () => void; onComplete: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [cover, setCover] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const form = useRef<HTMLFormElement>(null);
  const lock = useRef(false);
  const uploaded = useRef<{file: File; url: string} | null>(null);
  const dirty = Boolean(title || description || cover);
  const titleLength = Array.from(title).length;
  const descriptionLength = Array.from(description).length;
  const valid = Boolean(title.trim() && description.trim()) && titleLength <= 15 && descriptionLength <= 300;

  useEffect(() => {
    if (!cover) return;
    const url = URL.createObjectURL(cover);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [cover]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const close = () => {
    if (lock.current || (dirty && !confirm('作品还未创建，确定关闭？已填写的内容不会保存。'))) return;
    onClose();
  };
  const create = async () => {
    if (lock.current || !valid) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      let coverUrl = '';
      if (cover) {
        if (uploaded.current?.file !== cover) {
          const body = new FormData();
          body.append('file', cover);
          const result = await readResult(await safeFetch('/api/upload/cover?purpose=book', {method: 'POST', body, signal: AbortSignal.timeout(90000)}));
          uploaded.current = {file: cover, url: result.url};
        }
        coverUrl = uploaded.current!.url;
      }
      const body = new FormData();
      body.append('manuscript', JSON.stringify({title, description, cover_image: coverUrl, category: '未分类', filename: '', chapters: [], revision: 0, action: 'draft'}));
      await readResult(await safeFetch('/api/manuscripts/' + draftKey, {method: 'PUT', body, signal: AbortSignal.timeout(90000)}));
      // History can close the sheet before React commits the success state.
      if (form.current) {
        form.current.dataset.dirty = 'false';
        form.current.dataset.busy = 'false';
      }
      onComplete();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '创建失败，请重试');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  return <div className={`work-create${embedded ? ' work-create-embedded' : ''}`}>
    <form ref={form} className="manuscript-form work-create-form" aria-label="创建新作品" data-dirty={dirty} data-busy={busy} onSubmit={event => {event.preventDefault(); void create();}}>
      {!embedded && <header className="work-create-header"><h1>创建新作品</h1><button type="button" aria-label="关闭新建作品" disabled={busy} onClick={close}><X size={22}/></button></header>}
      <div className="work-create-fields">
        <label htmlFor="work-title">书名 <small>{titleLength} / 15</small></label>
        <input id="work-title" aria-label="书名" value={title} required disabled={busy} aria-invalid={titleLength > 15} onChange={event => setTitle(event.target.value)} placeholder="给你的故事一个名字"/>
        <label htmlFor="work-description">简介 <small>{descriptionLength} / 300</small></label>
        <textarea id="work-description" aria-label="简介" rows={4} value={description} required disabled={busy} aria-invalid={descriptionLength > 300} onChange={event => setDescription(event.target.value)} placeholder="简单介绍一下你的故事"/>
        <label className="work-create-cover">
          <input type="file" accept="image/jpeg,image/png,image/webp" aria-label="上传封面（非必要）" disabled={busy} onChange={event => {
            const file = event.target.files?.[0]; event.target.value = '';
            if (!file) return;
            if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) {setError('封面支持 8 MB 以内的 JPG、PNG、WebP'); return;}
            setCover(file); setError('');
          }}/>
          <span className="work-create-cover-preview">{cover && preview ? <BookCover src={preview} alt="作品封面预览"/> : <ImagePlus size={28}/>}</span>
          <span><strong>封面 <small>非必要</small></strong><span>{cover ? '点击更换封面' : '点击上传封面'}</span></span>
        </label>
        {cover && <button type="button" className="work-create-remove" disabled={busy} onClick={() => {setCover(null); setPreview('');}}>移除封面</button>}
      </div>
      <footer className="work-create-footer">
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={busy || !valid}>{busy ? <><Loader2 size={20} className="animate-spin"/>正在创建</> : '创建'}</button>
      </footer>
    </form>
  </div>;
}
