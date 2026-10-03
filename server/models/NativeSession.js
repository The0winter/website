import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  _id: String,
  userId: {type: mongoose.Schema.Types.ObjectId, required: true, index: true},
  authVersion: {type: Number, required: true},
  refreshDigest: {type: String, required: true, select: false},
  deviceName: {type: String, required: true},
  createdAt: {type: Date, required: true},
  lastUsedAt: {type: Date, required: true},
  expiresAt: {type: Date, required: true, expires: 0},
  revokedAt: {type: Date, default: null},
  revokedReason: String,
});
schema.index({userId: 1, revokedAt: 1, expiresAt: 1});
export default mongoose.model('NativeSession', schema);
