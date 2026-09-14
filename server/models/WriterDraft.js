import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  _id: String,
  owner: {type: mongoose.Schema.Types.ObjectId, required: true},
  work: {type: String, required: true},
  draftId: {type: String, required: true},
  title: String,
  number: Number,
  contentKey: String,
  contentSha256: String,
  words: {type: Number, default: 0},
  revision: {type: Number, default: 0},
  savedHash: String,
  targetChapterId: mongoose.Schema.Types.ObjectId,
  baseUpdatedAt: String,
  legacyBaseHash: String,
  deleted: {type: Boolean, default: false},
  deletedAt: Date,
  trashUntil: Date,
  published: {type: Boolean, default: false},
}, {timestamps: true});
schema.index({owner: 1, work: 1, number: -1});
schema.index({contentKey: 1}, {sparse: true});
schema.index({trashUntil: 1}, {sparse: true});
export default mongoose.model('WriterDraft', schema);
