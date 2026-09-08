import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  _id: String, owner: String, leaseUntil: Date, status: String,
  slot: Number, lastError: String, finishedAt: Date,
  expiresAt: {type: Date, expires: 0},
});
export default mongoose.models.Job || mongoose.model('Job', schema);
