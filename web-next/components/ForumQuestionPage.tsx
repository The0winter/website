'use client';
import {useEffect,useRef,useState} from 'react';
import {useRouter,useSearchParams} from 'next/navigation';
import {ChevronLeft,SquarePen,UserRoundPlus} from 'lucide-react';
import {useAuth} from '@/contexts/AuthContext';
import {forumApi,type ForumPost,type ForumReply} from '@/lib/api';
import {useForumView} from '@/lib/useForumView';
import {plainForumText} from '@/lib/forum-presentation';
import {navigateForumLink} from '@/lib/forum-navigation';
import ForumLink from './ForumLink';
import ForumAnswerComposer from './ForumAnswerComposer';
import ForumReaderDialog from './ForumReaderDialog';
import ForumQuestionLoading from './ForumQuestionLoading';
import UserAvatar from './UserAvatar';
import {forumPageSize} from '@/lib/forum-cache';
import {useForumPagination} from '@/lib/useForumPagination';
import './forum-content.css';
import './forum-question.css';

type Preview=ForumReply & {excerpt?:string;thumbnail?:string};
function AnswerPreview({answer,questionId}:{answer:Preview;questionId:string}) {
  const [imageFailed,setImageFailed]=useState(false);
  const author=answer.source?.author||answer.author.name||'书友';
  const date=new Date(answer.time);
  return <article className="fq-answer" data-answer-id={answer.id}><ForumLink className="fq-answer-link" href={`/forum/${answer.id}?fromQuestion=${questionId}`}>
    <div className="fq-author"><UserAvatar user={{id:answer.author.id,username:author,avatar:answer.author.avatar}}/><span>{author}</span></div>
    <div className="fq-summary" data-image={!!answer.thumbnail&&!imageFailed||undefined}><p>{answer.excerpt??plainForumText(answer.content)}</p>{answer.thumbnail&&!imageFailed&&<img src={answer.thumbnail} alt="回答配图" loading="lazy" onError={()=>setImageFailed(true)}/>}</div>
    <div className="fq-meta"><span>{answer.votes||0} 赞同<span aria-hidden="true"> · </span>{answer.comments||0} 评论</span>{!Number.isNaN(date.getTime())&&<time dateTime={date.toISOString()}>{date.toISOString().slice(0,10)}</time>}</div>
  </ForumLink></article>;
}

