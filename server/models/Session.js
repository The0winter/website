import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  _id: String,
  authVersion:{type:Number,default:0},
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  expiresAt: { type: Date, required: true, expires: 0 },
});
export default mongoose.model('Session', schema);
