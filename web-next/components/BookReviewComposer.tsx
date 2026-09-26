'use client';

import {useRef,useState} from 'react';
import {Star} from 'lucide-react';
import {useRouter} from 'next/navigation';
import {useAuth} from '@/contexts/AuthContext';
import {safeFetch} from '@/lib/request';
import UserAvatar from './UserAvatar';
import type {Review} from './BookReviewList';

type Props={bookId:string;review:Review|null;loading:boolean;error:string;onRetry:()=>void;onSaved:(review:Review)=>void};

export default function BookReviewComposer(props:Props) {
  const {user,loading}=useAuth();
  const router=useRouter();
  if(loading||props.loading||props.error||!user)return <footer className="book-review-composer">
    <div className="book-review-compose-bar"><UserAvatar user={user} className="book-review-avatar"/>
      <button className="book-review-input-placeholder" disabled={loading||props.loading} onClick={()=>props.error?props.onRetry():router.push('/login')}>
        {loading||props.loading?'正在准备评论…':props.error?'个人书评读取失败，点击重试':'登录后说说你的看法…'}
      </button>
    </div>
  </footer>;
  return <ComposerForm key={user.id} {...props} user={user}/>;
}

function ComposerForm({bookId,review,onSaved,user}:Props&{user:{username:string;avatar?:string}}) {
  const [expanded,setExpanded]=useState(false),[content,setContent]=useState(review?.content||''),[rating,setRating]=useState(review?.rating||0);
  const [saving,setSaving]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState('');
  const textarea=useRef<HTMLTextAreaElement>(null),pending=useRef(false);
  const length=Array.from(content.trim()).length;
  async function submit(){
    if(pending.current||!rating||length>140)return;
    pending.current=true;setSaving(true);setError('');setSaved('');
    try{
      const response=await safeFetch(`/api/books/${bookId}/reviews`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rating,content})});
      const data=await response.json();
      if(!response.ok)throw Error(data.error||data.message||'评论保存失败，请重试');
      setContent(data.content||'');setExpanded(false);textarea.current?.blur();setSaved(content.trim()?'评论已保存':'评分已保存');onSaved(data);
    }catch(error){setError(error instanceof Error?error.message:'评论保存失败，请重试');}
    finally{pending.current=false;setSaving(false);}
  }
  return <footer className="book-review-composer" data-expanded={expanded}>
    <form onSubmit={event=>{event.preventDefault();void submit();}}>
      <div className="book-review-compose-bar"><UserAvatar user={user} className="book-review-avatar"/>
        <textarea ref={textarea} aria-label="写下你的评论" aria-describedby="sheet-review-limit" aria-invalid={length>140} rows={expanded?3:1}
          value={content} maxLength={280} readOnly={saving} placeholder="说说你的看法…" onFocus={()=>{setExpanded(true);setSaved('');}}
          onChange={event=>setContent(event.target.value)}/>
      </div>
      {expanded&&<div className="book-review-compose-options">
        <div role="group" aria-label="选择评分，最低 2 分，最高 10 分" className="book-review-compose-stars">
          {[1,2,3,4,5].map(star=><button key={star} type="button" aria-label={`${star*2} 分（${star} 星）`} aria-pressed={rating===star} disabled={saving} onClick={()=>setRating(star)}><Star size={21} aria-hidden="true" className={star<=rating?'is-selected':''}/></button>)}
        </div>
        <span id="sheet-review-limit" className={length>140?'is-invalid':''}>{length}/140 字</span>
        <button className="book-review-compose-send" type="submit" disabled={saving||!rating||length>140}>{saving?'保存中…':content.trim()?'发布':'提交评分'}</button>
        <button type="button" className="book-review-compose-collapse" disabled={saving} onClick={()=>setExpanded(false)}>收起</button>
        <small>{review?'重新提交会更新你的原书评。':'请选择星级，短评可不填。'}</small>
      </div>}
      {error&&<p className="book-review-error" role="alert">{error}</p>}
      {saved&&<p className="book-review-compose-status" role="status">{saved}</p>}
    </form>
  </footer>;
}
