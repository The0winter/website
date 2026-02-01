import mongoose from 'mongoose';

const bookSchema = new mongoose.Schema({
  // --- 截图中的字段 ---
  title: { type: String, required: true, unique: true },
  description: { type: String, default: '暂无简介' },
  cover_image: { type: String, default: '' },
  category: { type: String, default: '未分类' },
  status: { type: String, enum: ['连载', '完结'], default: '连载' },
  
  // 冗余存储的作者名（直接显示字符串）
  author: { type: String },

  // 👇👇👇 重点修改这里！已补全 👇👇👇
  author_id: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' // 关键！告诉 Mongoose 去 'User' 表里找人
  },

  views: { type: Number, default: 0 },
  views: { type: Number, default: 0 },          // 总阅读 (已有)
  daily_views: { type: Number, default: 0 },    // 日阅读 (新增)
  weekly_views: { type: Number, default: 0 },   // 周阅读 (新增)
  monthly_views: { type: Number, default: 0 },   // 月阅读 (新增)
  // 👇👇👇 新增评分系统字段 👇👇👇
  rating: { 
    type: Number, 
    default: 0,
    min: 0,
    max: 5
  },
  numReviews: { 
    type: Number, 
    default: 0 
  },

  // --- 爬虫专用字段 (已保留) ---
  sourceUrl: { type: String },
  lastUpdated: { type: Date, default: Date.now }
}, {
  timestamps: true
});

export default mongoose.model('Book', bookSchema);