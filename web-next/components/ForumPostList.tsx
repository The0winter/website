'use client';
import Link from './ForumLink';
import {memo} from 'react';
import {ArrowUpRight, MessageCircle, ThumbsUp, X} from 'lucide-react';
import type {ForumPost} from '@/lib/api';
import {forumEntryHref, plainForumText} from '@/lib/forum-presentation';
import './forum-content.css';

function ForumPostList({posts = [], loading, hideQuestion = false, onFeedback, emptyText}: {posts?: ForumPost[]; loading: boolean; hideQuestion?: boolean; onFeedback?:(post:ForumPost)=>void; emptyText?:string}) {
  return <div className="forum-entry-list" aria-busy={loading}>
    {loading ? <p className="forum-list-state" role="status">正在加载讨论…</p> : !posts.length ? <p className="forum-list-state">{emptyText || '还没有讨论，来分享你的阅读感受吧。'}</p> : posts.map(post => {
      const reply = post.topReply;
      const href = forumEntryHref(post);
      const author = reply?.source?.author || reply?.author?.name || (typeof post.author === 'string' ? post.author : post.author.name) || '书友';
      const excerpt = reply?.excerpt || plainForumText(reply?.content || '') || post.excerpt || '这个问题还没有回答，来聊聊你的看法。';
      return <article key={post.entryId || reply?.id || post.id} className="forum-entry" data-entry-id={post.entryId || reply?.id || post.id}>
        {(!hideQuestion || !reply) && <Link href={href} className="forum-entry-title"><h2>{post.title}</h2></Link>}
        <div className="forum-entry-author">
          <span className="forum-letter-avatar" aria-hidden="true">{author.slice(0,1)}</span>
          <span>{author}</span>
        </div>
        <Link href={href} className="forum-entry-excerpt"><p>{excerpt}</p></Link>
        <div className="forum-entry-meta">
          <span><ThumbsUp size={14}/>{reply?.votes ?? post.votes ?? 0} 赞同</span>
          <Link href={href + (href.includes('?') ? '&' : '?') + 'comments=1'}><MessageCircle size={14}/>{reply?.comments ?? post.comments ?? 0} 评论</Link>
          {onFeedback ? <button type="button" className="forum-feedback-toggle" aria-label={`不感兴趣：${post.title}`} onClick={() => onFeedback(post)}><X size={18}/></button> : <Link href={href} className="forum-read-link">{reply ? '阅读全文' : post.type === 'article' ? '阅读文章' : '查看问题'}<ArrowUpRight size={14}/></Link>}
        </div>
      </article>;
    })}
  </div>;
}
export default memo(ForumPostList);
