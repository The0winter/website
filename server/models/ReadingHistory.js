import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  userId: {type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true},
  bookId: {type: mongoose.Schema.Types.ObjectId, ref: 'Book', required: true},
  lastVisitedAt: {type: Date, required: true},
  lastReadAt: Date,
  chapterId: {type: mongoose.Schema.Types.ObjectId, ref: 'Chapter'},
});
schema.index({userId: 1, bookId: 1}, {unique: true});
schema.index({userId: 1, lastVisitedAt: -1});
export default mongoose.model('ReadingHistory', schema);
