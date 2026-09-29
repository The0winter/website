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
  title: { type: String, maxlength: 200 },
  source: { type: new mongoose.Schema({
    title: String,
    author: String,
    url: String,
    license: String,
    licenseUrl: String,
    publishedAt: Date
  }, { _id: false }), default: undefined },

  likes: { type: Number, default: 0 },
  likedBy: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  comments: { type: Number, default: 0 },

  isAccepted: { type: Boolean, default: false }
}, { timestamps: true });

forumReplySchema.index({postId:1,likes:-1,createdAt:-1,_id:1});
forumReplySchema.index({createdAt:-1,_id:-1});
forumReplySchema.index({likes:-1,createdAt:-1,_id:-1});
export default mongoose.model('ForumReply', forumReplySchema);
