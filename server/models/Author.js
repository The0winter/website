import mongoose from 'mongoose';

// Imported attribution is not an account and never grants login or edit rights.
const schema = new mongoose.Schema({
  sourceKey: {type:String,required:true,unique:true},
  name: {type:String,required:true,maxlength:200},
  sourceUrl: String,
  identityKey: {type:String,unique:true,sparse:true},
  mergedInto: {type:mongoose.Schema.Types.ObjectId,ref:'Author'},
}, {timestamps:true});
export default mongoose.model('Author',schema);
