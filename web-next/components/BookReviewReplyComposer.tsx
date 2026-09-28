'use client';

import {useEffect,useRef,useState} from 'react';
import {X} from 'lucide-react';
import {safeFetch} from '@/lib/request';
import type {Review} from './BookReviewList';
import type {Reply} from './BookReviewReply';

export default function BookReviewReplyComposer({bookId,review,onCancel,onSaved}:{bookId:string;review:Review;onCancel:()=>void;onSaved:(reply:Reply,total:number)=>void}) {
  const [content,setContent]=useState(''),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const textarea=useRef<HTMLTextAreaElement>(null),pending=useRef(false),request=useRef({text:'',id:''});
  const length=Array.from(content.trim()).length;
  const name=(review.user?.username||'已注销用户').replace(/（测试）$/,'');
  useEffect(()=>{textarea.current?.focus({preventScroll:true});},[]);
  async function submit() {
    if(pending.current||!length||length>1000)return;
    pending.current=true;setSaving(true);setError('');
    const text=content.trim();
    if(request.current.text!==text)request.current={text,id:crypto.randomUUID()};
    try {
      const response=await safeFetch(`/api/books/${bookId}/reviews/${review._id}/replies`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:text,requestId:request.current.id})});
      const data=await response.json();
      if(!response.ok)throw Error(data.error||'回复发布失败，请重试');
      onSaved(data.reply,data.total);
    }catch(error){setError(error instanceof Error?error.message:'回复发布失败，请重试');}
    finally{pending.current=false;setSaving(false);}
  }
  return <footer className="book-review-composer book-review-reply-composer">
    <form onSubmit={event=>{event.preventDefault();void submit();}}>
      <div className="book-review-compose-bar">
        <textarea ref={textarea} aria-label={`回复 ${name}`} placeholder={`回复 ${name}`} rows={1} maxLength={2000} value={content} readOnly={saving}
          onChange={event=>{setContent(event.target.value);event.target.style.height='auto';event.target.style.height=`${Math.min(132,event.target.scrollHeight)}px`;}}/>
        <button className="book-review-compose-send" type="submit" disabled={saving||!length||length>1000}>{saving?'发送中':'发送'}</button>
        <button type="button" className="book-review-reply-cancel" aria-label="取消回复" disabled={saving} onClick={onCancel}><X size={19}/></button>
      </div>
      {length>1000&&<p className="book-review-error">回复最多 1000 字</p>}
      {error&&<p className="book-review-error" role="alert">{error}</p>}
    </form>
  </footer>;
}
