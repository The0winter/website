'use client';
import {Copy, Frown, HeartCrack, Siren, UserRoundMinus} from 'lucide-react';
import type {ForumPost} from '@/lib/api';
import {feedbackReasons, forumAuthor, type FeedbackReason} from '@/lib/forum-feedback';
import ForumReaderDialog from './ForumReaderDialog';

const icons = {dislike:HeartCrack, author:UserRoundMinus, similar:Copy, extreme:Siren, quality:Frown};
export default function ForumFeedbackSheet({post,onClose,onSelect}: {post:ForumPost;onClose:()=>void;onSelect:(reason:FeedbackReason)=>void}) {
  return <ForumReaderDialog title="调整推荐" onClose={onClose} className="forum-feedback-dialog">
    {dismiss => <div className="forum-feedback-options">{(Object.keys(feedbackReasons) as FeedbackReason[]).map(reason => {
      const Icon = icons[reason];
      return <button key={reason} onClick={() => dismiss(() => onSelect(reason))}><Icon size={24} strokeWidth={1.7}/><span>{feedbackReasons[reason]}{reason === 'author' && `：${forumAuthor(post).name}`}</span></button>;
    })}</div>}
  </ForumReaderDialog>;
}
