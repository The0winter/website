import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema({
  // ❌ 删除：id: String, 
  // 我们不再需要手动存 id 了，下面会用虚拟字段自动生成

  username: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['reader', 'writer', 'admin'], default: 'reader' },
  avatar: String, 
  loginAttempts: { type: Number, default: 0 },
  lockUntil: { type: Number }, // 存时间戳
  created_at: { type: Date, default: Date.now },
}, { 
  timestamps: true,
  // 🔥🔥🔥 关键修改 1：配置 JSON 输出选项 🔥🔥🔥
  toJSON: {
    virtuals: true, // 允许虚拟字段 (如 id) 显示在 JSON 里
    versionKey: false, // 不显示 __v
    transform: function (doc, ret) {
      delete ret._id;      // (可选) 让前端只看到 id，看不到 _id，更干净
      delete ret.password; // 🔒 安全：绝对不能把密码返回给前端
    }
  }
});

UserSchema.virtual('isLocked').get(function() {
    // 如果有锁定时间，且当前时间还在锁定时间之前 -> 锁定中
    return !!(this.lockUntil && this.lockUntil > Date.now());
});

// 🔥🔥🔥 关键修改 2：显式定义 id 虚拟字段 🔥🔥🔥
// 这段代码的意思是：每当有人要读取 user.id 时，自动返回 user._id 的字符串值
UserSchema.virtual('id').get(function() {
  return this._id.toHexString();
});

// 导出模型
const User = mongoose.models.User || mongoose.model('User', UserSchema);
export default User;