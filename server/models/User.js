// server/models/User.js
import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema({
  // 保持和你之前 Profile 一样的字段，这样逻辑不用大改
  id: String, // 如果你依赖这个作为字符串ID
  username: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true }, // 真实项目中建议加密
  role: { type: String, enum: ['reader', 'writer'], default: 'reader' },
  avatar: String, // 预留头像字段
  created_at: { type: Date, default: Date.now },
}, { 
  timestamps: true 
});

// 导出模型，名字统一叫 'User'
const User = mongoose.models.User || mongoose.model('User', UserSchema);
export default User;