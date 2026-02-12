import mongoose from 'mongoose';

const forumReplyCommentSchema = new mongoose.Schema({
  postId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ForumPost',
    required: true
  },
  replyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ForumReply',
    required: true
  },
  parentCommentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ForumReplyComment',
    default: null
  },
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  content: { type: String, required: true },
  likes: { type: Number, default: 0 },
  likedBy: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  replyCount: { type: Number, default: 0 }
}, { timestamps: true });

forumReplyCommentSchema.index({ replyId: 1, createdAt: 1 });
forumReplyCommentSchema.index({ parentCommentId: 1, createdAt: 1 });

export default mongoose.model('ForumReplyComment', forumReplyCommentSchema);
