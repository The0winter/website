import Post from '../models/ForumPost.js';
import Reply from '../models/ForumReply.js';
import Book from '../models/Book.js';
import {safeHtml} from '../security.js';
import mongoose from 'mongoose';
import {forumAuthor, publicForumBook} from './forum-read.js';

export const forumExcerpt = value => safeHtml(value || '')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim().slice(0, 200);

export function forumFeedItem(post, reply, compact = false) {
  const excerpt = reply ? forumExcerpt(reply.content) : '';
  return {
    id: String(post._id), entryId: String(reply?._id || post._id),
    title: post.title, excerpt: post.summary || forumExcerpt(post.content),
    author: post.author?.username || '书友', authorId: String(post.author?._id || ''),
    type: post.type, tags: post.tags || [], bookId: post.bookId ? String(post.bookId) : undefined,
    votes: post.likes || 0, comments: post.replyCount || 0, views: post.views || 0,
    created_at: post.createdAt, isHot: (post.views || 0) > 1000,
    topReply: reply ? {
      id: String(reply._id), title: reply.title, excerpt,
      content: compact ? '' : excerpt.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
      source: reply.source, votes: reply.likes || 0, comments: reply.comments || 0,
      author: {id: String(reply.author?._id || ''), name: reply.source?.author || reply.author?.username || '书友', avatar: reply.source ? '' : reply.author?.avatar || ''}
    } : null
  };
}

// Merge two ordered streams before paginating: answers, and standalone articles /
// unanswered questions. Article comments never become independent feed entries.
// Each scan is bounded to a page-sized chunk; full article bodies are not sent to lists.
export async function forumFeed({tab = 'recommend', page = 1, limit = 20, bookId, cursor, paged = false} = {}) {
  const count = (paged ? limit : page * limit) + (paged ? 1 : 0);
  const boundary = cursor ? decodeCursor(cursor, tab, bookId) : null;
  const sort = tab === 'hot' ? {likes: -1, createdAt: -1, _id: -1} : {createdAt: -1, _id: -1};
  const postFilter = {$or: [{type: 'article'}, {type: 'question', replyCount: 0}], ...(bookId ? {bookId} : {})};
  const native = !mongoose.connection.transport;
  const questionIds = bookId && !native ? (await Post.find({bookId, type: 'question'}).select('_id').lean()).map(row => row._id) : null;
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
    if (boundary) filter = {$and: [filter, seek(boundary, tab)]};
    if (native) {
      // Aggregations do not cast ObjectIds as find() does.
      if (!answer && bookId) filter = {$and: [{...postFilter, bookId: new mongoose.Types.ObjectId(bookId)}, boundary ? seek(boundary, tab) : {}]};
      const parents = answer ? [{$lookup: {from: Post.collection.name, localField: 'postId', foreignField: '_id', pipeline: [
        {$match: {type: 'question', ...(bookId ? {bookId: new mongoose.Types.ObjectId(bookId)} : {})}},
        {$project: {title: 1, summary: 1, type: 1, bookId: 1, tags: 1, author: 1, likes: 1, replyCount: 1, views: 1, createdAt: 1}},
      ], as: 'postId'}}, {$unwind: '$postId'}] : [];
      const rows = await Model.aggregate([{$match: filter}, {$sort: sort}, ...parents,
        ...publicForumBook(answer ? 'postId.bookId' : 'bookId'), {$limit: count},
        {$project: {content: 1, title: 1, source: 1, summary: 1, type: 1, bookId: 1, tags: 1, author: 1,
          likes: 1, replyCount: 1, comments: 1, views: 1, createdAt: 1, postId: 1}},
        ...forumAuthor(), ...(answer ? forumAuthor('postId.author', 'postId.author') : []),
      ]).option({maxTimeMS: 5000});
      return entries(rows, answer);
    }
    const selected = [];
    const chunk = Math.min(100, count);
    for (let offset = 0; selected.length < count; offset += chunk) {
      let query = Model.find(filter).sort(sort).skip(offset).limit(chunk).populate('author', 'username avatar');
      if (answer) query = query.populate({path: 'postId', select: 'title summary type bookId tags author likes replyCount views createdAt', populate: {path: 'author', select: 'username'}});
      const rows = await query.maxTimeMS(5000).lean();
      const candidates = answer ? rows.filter(row => row.postId?.type === 'question') : rows;
      selected.push(...await visible(candidates, row => answer ? row.postId : row));
      if (rows.length < chunk) break;
    }
    return entries(selected.slice(0, count), answer);
  }
  function entries(rows, answer) {
    return rows.map(row => ({
      key: String(row._id), likes: row.likes || 0, date: new Date(row.createdAt).getTime() || 0,
      item: forumFeedItem(answer ? row.postId : row, answer ? row : null, paged)
    }));
  }
  const [answers, posts] = await Promise.all([scan(Reply, replyFilter, true), scan(Post, postFilter, false)]);
  const merged = [...answers, ...posts].sort((a, b) => (tab === 'hot' ? b.likes - a.likes : 0) || b.date - a.date || b.key.localeCompare(a.key));
  const selected = paged ? merged.slice(0, limit) : merged.slice((page - 1) * limit, count);
  const items = selected.map(row => row.item);
  if (paged) return {items, nextCursor: merged.length > limit ? encodeCursor(selected.at(-1), tab, bookId) : null};
  if (!bookId) return {items};
  const ids = questionIds || (await Post.find({bookId, type: 'question'}).select('_id').lean()).map(row => row._id);
  const [answerCount, postCount] = await Promise.all([Reply.countDocuments({postId: {$in: ids}}), Post.countDocuments(postFilter)]);
  return {items, total: answerCount + postCount, pageSize: limit};
}

function encodeCursor(row, tab, bookId) {
  return Buffer.from(JSON.stringify({v: 1, tab, book: bookId || '', id: row.key, date: row.date, likes: row.likes})).toString('base64url');
}
function decodeCursor(value, tab, bookId) {
  try {
    if (typeof value !== 'string' || value.length > 600 || !/^[\w-]+$/.test(value)) throw Error();
    const row = JSON.parse(Buffer.from(value, 'base64url').toString());
    if (row.v !== 1 || row.tab !== tab || row.book !== (bookId || '') || !/^[a-f0-9]{24}$/.test(row.id) ||
      !Number.isSafeInteger(row.date) || !Number.isFinite(new Date(row.date).getTime()) || !Number.isSafeInteger(row.likes) || row.likes < 0) throw Error();
    return row;
  } catch {throw Object.assign(new Error('分页游标无效，请刷新列表'), {status: 400});}
}
function seek(row, tab) {
  const date = new Date(row.date), id = new mongoose.Types.ObjectId(row.id);
  const chronological = [ {createdAt: {$lt: date}}, {createdAt: date, _id: {$lt: id}} ];
  return {$or: tab === 'hot' ? [{likes: {$lt: row.likes}}, ...chronological.map(filter => ({likes: row.likes, ...filter}))] : chronological};
}
