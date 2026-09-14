import mongoose from 'mongoose';

// A durable cleanup queue, not a TTL index: the object must be removed before its receipt.
const schema = new mongoose.Schema({_id: String, retireAt: {type: Date, default: null}}, {timestamps: true});
schema.index({retireAt: 1});
export default mongoose.model('WriterBlob', schema);
