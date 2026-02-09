import mongoose from 'mongoose';

const verificationCodeSchema = new mongoose.Schema({
  email: { 
    type: String, 
    required: true, 
    // 加上 unique 索引，确保一个邮箱同时只有一条记录在库里，方便管理
    unique: true 
  },
  code: { type: String, required: true },
  
  // ✅ 新增：记录当前这轮发了多少次
  sendCount: { type: Number, default: 1 },
  
  // ✅ 新增：上次发送时间（用于计算60秒冷却）
  lastSentAt: { type: Date, default: Date.now },
  
  // ⚠️ 修改：数据存活时间改为 1小时 (3600秒)。
  // 解释：为了限制 "1小时内只能发5次"，这条记录必须活够1小时。
  // 如果5分钟就删了，系统就忘了用户刚才发过，限制就失效了。
  createdAt: { type: Date, default: Date.now, expires: 3600 } 
});

export default mongoose.model('VerificationCode', verificationCodeSchema);