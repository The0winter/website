'use client';

import {Heart,HeartCrack,Star} from 'lucide-react';
import {useRouter} from 'next/navigation';
import Link from './PrefetchLink';
import UserAvatar from './UserAvatar';
import {ratingLabel} from '@/lib/rating';
import {formatCompactCount} from '@/lib/compact-count';
import {useReviewReactions} from '@/lib/useReviewReactions';

export type Review={_id:string;isTestData?:boolean;rating:number;content:string;createdAt:string;user:{_id:string;id?:string;username:string;avatar?:string}};

export default function BookReviewList({bookId,reviews,userId,compact=false}:{bookId:string;reviews:Review[];userId:string;compact?:boolean}) {
  const router=useRouter();
  const feedback=useReviewReactions(bookId,reviews.map(row=>row._id).join(','),userId);
  return <>
    {feedback.error && <p className="book-review-error" role="alert">{feedback.error} <button onClick={feedback.retry}>重试</button></p>}
    <div className={`book-review-list${compact?' book-review-preview':''}`}>
      {reviews.map(review=>{
        const reviewerId=review.user?._id||review.user?.id||'';
        const name=review.user?.username||'书友';
        const href=/^[a-f\d]{24}$/i.test(reviewerId)?`/user/${reviewerId}`:null;
        const mine=Boolean(userId)&&reviewerId===userId;
        const row=feedback.rows[review._id];
        return <article key={review._id} className="book-review" data-review-id={review._id}>
          <div className="book-review-row">
            <div className="book-review-avatar-wrap">{href?<Link href={href} className="book-review-profile-link" aria-label={`查看${name}的主页`}><UserAvatar user={review.user} className="book-review-avatar"/></Link>:<UserAvatar user={review.user||{username:name}} className="book-review-avatar"/>}</div>
            <div className="book-review-body flex-1">
              <div className="book-review-heading">
                {href?<Link href={href} className="book-review-name" title={name}>{name}{mine?' (我)':''}</Link>:<span className="book-review-name" title={name}>{name}{mine?' (我)':''}</span>}
                <div className="book-review-meta"><div className="flex shrink-0 book-review-stars" role="img" aria-label={ratingLabel(review.rating)}>{[1,2,3,4,5].map(star=><Star key={star} aria-hidden="true" className={star<=review.rating?'fill-yellow-400 text-yellow-400':'text-gray-300'}/>)}</div></div>
              </div>
              <p className="book-review-content">{review.isTestData?review.content.replace(/^【测试】/,''):review.content}</p>
              <footer className="book-review-footer">
                {review.isTestData&&<span className="book-review-test-badge">测试数据</span>}
                <time dateTime={review.createdAt} title={review.createdAt.slice(0,10)}>{review.createdAt.slice(0,4)===String(new Date().getFullYear())?review.createdAt.slice(5,10):review.createdAt.slice(0,10)}</time>
                <div className="book-review-reactions" role="group" aria-label="评论反馈">
                  {(['like','dislike'] as const).map(choice=>{
                    const label=choice==='like'?'喜欢':'不喜欢',count=(choice==='like'?row?.likes:row?.dislikes)||0,active=row?.reaction===choice,Icon=choice==='like'?Heart:HeartCrack;
                    return <button key={choice} type="button" aria-label={`${label}，${count} 人`} title={active?`取消${label}`:label} aria-pressed={active} disabled={feedback.busy(review._id)||(Boolean(userId)&&!row)}
                      onClick={()=>{if(!userId)router.push('/login');else void feedback.react(review._id,active?null:choice);}}><Icon size={18} aria-hidden="true"/>{count>0&&<span aria-hidden="true">{formatCompactCount(count)}</span>}</button>;
                  })}
                </div>
              </footer>
            </div>
          </div>
        </article>;
      })}
    </div>
  </>;
}
