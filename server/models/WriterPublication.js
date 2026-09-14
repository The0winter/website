import mongoose from 'mongoose';

// Durable receipts make publication retries safe even after a device goes offline.
const schema = new mongoose.Schema({
  _id: String,
  owner: {type: mongoose.Schema.Types.ObjectId, required: true},
  work: {type: String, required: true},
  draftId: {type: String, required: true},
  hash: {type: String, required: true},
  bookId: {type: mongoose.Schema.Types.ObjectId, required: true},
  chapterId: {type: mongoose.Schema.Types.ObjectId, required: true},
}, {timestamps: true});
schema.index({owner: 1, work: 1});
export default mongoose.model('WriterPublication', schema);
