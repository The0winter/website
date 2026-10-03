import mongoose from 'mongoose';

// Kept after history removal so an old offline client cannot recreate deleted progress.
const anchor = new mongoose.Schema({
  chapterId: {type: mongoose.Schema.Types.ObjectId, required: true},
  chapterNumber: {type: Number, required: true},
  contentVersion: String,
  paragraphKey: String,
  paragraphIndex: {type: Number, default: 0},
  charOffset: {type: Number, default: 0},
}, {_id: false});
const schema = new mongoose.Schema({
  _id: String,
  userId: {type: mongoose.Schema.Types.ObjectId, required: true},
  bookId: {type: mongoose.Schema.Types.ObjectId, required: true},
  revision: {type: Number, required: true},
  position: anchor,
  furthest: anchor,
  deleted: {type: Boolean, default: false},
  deviceId: String,
  updatedAt: {type: Date, required: true},
});
schema.index({userId: 1, updatedAt: -1});
export default mongoose.model('ReadingPosition', schema);
