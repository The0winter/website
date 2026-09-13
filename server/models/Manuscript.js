import mongoose from "mongoose";
const schema = new mongoose.Schema(
  {
    _id: String,
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    title: String,
    description: String,
    cover_image: String,
    category: String,
    filename: String,
    chapters: [
      new mongoose.Schema(
        { title: String, content: String, sourceNumber: Number },
        { _id: false },
      ),
    ],
    totalCharacters: Number,
    revision: { type: Number, default: 0 },
    savedHash: String,
    publishedBookId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Book",
      default: null,
    },
  },
  { timestamps: true },
);
schema.index({ owner: 1, publishedBookId: 1, updatedAt: -1 });
export default mongoose.model("Manuscript", schema);
