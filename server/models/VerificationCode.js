const mongoose = require('mongoose');

const verificationCodeSchema = new mongoose.Schema({
  email: { type: String, required: true },
  code: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, expires: 300 } // 5分钟后自动删除
});

module.exports = mongoose.model('VerificationCode', verificationCodeSchema);