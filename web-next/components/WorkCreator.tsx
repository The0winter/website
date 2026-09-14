'use client';

import {useEffect, useRef, useState} from 'react';
import {ImagePlus, Loader2, X} from 'lucide-react';
import {safeFetch} from '@/lib/request';
import type {Book} from '@/lib/api';
import BookCover from './BookCover';
import './work-creator.css';

type Manuscript = {title:string; description:string; cover_image:string; category:string; filename:string; chapters:unknown[]; revision:number};
async function readResult(response:Response) {
  const result=await response.json().catch(()=>({}));
  if(!response.ok) throw Error(result.error || '操作失败，请重试');
  return result;
}

export default function WorkCreator({draftKey, work, embedded, onClose, onComplete}: {
  draftKey?:string; work?:Book; embedded:boolean; onClose:()=>void; onComplete:()=>void;
}) {
  const [title,setTitle]=useState(work?.title || '');
  const [description,setDescription]=useState(work?.description || '');
  const [coverUrl,setCoverUrl]=useState(work?.cover_image || '');
  const [cover,setCover]=useState<File|null>(null);
  const [preview,setPreview]=useState('');
  const [busy,setBusy]=useState(Boolean(work));
  const [loaded,setLoaded]=useState(!work);
  const [dirty,setDirty]=useState(false);
  const [error,setError]=useState('');
  const form=useRef<HTMLFormElement>(null);
  const lock=useRef(false);
  const manuscript=useRef<Manuscript|null>(null);
  const uploaded=useRef<{file:File;url:string}|null>(null);
  const titleLength=Array.from(title).length, descriptionLength=Array.from(description).length;
  const limits=work && !work.manuscriptKey ? {title:100,description:500} : {title:15,description:300};
  const valid=loaded && Boolean(title.trim() && description.trim()) && titleLength<=limits.title && descriptionLength<=limits.description;

  useEffect(()=>{
    if(!work)return;
    let active=true;
    safeFetch(work.manuscriptKey ? '/api/manuscripts/'+work.manuscriptKey : '/api/books/'+work.id).then(readResult).then(data=>{
      if(!active)return;
      if(work.manuscriptKey)manuscript.current=data;
      setTitle(data.title);setDescription(data.description || '');setCoverUrl(data.cover_image || '');setLoaded(true);
    }).catch(reason=>{if(active)setError(reason instanceof Error ? reason.message : '资料读取失败，请关闭后重试');}).finally(()=>{if(active)setBusy(false);});
    return ()=>{active=false;};
  },[work]);
  useEffect(()=>{
    if(!cover)return;
    const url=URL.createObjectURL(cover);setPreview(url);
    return ()=>URL.revokeObjectURL(url);
  },[cover]);
  useEffect(()=>{
    if(!dirty)return;
    const warn=(event:BeforeUnloadEvent)=>event.preventDefault();
    window.addEventListener('beforeunload',warn);
    return ()=>window.removeEventListener('beforeunload',warn);
  },[dirty]);

  const close=()=>{
    if(busy || lock.current || (dirty && !confirm(work ? '修改还未保存，确定关闭？' : '作品还未创建，确定关闭？已填写的内容不会保存。')))return;
    if(form.current)form.current.dataset.dirty='false';
    setDirty(false);
    onClose();
  };
  const save=async()=>{
    if(lock.current || busy || !valid)return;
    lock.current=true;setBusy(true);setError('');
    try {
      let image=coverUrl;
      if(cover) {
        if(uploaded.current?.file!==cover) {
          const body=new FormData();body.append('file',cover);
          const result=await readResult(await safeFetch('/api/upload/cover?purpose=book',{method:'POST',body,signal:AbortSignal.timeout(90000)}));
          uploaded.current={file:cover,url:result.url};
        }
        image=uploaded.current!.url;
      }
      if(work && !work.manuscriptKey) {
        await readResult(await safeFetch('/api/books/'+work.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({title,description,cover_image:image})}));
      } else {
        const original=manuscript.current || {category:'未分类',filename:'',chapters:[],revision:0};
        const body=new FormData();
        // Keep the loaded revision and every chapter; concurrent edits must conflict, never overwrite.
        body.append('manuscript',JSON.stringify({...original,title,description,cover_image:image,action:'draft'}));
        await readResult(await safeFetch('/api/manuscripts/'+(work?.manuscriptKey || draftKey),{method:'PUT',body,signal:AbortSignal.timeout(90000)}));
      }
      if(form.current){form.current.dataset.dirty='false';form.current.dataset.busy='false';}
      setDirty(false);
      onComplete();
    } catch(reason) {setError(reason instanceof Error ? reason.message : '保存失败，请重试');}
    finally {lock.current=false;setBusy(false);}
  };

  return <div className={`work-create${embedded ? ' work-create-embedded' : ''}`}>
    <form ref={form} className="manuscript-form work-create-form" aria-label={work ? '编辑作品' : '创建新作品'} data-dirty={dirty} data-busy={busy} onSubmit={event=>{event.preventDefault();void save();}}>
      {!embedded && <header className="work-create-header"><h1>{work ? '编辑作品' : '创建新作品'}</h1><button type="button" aria-label={work ? '关闭编辑作品' : '关闭新建作品'} disabled={busy} onClick={close}><X size={20}/></button></header>}
      <div className="work-create-fields">
        <div className="work-create-cover-column">
          <label className="work-create-cover">
            <input type="file" accept="image/jpeg,image/png,image/webp" aria-label="上传封面（非必要）" disabled={busy || !loaded} onChange={event=>{
              const file=event.target.files?.[0];event.target.value='';if(!file)return;
              if(!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size>8*1024*1024){setError('封面支持 8 MB 以内的 JPG、PNG、WebP');return;}
              setCover(file);setDirty(true);setError('');
            }}/>
            <span className="work-create-cover-preview">{(cover && preview) || coverUrl ? <BookCover src={(cover && preview) || coverUrl} alt="作品封面预览"/> : <><ImagePlus size={24}/><span>上传封面</span></>}</span>
            <small>封面 · 非必要</small>
          </label>
          {(cover || coverUrl) && <button type="button" className="work-create-remove" disabled={busy || !loaded} onClick={()=>{setCover(null);setPreview('');setCoverUrl('');setDirty(true);}}>移除封面</button>}
        </div>
        <div className="work-create-copy">
          <label htmlFor="work-title">书名 <small>{titleLength} / {limits.title}</small></label>
          <input id="work-title" aria-label="书名" value={title} required disabled={busy || !loaded} aria-invalid={titleLength>limits.title} onChange={event=>{setTitle(event.target.value);setDirty(true);}} placeholder="给故事起个名字"/>
          <label htmlFor="work-description">简介 <small>{descriptionLength} / {limits.description}</small></label>
          <textarea id="work-description" aria-label="简介" rows={4} value={description} required disabled={busy || !loaded} aria-invalid={descriptionLength>limits.description} onChange={event=>{setDescription(event.target.value);setDirty(true);}} placeholder="简单介绍你的故事"/>
        </div>
      </div>
      <footer className="work-create-footer">
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={busy || !valid}>{busy ? <><Loader2 size={18} className="animate-spin"/>{!loaded ? '正在读取' : work ? '正在保存' : '正在创建'}</> : work ? '保存' : '创建'}</button>
      </footer>
    </form>
  </div>;
}
