import Post from '../models/ForumPost.js';
import Reply from '../models/ForumReply.js';
import Book from '../models/Book.js';
import {safeHtml} from '../security.js';

export const forumExcerpt = value => safeHtml(value || '')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim().slice(0, 200);

export function forumFeedItem(post, reply) {
  return {
    id: String(post._id), entryId: String(reply?._id || post._id),
    title: post.title, excerpt: post.summary || forumExcerpt(post.content),
    author: post.author?.username || '书友', authorId: String(post.author?._id || ''),
    type: post.type, tags: post.tags || [], bookId: post.bookId ? String(post.bookId) : undefined,
    votes: post.likes || 0, comments: post.replyCount || 0, views: post.views || 0,
    created_at: post.createdAt, isHot: (post.views || 0) > 1000,
    topReply: reply ? {
      id: String(reply._id), title: reply.title, excerpt: forumExcerpt(reply.content),
      content: forumExcerpt(reply.content).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
      source: reply.source, votes: reply.likes || 0, comments: reply.comments || 0,
      author: {id: String(reply.author?._id || ''), name: reply.source?.author || reply.author?.username || '书友', avatar: reply.source ? '' : reply.author?.avatar || ''}
    } : null
  };
}

// Merge two ordered streams before paginating: answers, and standalone articles /
// unanswered questions. Article comments never become independent feed entries.
// Each scan is bounded to a page-sized chunk; full article bodies are not sent to lists.
export async function forumFeed({tab = 'recommend', page = 1, limit = 20, bookId} = {}) {
  const count = page * limit;
  const sort = tab === 'hot' ? {likes: -1, createdAt: -1, _id: -1} : {createdAt: -1, _id: -1};
  const postFilter = {$or: [{type: 'article'}, {type: 'question', replyCount: 0}], ...(bookId ? {bookId} : {})};
  const questionIds = bookId ? (await Post.find({bookId, type: 'question'}).select('_id').lean()).map(row => row._id) : null;
  const replyFilter = questionIds ? {postId: {$in: questionIds}} : {};
  const bookCache = new Map();
  async function visible(rows, parent) {
    const ids = [...new Set(rows.map(row => parent(row)?.bookId?.toString()).filter(id => id && !bookCache.has(id)))];
    if (ids.length) {
      const books = await Book.find({_id: {$in: ids}, deletedAt: null, visibility: {$ne: 'private'}}).select('_id').lean();
      const found = new Set(books.map(book => String(book._id)));
      ids.forEach(id => bookCache.set(id, found.has(id)));
    }
    return rows.filter(row => {
      const post = parent(row);
      return post && (!post.bookId || bookCache.get(String(post.bookId)));
    });
  }
  async function scan(Model, filter, answer) {
    const selected = [];
    const chunk = Math.min(100, Math.max(20, limit));
    for (let offset = 0; selected.length < count; offset += chunk) {
      let query = Model.find(filter).sort(sort).skip(offset).limit(chunk).populate('author', 'username avatar');
      if (answer) query = query.populate({path: 'postId', select: 'title summary type bookId tags author likes replyCount views createdAt', populate: {path: 'author', select: 'username'}});
      const rows = await query.maxTimeMS(5000).lean();
      const candidates = answer ? rows.filter(row => row.postId?.type === 'question') : rows;
      selected.push(...await visible(candidates, row => answer ? row.postId : row));
      if (rows.length < chunk) break;
    }
    return selected.slice(0, count).map(row => ({
      key: String(row._id), likes: row.likes || 0, date: new Date(row.createdAt).getTime() || 0,
      item: forumFeedItem(answer ? row.postId : row, answer ? row : null)
    }));
  }
  const [answers, posts] = await Promise.all([scan(Reply, replyFilter, true), scan(Post, postFilter, false)]);
  const merged = [...answers, ...posts].sort((a, b) => (tab === 'hot' ? b.likes - a.likes : 0) || b.date - a.date || b.key.localeCompare(a.key));
  const items = merged.slice((page - 1) * limit, count).map(row => row.item);
  if (!bookId) return {items};
  const [answerCount, postCount] = await Promise.all([Reply.countDocuments(replyFilter), Post.countDocuments(postFilter)]);
  return {items, total: answerCount + postCount, pageSize: limit};
}
