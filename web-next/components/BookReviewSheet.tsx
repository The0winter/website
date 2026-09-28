'use client';

import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ChevronLeft,X} from 'lucide-react';
import {useRouter} from 'next/navigation';
import {lockBodyScroll} from '@/lib/body-scroll-lock';
import BookReviewList,{type Review} from './BookReviewList';
import BookReviewComposer from './BookReviewComposer';
import {displayReviewContent} from '@/lib/review-content';
import {useReviewFeed} from '@/lib/useReviewFeed';
import BookReviewSkeleton from './BookReviewSkeleton';
import BookReviewReplies from './BookReviewReplies';
import BookReviewReplyComposer from './BookReviewReplyComposer';

type Props={bookId:string;userId:string;preview:Review[];cursor:string|null;total:number;onClose:()=>void;personalReview:Review|null;personalLoading:boolean;personalError:string;onRetryPersonal:()=>void;onSaved:()=>void;initialReply?:Review|null;initialThread?:Review|null};
export default function BookReviewSheet(props:Props) {
  const {onClose}=props;
  const dialog=useRef<HTMLDialogElement>(null),body=useRef<HTMLDivElement>(null);
  const router=useRouter();
  const feed=useReviewFeed(props.bookId,props.preview,props.cursor,props.total);
  const {rows,total,cursor,ready,loading,error}=feed;
  const [replyTarget,setReplyTarget]=useState<Review|null>(props.initialReply||null),[thread,setThread]=useState<Review|null>(props.initialThread||null);
  const reply=(review:Review)=>{if(!props.userId){router.push('/login');return;}setReplyTarget(review);};
  const threadBack=useRef<HTMLButtonElement>(null),savedScroll=useRef(0),threadOpener=useRef<HTMLElement|null>(null);
  const viewThread=(review:Review)=>{savedScroll.current=body.current?.scrollTop||0;threadOpener.current=document.activeElement as HTMLElement;setThread(review);};
  useEffect(()=>{if(thread)threadBack.current?.focus({preventScroll:true});else {body.current?.scrollTo({top:savedScroll.current});threadOpener.current?.focus({preventScroll:true});}},[thread]);
  const [closing,setClosing]=useState(false);
  const closeStarted=useRef(false),closeFinished=useRef(false);
  const finishClose=useCallback(()=>{
    if(closeFinished.current)return;
    closeFinished.current=true;onClose();
  },[onClose]);
  const requestClose=()=>{
    if(closeStarted.current)return;
    closeStarted.current=true;
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){finishClose();return;}
    // Closing during the entrance animation should continue from its current position.
    if(dialog.current)dialog.current.style.setProperty('--review-close-start',getComputedStyle(dialog.current).transform);
    setClosing(true);
  };
  useEffect(()=>{
    if(!closing)return;
    // Keep the modal and scroll lock until the exit finishes, even if animationend is lost.
    const timer=window.setTimeout(finishClose,320);
    return()=>clearTimeout(timer);
  },[closing,finishClose]);
  const [showDuplicates,setShowDuplicates]=useState(false);
  const unique=useMemo(()=>{
    const seen=new Set<string>();
    return rows.filter(row=>{
      const key=displayReviewContent(row).normalize('NFKC').trim().replace(/\s+/gu,' ');
      if(seen.has(key))return false;
      seen.add(key);return true;
    });
  },[rows]);
  const duplicateCount=rows.length-unique.length;
  useEffect(()=>{
    const element=dialog.current!,opener=document.activeElement as HTMLElement|null;
    const unlock=lockBodyScroll();element.showModal();
    // Mobile keyboards can shrink only the visual viewport, leaving dvh unchanged.
    const viewport=window.visualViewport;
    const fitKeyboard=()=>{
      const bottom=viewport&&viewport.scale===1?Math.max(0,window.innerHeight-viewport.height-viewport.offsetTop):0;
      if(viewport&&bottom>80){element.style.bottom=`${bottom}px`;element.style.height=`${viewport.height*.95}px`;element.style.maxHeight=`${viewport.height*.95}px`;}
      else {element.style.removeProperty('bottom');element.style.removeProperty('height');element.style.removeProperty('max-height');}
    };
    viewport?.addEventListener('resize',fitKeyboard);viewport?.addEventListener('scroll',fitKeyboard);fitKeyboard();
    element.querySelector<HTMLButtonElement>('[aria-label="关闭全部评论"]')?.focus({preventScroll:true});
    return()=>{viewport?.removeEventListener('resize',fitKeyboard);viewport?.removeEventListener('scroll',fitKeyboard);element.close();unlock();if(opener?.isConnected)opener.focus({preventScroll:true});};
  },[]);
  return createPortal(<dialog ref={dialog} className="book-review-sheet book-community" aria-label="全部评论" data-closing={closing || undefined} onCancel={event=>{event.preventDefault();requestClose();}}
    onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();requestClose();}}}
    onAnimationEnd={event=>{if(closing&&event.target===event.currentTarget&&event.animationName==='book-review-slide-down')finishClose();}}
    onClick={event=>{if(event.target===event.currentTarget){const r=event.currentTarget.getBoundingClientRect();if(event.clientY<r.top||event.clientX<r.left||event.clientX>r.right)requestClose();}}}>
    <div className="book-review-sheet-handle" aria-hidden="true"/>
    <header className="book-review-sheet-header">{thread&&<button ref={threadBack} className="book-review-sheet-close" aria-label="返回全部评论" onClick={()=>setThread(null)}><ChevronLeft size={22}/></button>}<h2>{thread?'评论回复':<>全部评论 <small>{total}</small></>}</h2><button className="book-review-sheet-close" aria-label="关闭全部评论" onClick={requestClose}><X size={22}/></button></header>
    {thread&&<BookReviewReplies key={thread._id} bookId={props.bookId} review={thread} userId={props.userId}/>}
    <div ref={body} className="book-review-sheet-body" hidden={!!thread} aria-busy={!ready||loading} onScroll={()=>{const el=body.current;if(ready&&el&&el.scrollTop>0&&el.scrollHeight-el.clientHeight-el.scrollTop<220&&!error)feed.more();}}>
      {!ready?(loading&&<BookReviewSkeleton/>):<BookReviewList bookId={props.bookId} reviews={showDuplicates?rows:unique} userId={props.userId} onReply={reply} onViewReplies={viewThread}/>}
      {ready&&duplicateCount>0&&<button className="book-review-duplicates" aria-expanded={showDuplicates} onClick={()=>setShowDuplicates(value=>!value)}>{showDuplicates?'收起重复评论':`已折叠重复评论（${duplicateCount} 条） · 展开`}</button>}
      <div className="book-review-load-more">
        {error?<p role="alert">{error} <button onClick={()=>feed.more(true)}>重试</button></p>:!ready?null:loading?<BookReviewSkeleton count={2}/>:cursor!==null?<button onClick={()=>feed.more()}>加载更多评论</button>:rows.length===0?<p>还没有文字评论，可以先评分，也可以写下读后感。</p>:<p className="book-review-end">已显示全部评论</p>}
      </div>
    </div>
    {!thread&&(replyTarget?<BookReviewReplyComposer key={replyTarget._id} bookId={props.bookId} review={replyTarget} onCancel={()=>setReplyTarget(null)} onSaved={(reply,total)=>{
      feed.update({...replyTarget,replyCount:total,replyPreview:reply});setReplyTarget(null);props.onSaved();
      requestAnimationFrame(()=>body.current?.querySelector(`[data-review-id="${replyTarget._id}"]`)?.scrollIntoView({block:'nearest'}));
    }}/>:<BookReviewComposer bookId={props.bookId} review={props.personalReview} loading={props.personalLoading} error={props.personalError} onRetry={props.onRetryPersonal} onSaved={()=>{
      body.current?.scrollTo({top:0});feed.refresh();props.onSaved();
    }}/>)}
  </dialog>,document.body);
}
