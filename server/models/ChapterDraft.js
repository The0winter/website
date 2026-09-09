import mongoose from 'mongoose';
const schema=new mongoose.Schema({
  bookId:{type:mongoose.Schema.Types.ObjectId,ref:'Book',required:true},
  owner:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true},
  targetChapterId:{type:mongoose.Schema.Types.ObjectId,default:null},
  baseHash:String,
  title:{type:String,required:true,maxLength:100},
  content:{type:String,required:true,maxLength:60000},
  chapter_number:{type:Number,required:true},
  publishedChapterId:{type:mongoose.Schema.Types.ObjectId,default:null}
},{timestamps:true});
// One active working draft per book/author. Never silently replace another chapter draft.
schema.index({bookId:1,owner:1},{unique:true});
export default mongoose.model('ChapterDraft',schema);