export default function ForumQuestionPage({questionId}:{questionId:string}) {
  const router=useRouter(),search=useSearchParams(),{user}=useAuth();
  const order=search.get('sort')==='latest'?'latest':'default';
  const [question,setQuestion]=useState<ForumPost|null>(null),[answers,setAnswers]=useState<Preview[]>([]);
  const [loading,setLoading]=useState(true),[loadingMore,setLoadingMore]=useState(false),[hasMore,setHasMore]=useState(false);
  const [error,setError]=useState(''),[moreError,setMoreError]=useState(''),[retry,setRetry]=useState(0),[page,setPage]=useState(1);
  const [writing,setWriting]=useState(false),[inviteUrl,setInviteUrl]=useState(''),[notice,setNotice]=useState('');
  const generation=useRef(0),moreLock=useRef(false),heading=useRef<HTMLElement>(null);
  const pageSize=useRef(20);
  useForumView(question?.id);
  useEffect(()=>{
    const token=++generation.current;moreLock.current=false;pageSize.current=forumPageSize();
    setLoading(true);setError('');setMoreError('');setLoadingMore(false);setPage(1);
    void Promise.all([forumApi.getById(questionId),forumApi.getAnswerPreviews(questionId,1,order,pageSize.current)]).then(([post,rows])=>{
      if(token!==generation.current)return;
      if(post.type!=='question'){router.replace(`/forum/${post.id}`);return;}
      setQuestion(post);setAnswers(rows);setHasMore(rows.length===pageSize.current && rows.length<post.comments);
    }).catch(error=>{if(token===generation.current)setError(error instanceof Error?error.message:'问题加载失败，请重试');})
      .finally(()=>{if(token===generation.current)setLoading(false);});
    return()=>{generation.current=token+1;};
  },[questionId,order,retry,router,user?.id]);
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),3500);return()=>clearTimeout(timer);},[notice]);
  async function loadMore(){
    if(moreLock.current||!hasMore)return;
    const token=generation.current;moreLock.current=true;setLoadingMore(true);setMoreError('');
    try{
      const rows=await forumApi.getAnswerPreviews(questionId,page+1,order,pageSize.current);
      if(token!==generation.current)return;
      setAnswers(previous=>[...previous,...rows.filter(row=>!previous.some(item=>item.id===row.id))]);setPage(value=>value+1);setHasMore(rows.length===pageSize.current && (page+1)*pageSize.current<(question?.comments ?? Infinity));
    }catch(error){if(token===generation.current)setMoreError(error instanceof Error?error.message:'更多回答加载失败');}
    finally{if(token===generation.current){moreLock.current=false;setLoadingMore(false);}}
  }
  const sentinel=useForumPagination({identity:`${questionId}:${order}:${user?.id || 'guest'}`,enabled:!!question,loading:loading||loadingMore,hasMore,error:error||moreError,
    preload:pageSize.current===5&&page===1,loadMore:()=>void loadMore()});
  function write(){if(user)setWriting(true);else router.push('/login');}
  async function invite(){
    const url=`${location.origin}/forum/question/${questionId}`;
    try{if(navigator.share)await navigator.share({title:question?.title,text:'邀请你回答这个问题',url});else{await navigator.clipboard.writeText(url);setNotice('问题链接已复制，可以发送给想邀请的人');}}
    catch(error){if(!(error instanceof Error&&error.name==='AbortError'))setInviteUrl(url);}
  }
  function back(){
    if(history.length>1)history.back();
    else router.push('/forum');
  }
  function sort(value:'default'|'latest'){
    if(value===order)return;
    if(heading.current&&heading.current.getBoundingClientRect().bottom<54)window.scrollTo({top:0,behavior:'instant'});
    router.replace(`/forum/question/${questionId}${value==='latest'?'?sort=latest':''}`,{scroll:false});
  }
  const actions=<><button className="fq-write" onClick={write}><SquarePen size={19} aria-hidden="true"/>写回答</button><button onClick={()=>void invite()}><UserRoundPlus size={20} aria-hidden="true"/>邀请回答</button></>;
  if(loading&&!question)return <ForumQuestionLoading/>;
  return <div className="forum-surface forum-question-page" data-forum-document={questionId} tabIndex={-1}>
    <nav className="fq-topbar" aria-label="问题导航"><div><button aria-label="返回上一页" onClick={back}><ChevronLeft size={28}/></button></div></nav>
    {!question?<div className="fq-state" role="alert">{error||'问题不存在'}<button onClick={()=>setRetry(value=>value+1)}>重新加载</button></div>:<div className="fq-layout"><section className="fq-main" aria-label="问题与回答列表">
      <header ref={heading} className="fq-heading"><h1>{question.title}</h1>{question.content&&<details><summary>查看问题补充</summary><div className="forum-prose" dangerouslySetInnerHTML={{__html:question.content}}/></details>}</header>
      <div className="fq-tabs"><div role="tablist" aria-label="回答排序"><button role="tab" aria-selected={order==='default'} aria-controls="question-answers" id="question-sort-default" onClick={()=>sort('default')}>默认</button><button role="tab" aria-selected={order==='latest'} aria-controls="question-answers" id="question-sort-latest" onClick={()=>sort('latest')}>最新</button></div><span>全部内容 {question.comments}</span></div>
      <div role="tabpanel" id="question-answers" aria-labelledby={`question-sort-${order}`} aria-busy={loading||loadingMore}>
        {loading?<div className="fq-state" role="status">正在加载回答…</div>:error?<div className="fq-state" role="alert">{error}<button onClick={()=>setRetry(value=>value+1)}>重试</button></div>:<>
          {answers.map(answer=><AnswerPreview key={answer.id} answer={answer} questionId={questionId}/>)}
          {!answers.length?<div className="fq-state"><p>还没有回答，来分享你的看法吧。</p><button onClick={write}>写第一个回答</button></div>:<div ref={sentinel} className="fq-more">{moreError&&<p role="alert">{moreError}</p>}{hasMore?<button disabled={loadingMore} onClick={()=>void loadMore()}>{loadingMore?'正在加载…':moreError?'重试':'加载更多回答'}</button>:<span>已展示全部回答</span>}</div>}
        </>}
      </div>
    </section><aside className="fq-sidebar"><h2>参与讨论</h2>{actions}{question.bookId&&<ForumLink href={`/book/${question.bookId}`}>查看相关书籍</ForumLink>}</aside></div>}
    {question&&<footer className="fq-actions" aria-label="问题操作">{actions}</footer>}
    {writing&&question&&<ForumAnswerComposer question={question} onClose={()=>setWriting(false)} onPublished={answer=>{setWriting(false);const href=`/forum/${answer.id}?fromQuestion=${questionId}`;if(!navigateForumLink(href))router.push(href);}}/>}
    {inviteUrl&&<ForumReaderDialog title="邀请回答" onClose={()=>setInviteUrl('')}><div className="qa-share-fallback"><p>复制问题链接，发送给你想邀请的人：</p><input readOnly aria-label="邀请回答链接" value={inviteUrl} onFocus={event=>event.target.select()}/></div></ForumReaderDialog>}
    {notice&&<div className="qa-toast" role="status">{notice}</div>}
  </div>;
}
