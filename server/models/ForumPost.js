import mongoose from 'mongoose';

const forumPostSchema = new mongoose.Schema({
  title: { type: String, required: true }, // 标题
  content: { type: String, required: true }, // 内容 (HTML)
  summary: { type: String }, // 摘要 (用于列表展示)
  type: { 
    type: String, 
    enum: ['question', 'article'], // 类型：是问题还是文章
    default: 'question' 
  },
  tags: [String], // 标签 ["社会学", "经济"]
  
  author: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', // 关联到 User 表
    required: true 
  },

  // 数据统计
  views: { type: Number, default: 0 },
  likes: { type: Number, default: 0 },
  replyCount: { type: Number, default: 0 }, // 回答/评论数量

  isHot: { type: Boolean, default: false }, // 是否热榜
  lastReplyAt: { type: Date, default: Date.now }, // 最后回复时间 (用于排序)

}, { timestamps: true }); // 自动生成 createdAt, updatedAt

// 索引：加快查询速度
forumPostSchema.index({ type: 1, createdAt: -1 }); 
forumPostSchema.index({ views: -1 });

export default mongoose.model('ForumPost', forumPostSchema);