import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  book: {type: mongoose.Schema.Types.ObjectId, ref: 'Book', required: true},
  chapter: {type: mongoose.Schema.Types.ObjectId, ref: 'Chapter', required: true},
  paragraphKey: {type: String, required: true, maxlength: 32},
  paragraphText: {type: String, required: true, maxlength: 60000},
  user: {type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true},
  content: {type: String, required: true, maxlength: 1000},
  requestId: {type: String, required: true, maxlength: 64},
}, {timestamps: true});
schema.index({chapter: 1, paragraphKey: 1, createdAt: -1, _id: -1});
schema.index({user: 1, requestId: 1}, {unique: true});
export default mongoose.models.ParagraphComment || mongoose.model('ParagraphComment', schema);
