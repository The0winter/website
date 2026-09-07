import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  referenceVersion:{type:Number,default:0},
  owner: {type:mongoose.Schema.Types.ObjectId,required:true,index:true},
  content: {type:Buffer,required:true,select:false},
  mime: {type:String,required:true},
  sha256: {type:String,required:true},
  deleted: {type:Boolean,default:false},
}, {timestamps:true});
export default mongoose.model('Media',schema);
