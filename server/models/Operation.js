import mongoose from 'mongoose';
export default mongoose.model('Operation',new mongoose.Schema({_id:String,hash:String,resultId:mongoose.Schema.Types.ObjectId,expiresAt:{type:Date,expires:0}}));
