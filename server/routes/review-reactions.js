import mongoose from 'mongoose';
import Book from '../models/Book.js';
import Review from '../models/Review.js';
import {asyncRoute} from '../security.js';
import {fail} from '../services/content.js';

const validId = value => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
const summary = (row, userId) => ({
  id: String(row._id),
  likes: row.likedBy?.length || 0,
  dislikes: row.dislikedBy?.length || 0,
  reaction: userId && row.likedBy?.some(id => String(id) === userId) ? 'like'
    : userId && row.dislikedBy?.some(id => String(id) === userId) ? 'dislike' : null,
});

async function availableBook(id) {
  if (!validId(id)) fail(400, '书籍编号无效');
  if (!await Book.exists({_id:id, deletedAt:null}).maxTimeMS(3000)) fail(404, '作品不可用');
}

export function reviewReactionRoutes(app, auth) {
  app.get('/api/books/:id/review-reactions', asyncRoute(async(req, res) => {
    await availableBook(req.params.id);
    const ids = typeof req.query.ids === 'string' ? req.query.ids.split(',') : [];
    if (!ids.length || ids.length > 21 || ids.some(id => !validId(id))) fail(400, '评论编号无效');
    const userId = await auth.optionalUserId(req);
    const rows = await Review.find({book:req.params.id, _id:{$in:ids}})
      .select('_id likedBy dislikedBy').maxTimeMS(3000).lean();
    res.set('Cache-Control', 'private, no-store').json(rows.map(row => summary(row, userId)));
  }));

  app.put('/api/books/:id/reviews/:reviewId/reaction', auth.authenticate, asyncRoute(async(req, res) => {
    await availableBook(req.params.id);
    if (!validId(req.params.reviewId) || !req.body || Object.keys(req.body).some(key => key !== 'reaction')
      || !['like', 'dislike', null].includes(req.body.reaction)) fail(400, '评论反馈无效');
    const actor = new mongoose.Types.ObjectId(req.user.id);
    // Explicit desired state makes retries idempotent; one atomic update keeps choices exclusive.
    const update = Object.fromEntries([['likedBy','like'], ['dislikedBy','dislike']].map(([field, choice]) => [field,
      {[req.body.reaction === choice ? '$setUnion' : '$setDifference']: [{$ifNull:['$'+field, []]}, [actor]]},
    ]));
    const row = await Review.findOneAndUpdate({_id:req.params.reviewId, book:req.params.id},
      [{$set:update}], {new:true, timestamps:false}).select('_id likedBy dislikedBy').maxTimeMS(3000).lean();
    if (!row) fail(404, '评论不存在');
    res.set('Cache-Control', 'private, no-store').json(summary(row, req.user.id));
  }));
}
