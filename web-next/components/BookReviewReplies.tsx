'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import {safeFetch,requestSignal} from '@/lib/request';
import BookReviewList,{type Review} from './BookReviewList';
import BookReviewReply,{type Reply} from './BookReviewReply';
import BookReviewSkeleton from './BookReviewSkeleton';

export default function BookReviewReplies({bookId,review,userId}:{bookId:string;review:Review;userId:string}) {
  const [rows,setRows]=useState<Reply[]>([]),[total,setTotal]=useState(review.replyCount||0),[cursor,setCursor]=useState<string|null>('');
  const [loading,setLoading]=useState(true),[ready,setReady]=useState(false),[error,setError]=useState('');
  const request=useRef<AbortController|null>(null),progress=useRef<string|null>('');
  const load=useCallback(async()=>{
    if(request.current||progress.current===null)return;
    const controller=new AbortController();request.current=controller;setLoading(true);setError('');
    try {
      const query=new URLSearchParams();if(progress.current)query.set('cursor',progress.current);
      const response=await safeFetch(`/api/books/${bookId}/reviews/${review._id}/replies?${query}`,{cache:'no-store',signal:requestSignal(controller.signal)});
      const data=await response.json();
      if(!response.ok||!Array.isArray(data.items))throw Error();
      if(controller.signal.aborted)return;
      setRows(previous=>[...new Map([...previous,...data.items].map(row=>[row._id,row])).values()]);setTotal(data.total);progress.current=data.cursor;setCursor(data.cursor);setReady(true);
    }catch{if(!controller.signal.aborted)setError('回复加载失败，请重试');}
    finally{if(request.current===controller){request.current=null;if(!controller.signal.aborted)setLoading(false);}}
  },[bookId,review._id]);
  useEffect(()=>{const timer=setTimeout(()=>void load(),0);return()=>{clearTimeout(timer);request.current?.abort();request.current=null;};},[load]);
  return <div className="book-review-sheet-body book-review-thread" aria-busy={loading} onScroll={event=>{const el=event.currentTarget;if(el.scrollTop>0&&el.scrollHeight-el.clientHeight-el.scrollTop<200&&!error)void load();}}>
    <div className="book-review-thread-parent"><BookReviewList bookId={bookId} reviews={[review]} userId={userId}/></div>
    <h3>回复 <small>{total}</small></h3>
    {!ready&&loading?<BookReviewSkeleton/>:<div className="book-review-thread-list">{rows.map(reply=><BookReviewReply key={reply._id} reply={reply}/>)}</div>}
    <div className="book-review-load-more">
      {error?<p role="alert">{error} <button onClick={()=>void load()}>重试</button></p>:ready&&loading?<BookReviewSkeleton count={2}/>:cursor!==null&&ready?<button onClick={()=>void load()}>加载更多回复</button>:ready?<p>{rows.length?'已显示全部回复':'还没有回复'}</p>:null}
    </div>
  </div>;
}
