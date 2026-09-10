'use client';

import {useEffect, useRef, useState} from 'react';
import Link from 'next/link';
import {X, MessageCircle} from 'lucide-react';
import {safeFetch} from '@/lib/request';
import {useAuth} from '@/contexts/AuthContext';

type Comment = {id:string; content:string; createdAt:string; user:{id:string; username:string; avatar:string}|null};
type Props = {chapterId:string; paragraph:{key:string;text:string}; onClose:()=>void; onCount:(key:string,count:number)=>void};

export default function ParagraphComments({chapterId,paragraph,onClose,onCount}:Props) {
  const {user} = useAuth();
  const [items,setItems] = useState<Comment[]>([]);
  const [total,setTotal] = useState(0);
  const [page,setPage] = useState(1);
  const [reload,setReload] = useState(0);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [content,setContent] = useState('');
  const [saving,setSaving] = useState(false);
  const [deleting,setDeleting] = useState<string|null>(null);
  const [viewport,setViewport] = useState<{height:number;top:number}|null>(null);
  const request = useRef({text:'',id:''});
  const dialog = useRef<HTMLDivElement>(null);
  const countCallback = useRef(onCount);
  useEffect(() => { countCallback.current=onCount; }, [onCount]);
  const endpoint = `/api/chapters/${chapterId}/paragraph-comments/${paragraph.key}`;

  useEffect(() => {
    const visual=window.visualViewport;
    if(!visual)return;
    const update=()=>setViewport({height:visual.height,top:visual.offsetTop});
    update();visual.addEventListener('resize',update);visual.addEventListener('scroll',update);
    return()=>{visual.removeEventListener('resize',update);visual.removeEventListener('scroll',update);};
  },[]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement|null;
    dialog.current?.focus();
    const handleKey = (event:KeyboardEvent) => {
      if (event.key==='Escape') { event.preventDefault(); onClose(); }
      if (event.key==='Tab') {
        const elements = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a,textarea') || [])];
        const first=elements[0],last=elements.at(-1);
        if (event.shiftKey && (document.activeElement===first || document.activeElement===dialog.current)) {event.preventDefault();last?.focus();}
        else if (!event.shiftKey && document.activeElement===last) {event.preventDefault();first?.focus();}
      }
    };
    document.addEventListener('keydown',handleKey);
    return () => {document.removeEventListener('keydown',handleKey);previous?.focus({preventScroll:true});};
  }, [onClose]);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);setError('');
      try {
        const response=await safeFetch(`${endpoint}?page=${page}`,{signal:controller.signal,cache:'no-store'});
        const data=await response.json();
        if (!response.ok) throw Error(data.error || '评论加载失败');
        if (!controller.signal.aborted) {setItems(data.items);setTotal(data.total);countCallback.current(paragraph.key,data.total);}
      } catch (error) {if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '评论加载失败');}
      finally {if (!controller.signal.aborted) setLoading(false);}
    }
    void load();
    return () => controller.abort();
  }, [endpoint,page,reload,paragraph.key]);

  async function submit(event:React.FormEvent) {
    event.preventDefault();
    if (saving || !content.trim()) return;
    setSaving(true);setError('');
    const text=content.trim();
    if (request.current.text!==text) request.current={text,id:crypto.randomUUID()};
    try {
      const response=await safeFetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:text,requestId:request.current.id})});
      const data=await response.json();
      if (!response.ok) throw Error(data.error || '评论发布失败');
      setContent('');request.current={text:'',id:''};setPage(1);setReload(value=>value+1);
    } catch (error) {setError(error instanceof Error ? error.message : '评论发布失败，请重试');}
    finally {setSaving(false);}
  }
  async function remove(id:string) {
    if (deleting) return;
    setDeleting(id);setError('');
    try {
      const response=await safeFetch(`${endpoint}/${id}`,{method:'DELETE'});
      if (!response.ok) {const data=await response.json();throw Error(data.error || '删除失败');}
      if (items.length===1 && page>1) setPage(value=>value-1);
      else setReload(value=>value+1);
    } catch (error) {setError(error instanceof Error ? error.message : '删除失败');}
    finally {setDeleting(null);}
  }

  return <div className="paragraph-sheet-backdrop" style={viewport?{top:viewport.top,height:viewport.height,bottom:'auto'}:undefined} onClick={onClose}>
    <div ref={dialog} className="paragraph-sheet" style={viewport?{maxHeight:Math.max(220,viewport.height-20)}:undefined} role="dialog" aria-modal="true" aria-labelledby="paragraph-comments-title" tabIndex={-1} onClick={event=>event.stopPropagation()}>
      <header><h2 id="paragraph-comments-title"><MessageCircle size={19}/> 段落评论 <small>{loading?'…':total}</small></h2><button aria-label="关闭段落评论" onClick={onClose}><X size={22}/></button></header>
      <blockquote>{paragraph.text}</blockquote>
      <div className="paragraph-comment-list" aria-busy={loading}>
        {error && <p className="paragraph-error" role="alert">{error} <button onClick={()=>setReload(value=>value+1)}>重试</button></p>}
        {loading ? <p className="paragraph-empty" role="status">正在加载评论…</p> : items.length ? items.map(item=><article key={item.id}>
          <div className="paragraph-comment-byline"><strong>{item.user?.username || '已注销书友'}</strong><time dateTime={item.createdAt}>{item.createdAt.slice(0,10)}</time></div>
          <p>{item.content}</p>
          {(user && (user.id===item.user?.id || user.role==='admin')) && <button className="paragraph-delete" disabled={!!deleting} onClick={()=>remove(item.id)}>{deleting===item.id?'删除中…':'删除'}</button>}
        </article>) : !error && <p className="paragraph-empty">还没有评论，来说说你的看法吧</p>}
        {total>20 && <nav aria-label="段落评论分页"><button disabled={page===1 || loading} onClick={()=>setPage(value=>value-1)}>上一页</button><span>{page} / {Math.ceil(total/20)}</span><button disabled={page*20>=total || loading} onClick={()=>setPage(value=>value+1)}>下一页</button></nav>}
      </div>
      {user ? <form onSubmit={submit}>
        <textarea aria-label="段落评论内容" placeholder="说说你对这一段的看法…" maxLength={1000} value={content} onChange={event=>setContent(event.target.value)} rows={3}/>
        <div><small>{content.length}/1000</small><button type="submit" disabled={saving || !content.trim()}>{saving?'发布中…':'发表评论'}</button></div>
      </form> : <div className="paragraph-login"><Link href="/login">登录后发表评论</Link></div>}
    </div>
  </div>;
}
