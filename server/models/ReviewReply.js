import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  book: {type: mongoose.Schema.Types.ObjectId, ref: 'Book', required: true},
  review: {type: mongoose.Schema.Types.ObjectId, ref: 'Review', required: true},
  user: {type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true},
  content: {type: String, required: true, maxlength: 2000},
}, {timestamps: true});
schema.index({review: 1, createdAt: 1, _id: 1});
export default mongoose.models.ReviewReply || mongoose.model('ReviewReply', schema);
