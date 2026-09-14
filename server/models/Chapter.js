import mongoose from 'mongoose';

const chapterSchema = new mongoose.Schema({
  deletedAt:{type:Date,default:null},
  sourceUrl:{type:String,maxLength:2000},
  // 统一改为 bookId，关联 Book 表
  bookId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Book', 
    required: true 
  },
  
  title: { type: String, required: true, maxLength: 100 },
  content: { type: String, required: function(){return !this.contentKey;}, maxLength: 60000 },
  contentKey: { type:String, match:/^chapters\/sha256\/[a-f0-9]{64}\.txt$/ },
  contentSha256: { type:String, match:/^[a-f0-9]{64}$/ },
  chapter_number: { type: Number, required: true },
  volume_title: { type: String, maxLength: 100 },
  volume_number: { type: Number, min: 1 },
  word_count: { type: Number, default: 0 },
  published_at: { type: Date, default: Date.now },
}, { 
  timestamps: true 
});

// ✅ 步骤 1：先定义索引 (要在创建 Model 之前！)
// 这是一个好习惯，能防止同一本书出现重复的章节号
chapterSchema.index({ bookId: 1, chapter_number: 1 },{unique:true});

// ✅ 步骤 2：检查模型是否存在 (防止热更新报错)
const Chapter = mongoose.models.Chapter || mongoose.model('Chapter', chapterSchema);

// ✅ 步骤 3：唯一的导出
export default Chapter;
