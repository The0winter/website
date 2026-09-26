import mongoose from 'mongoose';

const reviewSchema = new mongoose.Schema({
  // 评分 (1-5星)
  rating: { type: Number, required: true, min: 1, max: 5, validate: Number.isInteger },
  isTestData: { type: Boolean, default: false },
  testBatch: { type: String, select: false },
  
  // 评论内容
  content: { type: String, default: '', validate: {validator: value => Array.from(value || '').length <= 140, message: '短评最多140字'} },
  likedBy: { type: [mongoose.Schema.Types.ObjectId], default: [], select: false },
  dislikedBy: { type: [mongoose.Schema.Types.ObjectId], default: [], select: false },
  
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
