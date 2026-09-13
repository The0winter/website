import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  _id: mongoose.Schema.Types.ObjectId,
  bookId: {type: mongoose.Schema.Types.ObjectId, required: true},
  views: {type: Number, default: 0},
  startedAt: {type: Date, default: Date.now},
});
schema.index({bookId: 1, views: -1});
export default mongoose.models.ChapterRead || mongoose.model('ChapterRead', schema);
