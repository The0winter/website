import mongoose from 'mongoose';
const schema=new mongoose.Schema({_id:String,userId:mongoose.Schema.Types.ObjectId,day:String,views:{type:Number,default:0},uploads:{type:Number,default:0},expiresAt:{type:Date,expires:0}});
schema.index({userId:1,day:1});
export default mongoose.models.UserDaily||mongoose.model('UserDaily',schema);
