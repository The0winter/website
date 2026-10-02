import mongoose from 'mongoose';
export default mongoose.model('TransferCapacity',new mongoose.Schema({
  _id:String, reserved:{type:Number,default:0}, version:{type:Number,default:0},
}));
