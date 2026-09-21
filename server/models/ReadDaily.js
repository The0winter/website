import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  _id: String,
  bookId: mongoose.Schema.Types.ObjectId,
  day: String,
  // Includes the separately recorded editorial baseline plus genuine reads.
  views: Number,
  baselineViews: Number,
  baselineTargetViews: Number,
  baselineVersion: Number,
  baselineQidianRank: Number,
  baselineGeneratedAt: Date,
  baselinePriorTotal: Number,
  expiresAt: {type: Date, expires: 0},
});
schema.index({day: 1, bookId: 1});
export default mongoose.models.ReadDaily || mongoose.model('ReadDaily', schema);
