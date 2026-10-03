import mongoose from 'mongoose';
import Post from '../models/ForumPost.js';
import Reply from '../models/ForumReply.js';
import Book from '../models/Book.js';
import User from '../models/User.js';
import {visibleForumReplies, forumSourceName, forumDisplayContent} from './forum-curation.js';

export const forumAuthor = (field = 'author', output = field) => [
  {$lookup: {from: User.collection.name, localField: field, foreignField: '_id', pipeline: [{$project: {username: 1, avatar: 1}}], as: output}},
  {$unwind: {path: '$' + output, preserveNullAndEmptyArrays: true}},
];

// Filter before limiting: a hidden/deleted book must neither leak nor leave a
// short page when more public entries exist further down the stream.
export const publicForumBook = (field = 'bookId') => [
  {$lookup: {from: Book.collection.name, localField: field, foreignField: '_id', pipeline: [
    {$match: {deletedAt: null, visibility: {$ne: 'private'}}}, {$project: {title: 1}},
  ], as: 'publicBook'}},
  {$match: {$or: [{[field]: null}, {'publicBook.0': {$exists: true}}]}},
];

export function forumPostResponse(post, userId) {
  const {likedBy, selected, publicBook, ...data} = post;
  return {...data, id: String(post._id), bookTitle: post.bookTitle || publicBook?.[0]?.title,
    votes: post.likes || 0, comments: post.replyCount || 0, created_at: post.createdAt,
    hasLiked: !!userId && (likedBy || []).some(id => String(id) === userId),
    author: {name: post.author?.username || '书友', id: String(post.author?._id || '')},
  };
}

export function forumReplyResponse(reply, userId) {
  return {id: String(reply._id), title: reply.title, source: reply.source, content: forumDisplayContent(reply),
    votes: reply.likes || 0, comments: reply.comments || 0, time: new Date(reply.createdAt).toISOString(),
    hasLiked: !!userId && (reply.likedBy || []).some(id => String(id) === userId),
    author: {name: forumSourceName(reply),
      id: String(reply.author?._id || ''), avatar: reply.source ? '' : reply.author?.avatar || '', bio: '暂无介绍'},
  };
}

export async function readForumPost(id, userId, {reading = false, answerId} = {}) {
  let post, answer;
  if (!mongoose.connection.transport) {
    const selected = reading ? [{$lookup: {from: Reply.collection.name, let: {post: '$_id', type: '$type'}, pipeline: [
      {$match: {...(answerId ? {_id: new mongoose.Types.ObjectId(answerId)} : visibleForumReplies),
        $expr: {$and: [{$eq: ['$postId', '$$post']}, {$eq: ['$$type', 'question']}]}}},
      {$sort: {likes: -1, createdAt: -1, _id: 1}}, {$limit: 1}, ...forumAuthor(),
    ], as: 'selected'}}] : [];
    [post] = await Post.aggregate([{$match: {_id: new mongoose.Types.ObjectId(id)}},
      ...publicForumBook(), ...forumAuthor(), ...selected]).option({maxTimeMS: 5000});
    answer = post?.selected?.[0];
  } else {
    // The SQL compatibility driver resolves aggregation joins in memory. Keep
    // its reads bounded instead of loading entire collections for a lookup.
    post = await Post.findById(id).populate('author', 'username').lean();
    if (post?.bookId) {
      const book = await Book.findOne({_id: post.bookId, deletedAt: null, visibility: {$ne: 'private'}}).select('title').lean();
      if (!book) return null;
      post.bookTitle = book.title;
    }
    if (reading && post?.type === 'question') answer = await Reply.findOne({postId: id, ...(answerId ? {_id: answerId} : visibleForumReplies)})
      .sort({likes: -1, createdAt: -1, _id: 1}).populate('author', 'username avatar').lean();
  }
  if (!post || (answerId && (post.type !== 'question' || !answer))) return null;
  return {post: forumPostResponse(post, userId), answer: answer ? forumReplyResponse(answer, userId) : null};
}
