export default function BookReviewSkeleton({count=5}:{count?:number}) {
  return <div className="book-review-skeleton" role="status" aria-label="正在加载评论">
    <span className="sr-only">正在加载评论</span>
    {Array.from({length:count},(_,index)=><div key={index} className="book-review-skeleton-row" aria-hidden="true">
      <i className="book-review-skeleton-avatar"/>
      <div><i className="book-review-skeleton-name"/><i className="book-review-skeleton-line"/><i className="book-review-skeleton-line short"/><i className="book-review-skeleton-date"/></div>
    </div>)}
  </div>;
}
