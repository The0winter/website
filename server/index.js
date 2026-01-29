// server/index.js
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import './models/User.js'; 
import Book from './models/Book.js';
import Chapter from './models/Chapter.js';
import { scrapeAndSaveBook } from './utils/scraperService.js'; // 路径根据你实际情况调整

dotenv.config(); // 读取 .env

const app = express();

app.use(cors());
app.use(express.json());

// 连接数据库
const MONGO_URL = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/novel-site';

mongoose.connect(MONGO_URL)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

// ================= 定义 Schemas (已修改 bookId) =================



const BookmarkSchema = new mongoose.Schema({
  user_id: String,
  // ✨ 修改：统一为 bookId
  bookId: { type: mongoose.Schema.Types.ObjectId, ref: 'Book', required: true },
  created_at: { type: Date, default: Date.now },
}, { timestamps: true });

const ProfileSchema = new mongoose.Schema({
  id: String,
  username: String,
  email: String,
  password: String, 
  role: { type: String, enum: ['reader', 'writer'], default: 'reader' },
  created_at: { type: Date, default: Date.now },
}, { timestamps: true });

// 防止模型重复编译报错
const Bookmark = mongoose.models.Bookmark || mongoose.model('Bookmark', BookmarkSchema);
const Profile = mongoose.models.Profile || mongoose.model('Profile', ProfileSchema);

// Auth Middleware
const authMiddleware = (req, res, next) => {
  const userId = req.headers['x-user-id'] || req.query.userId;
  if (!userId) {
    return res.status(401).json({ error: 'User ID is required. Please provide x-user-id header or userId query parameter' });
  }
  req.user = { id: userId };
  next();
};

// ================= Books API 路由 =================

