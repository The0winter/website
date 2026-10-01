'use client';
import ShareArrow from '@/components/ShareArrow';
import {useCallback, useEffect, useRef, useState, type CSSProperties} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {ArrowLeft, ChevronsDown, List, MessageCircle, PenLine, MoreHorizontal, ThumbsUp} from 'lucide-react';
import {useAuth} from '@/contexts/AuthContext';
import {useReadingSettings} from '@/contexts/ReadingSettingsContext';
import {forumApi, type ForumPost, type ForumReply} from '@/lib/api';
import {plainForumText, textToForumHtml} from '@/lib/forum-presentation';
import {refreshForum} from '@/lib/forum-cache';
import {useForumView} from '@/lib/useForumView';
import ForumReaderDialog from './ForumReaderDialog';
import ForumReplyComments from './ForumReplyComments';
import ForumSourceCredit from './ForumSourceCredit';
import './forum-content.css';
import './forum-answer-reader.css';

import {FORUM_DEFAULT_FONT_SIZE,readForumFontSize,saveForumFontSize} from '@/lib/forum-reader-settings';
import ForumLoadingShell from './ForumLoadingShell';
import {afterForumNavigation} from '@/lib/forum-navigation';
type Checkpoint = {page:number; answerId:string; offset:number};
const authorName = (answer:ForumReply) => answer.source?.author || answer.author.name || '书友';
const unique = (rows:ForumReply[]) => rows.filter((row, index) => rows.findIndex(item => item.id === row.id) === index);
function Avatar({answer}: {answer:ForumReply}) {
  return <span className="qa-avatar" aria-hidden="true">{answer.author.avatar ? <img src={answer.author.avatar} alt=""/> : authorName(answer).slice(0, 1)}</span>;
}

