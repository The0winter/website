import mongoose from 'mongoose';

const forumReplySchema = new mongoose.Schema({
  postId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ForumPost',
    required: true
  },
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  content: { type: String, required: true },

  likes: { type: Number, default: 0 },
  likedBy: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  comments: { type: Number, default: 0 },

  isAccepted: { type: Boolean, default: false }
}, { timestamps: true });

forumReplySchema.index({postId:1,likes:-1,createdAt:-1,_id:1});
export default mongoose.model('ForumReply', forumReplySchema);
