import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  referenceVersion:{type:Number,default:0},
  owner: {type:mongoose.Schema.Types.ObjectId,required:true,index:true},
  content: {type:Buffer,required:function(){return this.storage !== 'r2';},select:false},
  storage: {type:String,enum:['mongo','r2'],default:'mongo'},
  publicUrl: {type:String,index:true},
  bucket: String,
  variants: [{_id:false,key:String,width:Number,height:Number,size:Number}],
  mime: {type:String,required:true},
  sha256: {type:String,required:true},
  deleted: {type:Boolean,default:false},
}, {timestamps:true});
export default mongoose.model('Media',schema);
