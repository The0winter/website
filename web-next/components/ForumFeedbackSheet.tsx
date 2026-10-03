'use client';
import {Copy, Frown, HeartCrack, Siren, UserRoundMinus,BookMinus,Tags,UserRoundPlus,BookPlus} from 'lucide-react';
import type {ForumPost} from '@/lib/api';
import {feedbackReasons, forumAuthor, type FeedbackReason} from '@/lib/forum-feedback';
import ForumReaderDialog from './ForumReaderDialog';

const icons = {dislike:HeartCrack, author:UserRoundMinus, similar:Copy, extreme:Siren, quality:Frown,book:BookMinus,topic:Tags,followAuthor:UserRoundPlus,followBook:BookPlus};
export default function ForumFeedbackSheet({post,onClose,onSelect}: {post:ForumPost;onClose:()=>void;onSelect:(reason:FeedbackReason)=>void}) {
  return <ForumReaderDialog title="调整推荐" onClose={onClose} className="forum-feedback-dialog">
    {dismiss => <div className="forum-feedback-options">{(Object.keys(feedbackReasons) as FeedbackReason[]).map(reason => {
      const Icon = icons[reason];
      if((reason==='book'||reason==='followBook')&&!post.bookId || reason==='topic'&&!post.recommendation?.topic)return null;
      return <button key={reason} onClick={() => dismiss(() => onSelect(reason))}><Icon size={24} strokeWidth={1.7}/><span>{feedbackReasons[reason]}{reason === 'author' && `：${forumAuthor(post).name}`}</span></button>;
    })}</div>}
  </ForumReaderDialog>;
}
