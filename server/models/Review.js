import mongoose from 'mongoose';

const reviewSchema = new mongoose.Schema({
  // 评分 (1-5星)
  rating: { type: Number, required: true, min: 1, max: 5 },
  
  // 评论内容
  content: { type: String, required: true },
  
  // 关联的书籍
  book: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Book', 
    required: true 
  },
  
  // 关联的用户
  user: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
}, {
  timestamps: true 
});

// 防止同一个用户对同一本书刷分 (复合索引)
reviewSchema.index({ book: 1, user: 1 }, { unique: true });

export default mongoose.model('Review', reviewSchema);