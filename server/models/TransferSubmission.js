import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  owner: {type: mongoose.Schema.Types.ObjectId, ref:'User', required:true},
  title: {type:String, required:true, maxlength:200},
  author: {type:String, required:true, maxlength:200},
  filename: String, declaredBytes:Number, bytes:Number, sha256:String,
  status: {type:String, enum:['uploading','pending','importing','accepted','rejected','expired'], default:'uploading'},
  chapterCount:Number, characters:Number, processed:{type:Number,default:0},
  bookId:mongoose.Schema.Types.ObjectId, reviewer:mongoose.Schema.Types.ObjectId,
  reason:String, stored:{type:Boolean,default:false}, released:{type:Boolean,default:false},
  reviewVersion:{type:Number,default:0},
}, {timestamps:true});
schema.index({owner:1,createdAt:-1});
schema.index({status:1,createdAt:-1});
export default mongoose.model('TransferSubmission',schema);
