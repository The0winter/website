'use client';
import {useCallback, useEffect, useRef, useState} from 'react';
import {MessageCircle, ThumbsUp} from 'lucide-react';
import {forumApi, type ForumComment, type ForumReply} from '@/lib/api';
import {textToForumHtml} from '@/lib/forum-presentation';
import {refreshForum} from '@/lib/forum-cache';
import {useAuth} from '@/contexts/AuthContext';
import ForumReaderDialog from './ForumReaderDialog';

export default function ForumReplyComments({answer, onClose, requireLogin, onComment}: {
  answer:ForumReply; onClose:()=>void; requireLogin:()=>boolean; onComment:()=>void;
}) {
  const {user} = useAuth();
  const [rows, setRows] = useState<ForumComment[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<ForumComment|null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pendingLikes, setPendingLikes] = useState<Set<string>>(new Set());
  const request = useRef(0), submitLock = useRef(false), likeLocks = useRef(new Set<string>());
  const load = useCallback(async (nextPage:number) => {
    const token = ++request.current;
    setLoading(true); setError('');
    try {
      const data = await forumApi.getReplyComments(answer.id, nextPage);
      if (token !== request.current) return;
      setRows(previous => nextPage === 1 ? data : [...previous, ...data.filter(row => !previous.some(item => item.id === row.id))]);
      setPage(nextPage); setHasMore(data.length === 100);
    } catch (error) {if (token === request.current) setError(error instanceof Error ? error.message : '评论加载失败');}
    finally {if (token === request.current) setLoading(false);}
  }, [answer.id]);
  useEffect(() => {
    const requests = request;
    void load(1);
    return () => {requests.current++;};
  }, [load]);

  async function submit() {
    if (!text.trim() || submitLock.current || !requireLogin()) return;
    submitLock.current = true; setSubmitting(true); setError('');
    try {
      const created = await forumApi.createReplyComment(answer.id, {content:textToForumHtml(text.trim()), parentCommentId:replyTo ? replyTo.parentCommentId || replyTo.id : null});
      const row:ForumComment = {id:created.id, content:created.content, postId:'', replyId:answer.id, parentCommentId:created.parentCommentId || null, votes:created.likes || 0, hasLiked:false, replyCount:created.replyCount || 0, time:created.createdAt, author:{id:user!.id, name:user!.username, avatar:user!.avatar || ''}};
      setRows(previous => [...previous.filter(item => item.id !== row.id), row]);
      setText(''); setReplyTo(null); onComment(); refreshForum();
    } catch (error) {setError(error instanceof Error ? error.message : '评论发送失败，请重试');}
    finally {submitLock.current = false; setSubmitting(false);}
  }
  async function like(row:ForumComment) {
    if (likeLocks.current.has(row.id) || !requireLogin()) return;
    likeLocks.current.add(row.id); setPendingLikes(new Set(likeLocks.current));
    try {
      const result = await forumApi.toggleCommentLike(row.id, !row.hasLiked);
      setRows(previous => previous.map(item => item.id === row.id ? {...item, hasLiked:result.liked, votes:result.votes} : item));
    } catch (error) {setError(error instanceof Error ? error.message : '赞同失败，请重试');}
    finally {likeLocks.current.delete(row.id); setPendingLikes(new Set(likeLocks.current));}
  }
  const known = new Set(rows.map(row => row.id));
  const roots = rows.filter(row => !row.parentCommentId || !known.has(row.parentCommentId));
  function comment(row:ForumComment) {
    return <div className="qa-comment" key={row.id} data-comment-id={row.id}>
      <div className="qa-comment-byline"><strong>{row.author.name}</strong><time>{new Date(row.time).toLocaleDateString('zh-CN')}</time></div>
      <div className="qa-comment-body" dangerouslySetInnerHTML={{__html:row.content}}/>
      <div className="qa-comment-actions">
        <button aria-label={row.hasLiked ? '取消赞同评论' : '赞同评论'} aria-pressed={!!row.hasLiked} disabled={pendingLikes.has(row.id)} onClick={() => void like(row)}><ThumbsUp size={15}/>{row.votes}</button>
        <button onClick={() => setReplyTo(row)}><MessageCircle size={15}/>回复</button>
      </div>
    </div>;
  }
  return <ForumReaderDialog title="回答评论" onClose={onClose}>
    <div className="qa-dialog-subtitle">{answer.source?.author || answer.author.name} · {answer.comments} 条评论</div>
    <div className="qa-dialog-scroll">
      {!loading && !error && !rows.length && <p className="qa-empty">还没有评论，聊聊你的看法吧。</p>}
      {roots.map(root => <section key={root.id}>{comment(root)}<div className="qa-comment-children">{rows.filter(row => row.parentCommentId === root.id).map(comment)}</div></section>)}
      {loading && <p role="status" className="qa-empty">正在加载评论…</p>}
      {error && <p role="alert" className="qa-error">{error} <button onClick={() => void load(page || 1)}>重试</button></p>}
      {hasMore && <button className="qa-load-more" disabled={loading} onClick={() => void load(page + 1)}>加载更多评论</button>}
    </div>
    <form className="qa-comment-form" onSubmit={event => {event.preventDefault(); void submit();}}>
      {replyTo && <div className="qa-reply-to">回复 {replyTo.author.name}<button type="button" onClick={() => setReplyTo(null)}>取消回复</button></div>}
      <textarea aria-label="评论内容" placeholder={replyTo ? `回复 ${replyTo.author.name}…` : '写下你的评论…'} value={text} onChange={event => setText(event.target.value)} maxLength={2000}/>
      <button className="qa-primary" disabled={submitting || !text.trim()}>{submitting ? '发送中…' : '发布评论'}</button>
    </form>
  </ForumReaderDialog>;
}
