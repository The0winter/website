import mongoose from 'mongoose';

const chapterSchema = new mongoose.Schema({
  // 统一改为 bookId，关联 Book 表
  bookId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Book', 
    required: true 
  },
  
  title: { type: String, required: true },
  content: { type: String, required: true },
  chapter_number: { type: Number, required: true },
  published_at: { type: Date, default: Date.now },
}, { 
  timestamps: true 
});

// ✅ 步骤 1：先定义索引 (要在创建 Model 之前！)
// 这是一个好习惯，能防止同一本书出现重复的章节号
chapterSchema.index({ bookId: 1, chapter_number: 1 });

// ✅ 步骤 2：检查模型是否存在 (防止热更新报错)
const Chapter = mongoose.models.Chapter || mongoose.model('Chapter', chapterSchema);

// ✅ 步骤 3：唯一的导出
export default Chapter;