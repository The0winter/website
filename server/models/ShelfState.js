import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  _id: String, userId: {type: mongoose.Schema.Types.ObjectId, required: true},
  bookId: {type: mongoose.Schema.Types.ObjectId, required: true},
  revision: {type: Number, required: true}, added: {type: Boolean, required: true},
  deviceId: String, updatedAt: {type: Date, required: true},
});
schema.index({userId: 1, bookId: 1});
export default mongoose.model('ShelfState', schema);
