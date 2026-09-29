import mongoose from 'mongoose';

// Permanent identity tombstones: no TTL and no dependency on a live account.
const schema = new mongoose.Schema({
  _id: {type:String,required:true},
  reservedAt: {type:Date,default:Date.now},
});
export default mongoose.model('UsernameReservation',schema);
