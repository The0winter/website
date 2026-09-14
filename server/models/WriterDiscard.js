import mongoose from 'mongoose';

// Content-free sync receipts prevent offline devices and legacy imports from resurrecting purged drafts.
const schema = new mongoose.Schema({
  _id: String,
  owner: {type: mongoose.Schema.Types.ObjectId, required: true},
  work: {type: String, required: true},
  draftId: {type: String, required: true},
  removedAt: {type: Date, required: true},
});
schema.index({owner: 1, work: 1});
export default mongoose.model('WriterDiscard', schema);
