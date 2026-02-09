import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
  },
  password: {
    type: String,
    required: true,
  },
  role: {
    type: String,
    default: 'reader',
  },
  
  // 👇👇👇【关键修复】必须补上这两个字段，否则代码读不到！👇👇👇
  loginAttempts: { 
    type: Number, 
    required: true, 
    default: 0 
  },
  lockUntil: { 
    type: Number 
  },
  // 👆👆👆【关键修复】结束 👆👆👆

  created_at: {
    type: Date,
    default: Date.now,
  },
  daily_upload_words: { type: Number, default: 0 }, // 今天已上传字数
  last_upload_date: { type: Date, default: Date.now }, // 上次上传日期
  isBanned: { type: Boolean, default: false },

  // ✅ 新增：用户活跃度统计 (用于画图和排序)
  stats: {
    today_views: { type: Number, default: 0 },   // 今日阅读章节数
    today_uploads: { type: Number, default: 0 }, // 今日上传次数
    // 历史记录 (存最近7天，用于画曲线)
    history: [{
        date: { type: Date },
        views: { type: Number },
        uploads: { type: Number }
    }]
  },
  // ✅ 新增：周活跃度综合评分 (用于排序：浏览量+上传量)
  weekly_score: { type: Number, default: 0 },

  created_at: { type: Date, default: Date.now }
});

export default mongoose.model('User', UserSchema);