app.get('/api/books', async (req, res) => {
    try {
      const { orderBy = 'views', order = 'desc', limit } = req.query;
      let query = Book.find().populate('author_id', 'username email id');
      
      const sortOrder = order === 'asc' ? 1 : -1;
      query = query.sort({ [orderBy]: sortOrder });
      
      if (limit) {
        query = query.limit(parseInt(limit));
      }
      
      const books = await query.exec();
  
      const formattedBooks = books.map(book => ({
        ...book.toObject(),
        id: book._id.toString(),
      }));
      
      res.json(formattedBooks);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
});

app.get('/api/books/:id', async (req, res) => {
    try {
      const book = await Book.findById(req.params.id).populate('author_id', 'username email');
      if (!book) {
        return res.status(404).json({ error: 'Book not found' });
      }
      
      const formattedBook = {
        ...book.toObject(),
        id: book._id.toString()
      };
      
      res.json(formattedBook);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
});

// ✅ 修改后的创建书籍接口
app.post('/api/books', authMiddleware, async (req, res) => {
  try {
    // 1. 解构时加上 author
    const { title, description, cover_image, category, status, views, author } = req.body;
    const userId = req.user.id;
    
    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }
    
    // 查找用户 Profile (为了获取 _id 作为 author_id)
    const profile = await Profile.findOne({ id: userId });
    if (!profile) {
      return res.status(404).json({ error: 'User profile not found.' });
    }
    
    const bookData = {
      title: title.trim(),
      // 2. 关键修改：把名字存进去！
      // 如果前端没传 author，就用 profile 里的 username 兜底
      author: profile.username || author || 'Unknown',
      
      // 3. 关联 ID (这是给 populate 用的)
      author_id: profile._id, 
      
      description: description?.trim() || '',
      cover_image: cover_image || '',
      category: category || '',
      status: status || 'ongoing',
      views: views || 0,
    };
    
    const newBook = new Book(bookData);
    await newBook.save();

    // 4. 返回时带上作者信息
    const populatedBook = await Book.findById(newBook._id).populate('author_id', 'username email id');
    const formattedBook = {
      ...populatedBook.toObject(),
      id: populatedBook._id.toString(),
    };
    
    res.status(201).json(formattedBook);
  } catch (error) {
    console.error('Error creating book:', error);
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/books/:id', async (req, res) => {
  try {
    const book = await Book.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!book) {
      return res.status(404).json({ error: 'Book not found' });
    }
    res.json(book);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/books/:id/views', async (req, res) => {
  try {
    const book = await Book.findByIdAndUpdate(
      req.params.id,
      { $inc: { views: 1 } },
      { new: true }
    );
    if (!book) {
      return res.status(404).json({ error: 'Book not found' });
    }
    res.json(book);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/books/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const deletedBook = await Book.findByIdAndDelete(id);
    
    if (!deletedBook) {
      return res.status(404).json({ error: 'Book not found' });
    }
    // 可选：级联删除章节
    // await Chapter.deleteMany({ bookId: id }); 

    res.json({ message: 'Book deleted successfully' });
  } catch (error) {
    console.error('Error deleting book:', error);
    res.status(500).json({ error: error.message });
  }
});

// ================= Chapters API 路由 (已修改 bookId) =================

app.get('/api/books/:bookId/chapters', async (req, res) => {
  try {
    const { bookId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(bookId)) {
      return res.status(400).json({ error: 'Invalid book ID format' });
    }
    
    // ✨ 修改：查询条件改为 bookId
    const chapters = await Chapter.find({ bookId: new mongoose.Types.ObjectId(bookId) })
      .sort({ chapter_number: 1 })
      .lean();
    
    const formattedChapters = chapters.map(chapter => ({
      id: chapter._id.toString(),
      // ✨ 修改：返回字段改为 bookId
      bookId: chapter.bookId.toString(),
      title: chapter.title,
      content: chapter.content,
      chapter_number: chapter.chapter_number,
      published_at: chapter.published_at ? chapter.published_at.toISOString() : undefined,
    }));
    
    res.json(formattedChapters);
  } catch (error) {
    console.error('Error fetching chapters:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/chapters/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid chapter ID format' });
    }
    
    const chapter = await Chapter.findById(id).lean();
    if (!chapter) {
      return res.status(404).json({ error: 'Chapter not found' });
    }
    
    const formattedChapter = {
      id: chapter._id.toString(),
      // ✨ 修改：返回字段改为 bookId
      bookId: chapter.bookId.toString(),
      title: chapter.title,
      content: chapter.content,
      chapter_number: chapter.chapter_number,
      published_at: chapter.published_at ? chapter.published_at.toISOString() : undefined,
    };
    
    res.json(formattedChapter);
  } catch (error) {
    console.error('Error fetching chapter:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/chapters/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const deletedChapter = await Chapter.findByIdAndDelete(id);
    
    if (!deletedChapter) {
      return res.status(404).json({ error: 'Chapter not found' });
    }
    
    res.json({ message: 'Chapter deleted successfully' });
  } catch (error) {
    console.error('Error deleting chapter:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/chapters - 创建新章节
app.post('/api/chapters', async (req, res) => {
    try {
      // ✨ 修改：直接解构 bookId
      const { bookId, title, content, chapterNumber, chapter_number } = req.body;
      
      // 兼容一下 chapterNumber (前端习惯) 和 chapter_number (后端习惯)
      const finalChapterNum = chapterNumber || chapter_number;

      if (!bookId) return res.status(400).json({ error: 'bookId is required' });
      if (!title) return res.status(400).json({ error: 'title is required' });
      if (!content) return res.status(400).json({ error: 'content is required' });
      if (finalChapterNum === undefined) return res.status(400).json({ error: 'chapterNumber is required' });
      
      if (!mongoose.Types.ObjectId.isValid(bookId)) {
        return res.status(400).json({ error: 'Invalid bookId format' });
      }
      
      const book = await Book.findById(bookId);
      if (!book) {
        return res.status(404).json({ error: 'Book not found' });
      }
      
      const chapterData = {
        // ✨ 修改：存入数据库的字段是 bookId
        bookId: new mongoose.Types.ObjectId(bookId),
        title: title.trim(),
        content: content.trim(),
        chapter_number: parseInt(finalChapterNum),
      };

      const newChapter = new Chapter(chapterData);
      await newChapter.save();
      
      const formattedChapter = {
        id: newChapter._id.toString(),
        // ✨ 修改：返回字段是 bookId
        bookId: newChapter.bookId.toString(),
        title: newChapter.title,
        content: newChapter.content,
        chapter_number: newChapter.chapter_number,
        published_at: newChapter.published_at ? newChapter.published_at.toISOString() : undefined,
      };
      
      res.status(201).json(formattedChapter);
    } catch (error) {
      console.error('Error creating chapter:', error);
      res.status(500).json({ error: error.message });
    }
});

// ================= Bookmarks API 路由 (已修改 bookId) =================

app.get('/api/users/:userId/bookmarks', async (req, res) => {
  try {
    // ✨ 修改：populate 关联字段改为 bookId
    const bookmarks = await Bookmark.find({ user_id: req.params.userId })
      .populate('bookId');
    res.json(bookmarks);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/users/:userId/bookmarks/:bookId', async (req, res) => {
  try {
    const bookId = mongoose.Types.ObjectId.isValid(req.params.bookId) 
      ? new mongoose.Types.ObjectId(req.params.bookId)
      : req.params.bookId;
    
    // ✨ 修改：查询字段改为 bookId
    const bookmark = await Bookmark.findOne({
      user_id: req.params.userId,
      bookId: bookId,
    });
    if (!bookmark) {
      return res.status(404).json({ error: 'Bookmark not found' });
    }
    res.json(bookmark);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/users/:userId/bookmarks', async (req, res) => {
  try {
    // ✨ 修改：直接使用 bookId，不再做兼容判断
    const { bookId } = req.body;

    if (!bookId) {
        return res.status(400).json({ error: 'bookId is required' });
    }

    const bookmarkData = {
      user_id: req.params.userId,
      // ✨ 修改：存入 bookId 字段
      bookId: mongoose.Types.ObjectId.isValid(bookId) 
        ? new mongoose.Types.ObjectId(bookId)
        : bookId,
    };
    
    const bookmark = new Bookmark(bookmarkData);
    await bookmark.save();
    res.json(bookmark);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/users/:userId/bookmarks/:bookId', async (req, res) => {
  try {
    const bookId = mongoose.Types.ObjectId.isValid(req.params.bookId) 
      ? new mongoose.Types.ObjectId(req.params.bookId)
      : req.params.bookId;
      
    // ✨ 修改：查询字段改为 bookId
    await Bookmark.findOneAndDelete({
      user_id: req.params.userId,
      bookId: bookId,
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ================= Users/Profiles API 路由 =================

app.get('/api/users/:userId/profile', async (req, res) => {
  try {
    const profile = await Profile.findOne({ id: req.params.userId });
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    const { password, ...profileWithoutPassword } = profile.toObject();
    res.json(profileWithoutPassword);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, password, username, role } = req.body;
    
    const existingProfile = await Profile.findOne({ email });
    if (existingProfile) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    const userId = new mongoose.Types.ObjectId().toString();
    
    const profile = new Profile({
      id: userId,
      email,
      password, 
      username,
      role: role || 'reader',
    });
    
    await profile.save();
    
    const { password: _, ...profileWithoutPassword } = profile.toObject();
    res.json({ user: { id: userId, email }, profile: profileWithoutPassword });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/signin', async (req, res) => {
  try {
    const { email, username, password } = req.body;
    const identifier = email || username;

    if (!identifier || !password) {
      return res.status(400).json({ error: 'Please provide account and password' });
    }
    
    const profile = await Profile.findOne({ 
      $or: [
        { email: identifier },
        { username: identifier }
      ],
      password: password 
    });

    if (!profile) {
      return res.status(401).json({ error: 'Invalid account or password' });
    }
    
    const { password: _, ...profileWithoutPassword } = profile.toObject();
    res.json({ user: { id: profile.id, email: profile.email }, profile: profileWithoutPassword });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/auth/session', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || req.query.userId;
    if (!userId) {
      return res.json({ user: null, profile: null });
    }
    
    const profile = await Profile.findOne({ id: userId });
    if (!profile) {
      return res.json({ user: null, profile: null });
    }
    
    const { password: _, ...profileWithoutPassword } = profile.toObject();
    res.json({ user: { id: profile.id, email: profile.email,username: profile.username }, profile: profileWithoutPassword });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});