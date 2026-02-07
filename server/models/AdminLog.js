// server/models/AdminLog.js
import mongoose from 'mongoose';

const AdminLogSchema = new mongoose.Schema({
  admin_id: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  action: { 
    type: String, 
    required: true 
  },
  target_user_id: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  },
  ip_address: String,
  details: String, // 存一些备注信息
  created_at: { 
    type: Date, 
    default: Date.now 
  }
});

export default mongoose.model('AdminLog', AdminLogSchema);