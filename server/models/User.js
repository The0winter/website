// server/models/User.js
import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String },
  password: { type: String },
  role: { type: String, default: 'user' }, // 例如: user, writer, admin
  createdAt: { type: Date, default: Date.now }
});

// 关键：这里注册了名字叫 "User" 的模型
export default mongoose.model('User', userSchema);