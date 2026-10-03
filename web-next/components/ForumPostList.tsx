'use client';
import Link from './ForumLink';
import {memo} from 'react';
import {ArrowUpRight, MessageCircle, ThumbsUp, Triangle, X} from 'lucide-react';
import UserAvatar from './UserAvatar';
import type {ForumPost} from '@/lib/api';
import {forumEntryHref, plainForumText} from '@/lib/forum-presentation';
import './forum-content.css';

function ForumPostList({posts = [], loading, hideQuestion = false, onFeedback, emptyText}: {posts?: ForumPost[]; loading: boolean; hideQuestion?: boolean; onFeedback?:(post:ForumPost)=>void; emptyText?:string}) {
  return <div className="forum-entry-list" aria-busy={loading}>
    {loading ? <p className="forum-list-state" role="status">正在加载讨论…</p> : !posts.length ? <p className="forum-list-state">{emptyText || '还没有讨论，来分享你的阅读感受吧。'}</p> : posts.map(post => {
      const reply = post.topReply;
      const href = forumEntryHref(post);
      const author = reply?.source?.kind === 'guide' ? '拾页整理' : reply?.source?.author || reply?.author?.name || (typeof post.author === 'string' ? post.author : post.author.name) || '书友';
      const account = reply?.author || (typeof post.author === 'string' ? undefined : post.author);
      // A credited source author may differ from the account that imported the answer.
      const avatar = account?.name === author ? account.avatar : undefined;
      const excerpt = reply?.excerpt || plainForumText(reply?.content || '') || post.excerpt || '这个问题还没有回答，来聊聊你的看法。';
      return <article key={post.entryId || reply?.id || post.id} className="forum-entry" data-entry-id={post.entryId || reply?.id || post.id}>
        {(!hideQuestion || !reply) && <Link href={href} className="forum-entry-title"><h2>{post.title}</h2></Link>}
        <div className="forum-entry-author">
          <UserAvatar className="forum-entry-avatar" user={{id:account?.name === author ? account.id : undefined,username:author,avatar}}/>
          <span>{author}</span>
        </div>
        <Link href={href} className="forum-entry-excerpt"><p>{excerpt}</p></Link>
        <div className="forum-entry-meta">
          <span aria-label={`${reply?.votes ?? post.votes ?? 0} 人赞同`}><ThumbsUp className="forum-vote-desktop" size={14} aria-hidden="true"/><Triangle className="forum-vote-mobile" size={18} aria-hidden="true"/><span>{reply?.votes ?? post.votes ?? 0}<span className="forum-meta-label"> 赞同</span></span></span>
          <Link aria-label={`${reply?.comments ?? post.comments ?? 0} 条评论`} href={href + (href.includes('?') ? '&' : '?') + 'comments=1'}><MessageCircle size={14} aria-hidden="true"/><span>{reply?.comments ?? post.comments ?? 0}<span className="forum-meta-label"> 评论</span></span></Link>
          {onFeedback ? <button type="button" className="forum-feedback-toggle" aria-label={`不感兴趣：${post.title}`} onClick={() => onFeedback(post)}><X size={18}/></button> : <Link href={href} className="forum-read-link">{reply ? '阅读全文' : post.type === 'article' ? '阅读文章' : '查看问题'}<ArrowUpRight size={14}/></Link>}
        </div>
      </article>;
    })}
  </div>;
}
export default memo(ForumPostList);
