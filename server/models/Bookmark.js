import mongoose from 'mongoose';

const bookmarkSchema = new mongoose.Schema({
  // 1. 关于 user_id：
  // 你的库里目前存的是 String (绿色字)，但为了能用 .populate() 关联查询用户，
  // 最好定义为 ObjectId。Mongoose 会自动把你库里的字符串 ID 转成对象 ID 读取，兼容性没问题。
  user_id: {
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true
  },
  
  // 2. bookId 你的库里已经是标准的 ObjectId (红色字)，保持一致
  bookId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Book',
    required: true
  },

  // 3. 你的数据里有这个手动的时间字段，保留它
  created_at: {
    type: Date,
    default: Date.now
  }
}, {
  // 4. ✅ 这一行非常重要！
  // 你的截图显示数据里有 "createdAt" 和 "updatedAt"，加上这个选项会自动维护它们
  timestamps: true 
});

// 复合索引：防止重复收藏
bookmarkSchema.index({ user_id: 1, bookId: 1 }, { unique: true });

const Bookmark = mongoose.model('Bookmark', bookmarkSchema);
export default Bookmark;