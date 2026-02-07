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
});

export default mongoose.model('User', UserSchema);