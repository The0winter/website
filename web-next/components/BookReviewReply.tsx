import UserAvatar from './UserAvatar';
import Link from './PrefetchLink';

export type Reply={_id:string;content:string;createdAt:string;user:{_id:string;username:string;avatar?:string;avatarColor?:string;isDeleted?:boolean}};
export default function BookReviewReply({reply}:{reply:Reply}) {
  const name=reply.user?.username||'已注销用户';
  const href=/^[a-f\d]{24}$/i.test(reply.user?._id)?`/user/${reply.user._id}`:null;
  return <article className="book-review-reply" data-reply-id={reply._id}>
    <div className="book-review-avatar-wrap"><UserAvatar user={reply.user||{username:name}} className="book-review-avatar"/></div>
    <div className="book-review-body">
      {href?<Link href={href} className="book-review-name">{name}</Link>:<span className="book-review-name">{name}</span>}
      <p className="book-review-content">{reply.content}</p>
      <footer className="book-review-footer"><time dateTime={reply.createdAt}>{reply.createdAt.slice(0,10)}</time></footer>
    </div>
  </article>;
}