export default function ForumAnswerReader({questionId, initialAnswerId, openComments = false}: {questionId:string; initialAnswerId?:string; openComments?:boolean}) {
  const router = useRouter();
  const {user} = useAuth();
  const {theme, setTheme} = useReadingSettings();
  const [question, setQuestion] = useState<ForumPost|null>(null);
  const [answers, setAnswers] = useState<ForumReply[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [moreError, setMoreError] = useState('');
  const [retry, setRetry] = useState(0);
  const [activeId, setActiveId] = useState('');
  const [dialog, setDialog] = useState<'answers'|'settings'|'write'|null>(null);
  const [commentId, setCommentId] = useState<string|null>(null);
  const [fontSize, setFontSize] = useState(FORUM_DEFAULT_FONT_SIZE);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [writeError, setWriteError] = useState('');
  const [notice, setNotice] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const [pendingLikes, setPendingLikes] = useState<Set<string>>(new Set());
  const cards = useRef(new Map<string, HTMLElement>());
  const sentinel = useRef<HTMLDivElement>(null);
  const generation = useRef(0), moreLock = useRef(false), submitLock = useRef(false);
  const likeLocks = useRef(new Set<string>());
  const checkpoint = useRef<Checkpoint|null>(null), restored = useRef(false);
  const positionKey = `forum-position:${questionId}:${initialAnswerId || 'all'}`;
  const draftKey = `forum-draft:${user?.id || 'guest'}:${questionId}`;
  useForumView(question?.id);

  useEffect(() => {setFontSize(readForumFontSize());}, []);
  useEffect(() => {try {setDraft(sessionStorage.getItem(draftKey) || '');} catch { /* Optional draft recovery. */ }}, [draftKey]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const token = ++generation.current;
    restored.current = false; moreLock.current = false;
    checkpoint.current = null;
    try {
      const saved = JSON.parse(sessionStorage.getItem(positionKey) || 'null');
      if (saved && Number.isInteger(saved.page) && saved.page > 0 && Number.isFinite(saved.offset)) checkpoint.current = saved;
    } catch { /* Start at the selected answer if a checkpoint is unavailable. */ }
    async function load() {
      setLoading(true); setLoadingMore(false); setError(''); setMoreError(''); setCommentId(null); setDialog(null);
      try {
        const [post, first, selected] = await Promise.all([
          forumApi.getById(questionId), forumApi.getReplies(questionId),
          initialAnswerId ? forumApi.getReply(questionId, initialAnswerId) : Promise.resolve(null)
        ]);
        if (token !== generation.current) return;
        if (post.type !== 'question') {router.replace(`/forum/${post.id}`); return;}
        if (initialAnswerId && !selected) throw new Error('回答不存在或不属于这个问题');
        let rows = selected ? unique([selected, ...first]) : first;
        let lastPage = 1, more = first.length === 20;
        while (more && lastPage < (checkpoint.current?.page || 1)) {
          const next = await forumApi.getReplies(questionId, lastPage + 1);
          if (token !== generation.current) return;
          rows = unique([...rows, ...next]); lastPage++; more = next.length === 20;
        }
        setQuestion(post); setAnswers(rows); setPage(lastPage); setHasMore(more);
        setActiveId(rows[0]?.id || '');
        if (openComments && rows[0]) void afterForumNavigation().then(ready=>{if(ready&&token===generation.current)setCommentId(rows[0].id);});
      } catch (error) {if (token === generation.current) setError(error instanceof Error ? error.message : '回答加载失败，请重试');}
      finally {if (token === generation.current) setLoading(false);}
    }
    void load();
    return () => {generation.current = token + 1;};
  }, [questionId, initialAnswerId, openComments, positionKey, retry, router, user?.id]);

  const loadMore = useCallback(async () => {
    if (moreLock.current || !hasMore) return [];
    const token = generation.current;
    moreLock.current = true; setLoadingMore(true); setMoreError('');
    try {
      const next = await forumApi.getReplies(questionId, page + 1);
      if (token !== generation.current) return [];
      setAnswers(previous => unique([...previous, ...next])); setPage(value => value + 1); setHasMore(next.length === 20);
      return next;
    } catch (error) {if (token === generation.current) setMoreError(error instanceof Error ? error.message : '其他回答加载失败'); return [];}
    finally {if (token === generation.current) {moreLock.current = false; setLoadingMore(false);}}
  }, [questionId, page, hasMore]);
  useEffect(() => {
    if (loading || loadingMore || moreError || !hasMore || !sentinel.current) return;
    const observer = new IntersectionObserver(entries => {if (entries.some(entry => entry.isIntersecting)) void loadMore();}, {rootMargin:'700px 0px'});
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [loading, loadingMore, moreError, hasMore, loadMore]);

  useEffect(() => {
    if (loading || !answers.length) return;
    let frame = 0;
    if (!restored.current) {
      const saved = checkpoint.current;
      if (saved) {
        const target = cards.current.get(saved.answerId);
        if (target) window.scrollTo({top:window.scrollY + target.getBoundingClientRect().top + saved.offset, behavior:'instant'});
      }
      restored.current = true;
    }
    const update = () => {
      frame = 0;
      const line = Math.min(190, window.innerHeight * .25);
      let current = answers[0];
      for (const answer of answers) {
        const node = cards.current.get(answer.id);
        if (node && node.getBoundingClientRect().top <= line) current = answer;
      }
      setActiveId(current.id);
      const node = cards.current.get(current.id);
      if (node) {
        try {sessionStorage.setItem(positionKey, JSON.stringify({page, answerId:current.id, offset:-node.getBoundingClientRect().top}));} catch { /* Optional reading checkpoint. */ }
      }
    };
    const schedule = () => {if (!frame) frame = window.requestAnimationFrame(update);};
    update(); window.addEventListener('scroll', schedule, {passive:true}); window.addEventListener('resize', schedule);
    return () => {window.cancelAnimationFrame(frame); window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule);};
  }, [answers, loading, page, positionKey]);

  const active = answers.find(answer => answer.id === activeId) || answers[0];
  const commentAnswer = answers.find(answer => answer.id === commentId);
  const requireLogin = () => {
    if (user) return true;
    router.push('/login'); return false;
  };
  function jumpTo(id:string) {
    setDialog(null);
    window.requestAnimationFrame(() => {
      const node = cards.current.get(id);
      if (node) window.scrollTo({top:window.scrollY + node.getBoundingClientRect().top - 70, behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
    });
  }
  async function nextAnswer() {
    const index = answers.findIndex(answer => answer.id === active?.id);
    const next = answers[index + 1];
    if (next) jumpTo(next.id);
    else if (hasMore) {
      const rows = await loadMore();
      const newAnswer = rows.find(row => !answers.some(answer => answer.id === row.id));
      if (newAnswer) jumpTo(newAnswer.id);
    }
  }
  async function like(answer:ForumReply) {
    if (likeLocks.current.has(answer.id) || !requireLogin()) return;
    likeLocks.current.add(answer.id); setPendingLikes(new Set(likeLocks.current));
    try {
      const result = await forumApi.toggleReplyLike(answer.id, !answer.hasLiked);
      setAnswers(previous => previous.map(item => item.id === answer.id ? {...item, votes:result.votes, hasLiked:result.liked} : item));
      refreshForum();
    } catch (error) {setNotice(error instanceof Error ? error.message : '赞同失败，请重试');}
    finally {likeLocks.current.delete(answer.id); setPendingLikes(new Set(likeLocks.current));}
  }
  async function share(answer:ForumReply) {
    const url = `${window.location.origin}/forum/${answer.id}?fromQuestion=${questionId}`;
    try {
      if (navigator.share) await navigator.share({title:question?.title, url});
      else {await navigator.clipboard.writeText(url); setNotice('回答链接已复制');}
    } catch (error) {if (!(error instanceof Error && error.name === 'AbortError')) setShareUrl(url);}
  }
  function changeFont(size:number) {
    setFontSize(size);
    saveForumFontSize(size);
  }
  function changeDraft(value:string) {
    setDraft(value);
    try {sessionStorage.setItem(draftKey, value);} catch { /* The draft remains in memory. */ }
  }
  async function submit() {
    if (!draft.trim() || submitLock.current || !requireLogin()) return;
    submitLock.current = true; setSubmitting(true); setWriteError('');
    try {
      const created = await forumApi.addReply(questionId, {content:textToForumHtml(draft.trim())});
      const answer:ForumReply = {id:created.id, content:created.content, votes:created.likes || 0, comments:created.comments || 0, time:created.createdAt, hasLiked:false, author:{id:user!.id, name:user!.username, avatar:user!.avatar || '', bio:''}};
      setAnswers(previous => unique([...previous, answer]));
      setQuestion(previous => previous ? {...previous, comments:previous.comments + 1} : previous);
      changeDraft(''); setDialog(null); refreshForum(); jumpTo(created.id); setNotice('回答已发布');
    } catch (error) {setWriteError(error instanceof Error ? error.message : '回答发布失败，请重试');}
    finally {submitLock.current = false; setSubmitting(false);}
  }
  function writeAnswer() {if (requireLogin()) {setWriteError(''); setDialog('write');}}
  const canNext = active && (answers.findIndex(answer => answer.id === active.id) < answers.length - 1 || hasMore);

  if(loading)return <ForumLoadingShell/>;
  return <div className="forum-reading qa-reader" data-forum-document={initialAnswerId||questionId} tabIndex={-1} style={{'--qa-font-size':`${fontSize}px`} as CSSProperties}>
    <nav className="qa-topbar" aria-label="问答阅读导航"><div>
      <Link href="/forum" aria-label="返回问答首页" className="qa-icon-button"><ArrowLeft size={24}/></Link>
      <button className="qa-write-button" onClick={writeAnswer} disabled={!question}><PenLine size={18}/><span>写回答</span></button>
    </div></nav>
    {error || !question ? <div className="qa-loading" role="alert">{error || '问题不存在'}<button onClick={() => setRetry(value => value + 1)}>重新加载</button></div> : <div className="qa-layout">
      <section className="qa-main" aria-label="问题与回答">
        <header className="qa-question"><h1>{question.title}</h1><p className="qa-answer-count">{question.comments} 个回答</p></header>
        <div className="qa-answer-stream" aria-label="连续回答">
          {answers.map(answer => <article className="qa-answer" key={answer.id} data-answer-id={answer.id} ref={node => {if (node) cards.current.set(answer.id, node); else cards.current.delete(answer.id);}} aria-label={`${authorName(answer)}的回答`}>
            <header className="qa-author"><Avatar answer={answer}/><strong>{authorName(answer)}</strong></header>
            <div className="forum-prose qa-body" dangerouslySetInnerHTML={{__html:answer.content}}/>
            <div className="qa-answer-date">{answer.source ? '收录于' : '发布于'} {new Date(answer.time).toLocaleDateString('zh-CN')}</div>
            <ForumSourceCredit source={answer.source}/>
            <div className="qa-inline-actions">
              <button aria-pressed={!!answer.hasLiked} disabled={pendingLikes.has(answer.id)} onClick={() => void like(answer)}><ThumbsUp size={17}/>{answer.votes} 赞同</button>
              <button onClick={() => setCommentId(answer.id)}><MessageCircle size={17}/>{answer.comments} 条评论</button>
              <button onClick={() => void share(answer)}><ShareArrow size={17}/>分享</button>
            </div>
          </article>)}
        </div>
        <div ref={sentinel} className="qa-stream-end">
          {loadingMore ? <p role="status">正在加载更多回答…</p> : moreError ? <p role="alert">{moreError}<button onClick={() => void loadMore()}>重试</button></p> : hasMore ? <button onClick={() => void loadMore()}>继续阅读更多回答</button> : answers.length ? <><p>已读完这个问题的全部回答</p><button onClick={writeAnswer}>也来写下你的看法</button></> : <><p>还没有回答，来分享你的看法吧。</p><button onClick={writeAnswer}>写第一个回答</button></>}
        </div>
      </section>
      <aside className="qa-sidebar" aria-label="问题与回答导航">
        <h2>{question.comments} 个回答</h2><p>按赞同排序 · 向下连续阅读</p>
        <button className="qa-primary" onClick={writeAnswer}><PenLine size={17}/>写回答</button>
        <button className="qa-side-link" onClick={() => setDialog('answers')}><List size={18}/>浏览全部回答</button>
        <button className="qa-side-link" onClick={() => setDialog('settings')}><MoreHorizontal size={18}/>阅读设置</button>
        {question.bookId && <Link className="qa-side-link" href={`/book/${question.bookId}`}>查看相关书籍</Link>}
      </aside>
    </div>}
    {active && !loading && !error && <>
      <footer className="qa-actionbar" role="group" aria-label="当前回答操作" data-active-answer={active.id}><div>
        <button className="qa-current-author" onClick={() => setDialog('answers')} aria-label={`当前回答：${authorName(active)}，查看全部回答`}><Avatar answer={active}/><span>{authorName(active)}</span></button>
        <button className="qa-vote" aria-label={active.hasLiked ? '取消赞同当前回答' : '赞同当前回答'} aria-pressed={!!active.hasLiked} disabled={pendingLikes.has(active.id)} onClick={() => void like(active)}><ThumbsUp size={20}/><span>{active.votes}</span></button>
        <button aria-label="打开当前回答评论" onClick={() => setCommentId(active.id)}><MessageCircle size={21}/><span>{active.comments}</span></button>
        <button aria-label="分享当前回答" onClick={() => void share(active)}><ShareArrow size={20}/></button>
        <button className="qa-more-button" aria-label="阅读设置" onClick={() => setDialog('settings')}><MoreHorizontal size={20}/></button>
      </div></footer>
      {canNext && <button className="qa-next-answer" aria-label="跳到下一篇回答" disabled={loadingMore} onClick={() => void nextAnswer()}><ChevronsDown size={25}/></button>}
    </>}
    {notice && <div role="status" className="qa-toast">{notice}</div>}
    {shareUrl && <ForumReaderDialog title="分享回答" onClose={() => setShareUrl('')}><div className="qa-share-fallback"><p>长按或选中下面的链接复制：</p><input aria-label="当前回答链接" readOnly value={shareUrl} onFocus={event => event.target.select()}/></div></ForumReaderDialog>}
    {commentAnswer && <ForumReplyComments key={commentAnswer.id} answer={commentAnswer} onClose={() => setCommentId(null)} requireLogin={requireLogin} onComment={() => setAnswers(previous => previous.map(answer => answer.id === commentAnswer.id ? {...answer, comments:answer.comments + 1} : answer))}/>}
    {dialog === 'answers' && question && <ForumReaderDialog title={`全部 ${question.comments} 个回答`} onClose={() => setDialog(null)}>
      {dismiss => <div className="qa-dialog-scroll">
        <p className="qa-directory-question">{question.title}</p>
        {question.content && <details className="qa-question-details"><summary>问题补充</summary><div className="forum-prose" dangerouslySetInnerHTML={{__html:question.content}}/></details>}
        {question.bookId && <Link className="qa-related-book" href={`/book/${question.bookId}`}>查看相关书籍</Link>}
        <p className="qa-directory-order">赞同优先{initialAnswerId ? ' · 当前打开的回答置顶' : ''}</p>
        {answers.map(answer => <button className="qa-directory-item" key={answer.id} aria-current={answer.id === active?.id ? 'true' : undefined} onClick={() => dismiss(() => jumpTo(answer.id))}><strong>{authorName(answer)}</strong><span>{plainForumText(answer.content).slice(0, 95)}</span><small>{answer.votes} 赞同 · {answer.comments} 评论</small></button>)}
        {moreError && <p className="qa-error" role="alert">{moreError}</p>}
        {hasMore && <button className="qa-load-more" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? '加载中…' : '加载更多回答'}</button>}
        {!answers.length && <p className="qa-empty">还没有回答</p>}
      </div>}
    </ForumReaderDialog>}
    {dialog === 'settings' && <ForumReaderDialog title="阅读设置" onClose={() => setDialog(null)}><div className="qa-settings">
      <p>正文大小 <strong>{fontSize}px</strong></p><div>{[16,18,20,22,24].map(size => <button key={size} aria-pressed={fontSize === size} onClick={() => changeFont(size)}>{size}</button>)}</div>
      <p>阅读主题</p><div><button aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>浅色</button><button aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>深色</button></div>
    </div></ForumReaderDialog>}
    {dialog === 'write' && <ForumReaderDialog title="写回答" onClose={() => setDialog(null)}><form className="qa-write-form" onSubmit={event => {event.preventDefault(); void submit();}}>
      <p>{question?.title}</p><textarea aria-label="回答内容" placeholder="直接写下你的回答…" value={draft} onChange={event => changeDraft(event.target.value)} maxLength={12000} onKeyDown={event => {if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {event.preventDefault(); void submit();}}}/>
      {writeError && <p className="qa-error" role="alert">{writeError}</p>}<div><span>{draft.length} / 12000</span><button className="qa-primary" disabled={submitting || !draft.trim()}>{submitting ? '发布中…' : '发布回答'}</button></div>
    </form></ForumReaderDialog>}
  </div>;
}
