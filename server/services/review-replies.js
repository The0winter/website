import ReviewReply from '../models/ReviewReply.js';

export function replyJson(row) {
  return {_id: String(row._id), content: row.content, createdAt: row.createdAt,
    user: row.user ? {_id: String(row.user._id), username: row.user.username, avatar: row.user.avatar || '', avatarColor: row.user.avatarColor} : {_id:'', username:'已注销用户', isDeleted:true}};
}

// One bounded query for each visible batch; never load an entire thread for previews.
export async function withReplyPreviews(reviews) {
  if (!reviews.length) return reviews;
  const groups = await ReviewReply.aggregate([
    {$match: {review: {$in: reviews.map(row => row._id)}}},
    {$sort: {review: 1, createdAt: -1, _id: -1}},
    {$group: {_id: '$review', count: {$sum: 1}, preview: {$first: '$$ROOT'}}},
  ]).option({maxTimeMS: 3000});
  // Aggregation wrappers are not ReviewReply documents. Populate the actual
  // reply objects so Mongoose can resolve the schema's `user` reference.
  await ReviewReply.populate(groups.map(row=>row.preview), {path:'user', select:'username avatar avatarColor'});
  const byReview = new Map(groups.map(row => [String(row._id), row]));
  return reviews.map(row => {
    const replies = byReview.get(String(row._id));
    return {...row, replyCount: replies?.count || 0, replyPreview: replies ? replyJson(replies.preview) : null};
  });
}
