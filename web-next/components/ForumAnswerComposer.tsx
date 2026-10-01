'use client';
import {useEffect, useRef, useState} from 'react';
import {useAuth} from '@/contexts/AuthContext';
import {forumApi, type ForumPost, type ForumReply} from '@/lib/api';
import {textToForumHtml} from '@/lib/forum-presentation';
import {refreshForum} from '@/lib/forum-cache';
import ForumReaderDialog from './ForumReaderDialog';
import './forum-answer-reader.css';

export default function ForumAnswerComposer({question,onClose,onPublished}:{question:ForumPost;onClose:()=>void;onPublished:(answer:ForumReply)=>void}) {
  const {user}=useAuth();
  const [draft,setDraft]=useState(''),[error,setError]=useState(''),[submitting,setSubmitting]=useState(false);
  const lock=useRef(false),key=`forum-draft:${user?.id||'guest'}:${question.id}`;
  useEffect(()=>{try{setDraft(sessionStorage.getItem(key)||'');}catch{/* Drafts are optional. */}},[key]);
  function changeDraft(value:string){setDraft(value);try{sessionStorage.setItem(key,value);}catch{/* Keep the in-memory draft. */}}
  async function submit(){
    if(!user||!draft.trim()||lock.current)return;
    lock.current=true;setSubmitting(true);setError('');
    try{
      const created=await forumApi.addReply(question.id,{content:textToForumHtml(draft.trim())});
      changeDraft('');refreshForum();
      onPublished({id:created.id,content:created.content,votes:created.likes||0,comments:created.comments||0,time:created.createdAt,hasLiked:false,author:{id:user.id,name:user.username,avatar:user.avatar||'',bio:''}});
    }catch(error){setError(error instanceof Error?error.message:'回答发布失败，请重试');}
    finally{lock.current=false;setSubmitting(false);}
  }
  return <ForumReaderDialog title="写回答" onClose={onClose}><form className="qa-write-form" onSubmit={event=>{event.preventDefault();void submit();}}>
    <p>{question.title}</p><textarea aria-label="回答内容" placeholder="直接写下你的回答…" value={draft} onChange={event=>changeDraft(event.target.value)} maxLength={12000} onKeyDown={event=>{if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();void submit();}}}/>
    {error&&<p className="qa-error" role="alert">{error}</p>}<div><span>{draft.length} / 12000</span><button className="qa-primary" disabled={submitting||!draft.trim()}>{submitting?'发布中…':'发布回答'}</button></div>
  </form></ForumReaderDialog>;
}
