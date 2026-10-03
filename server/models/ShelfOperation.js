import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  _id: String, fingerprint: {type: String, required: true},
  response: {type: mongoose.Schema.Types.Mixed, required: true},
  expiresAt: {type: Date, required: true, expires: 0},
});
export default mongoose.model('ShelfOperation', schema);
