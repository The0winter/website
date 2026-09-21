import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  _id: String,
  day: String,
  version: Number,
  bookIds: [mongoose.Schema.Types.ObjectId],
  ranks: [Number],
  createdAt: Date,
});
export default mongoose.models.DailyFeatured || mongoose.model('DailyFeatured', schema);
