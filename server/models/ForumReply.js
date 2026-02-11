import mongoose from 'mongoose';

const forumReplySchema = new mongoose.Schema({
  postId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'ForumPost', // 属于哪个帖子
    required: true 
  },
  author: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', // 谁回的
    required: true 
  },
  content: { type: String, required: true }, // 回答内容 (HTML)
  
  likes: { type: Number, default: 0 }, // 点赞数
  comments: { type: Number, default: 0 }, // 二级评论数 (预留)

  isAccepted: { type: Boolean, default: false }, // 是否被采纳 (针对问题)

}, { timestamps: true });

export default mongoose.model('ForumReply', forumReplySchema);