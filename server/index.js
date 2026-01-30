// server/index.js
import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';

// ✅ 1. 引入统一的模型 (不再在 index.js 里定义 Schema)
import User from './models/User.js'; 
import Book from './models/Book.js';
import Chapter from './models/Chapter.js';
// import { scrapeAndSaveBook } from './utils/scraperService.js'; 

dotenv.config();

const app = express();

// ================= CORS 配置 =================
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (origin.includes('localhost')) return callback(null, true);
    if (origin.endsWith('.vercel.app')) return callback(null, true);
    
    console.log('🚫 CORS 拦截了请求来源:', origin);
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-user-id'],
  credentials: true
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json());

// ================= 数据库连接 =================
const MONGO_URL = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/novel-site';

mongoose.connect(MONGO_URL)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

// ================= Inline Schemas (书签暂留在此) =================
// 书签比较简单，可以先留在这里，以后也可以移到 models/Bookmark.js
const BookmarkSchema = new mongoose.Schema({
  user_id: String, // 对应 User.id (String)
  bookId: { type: mongoose.Schema.Types.ObjectId, ref: 'Book', required: true },
  created_at: { type: Date, default: Date.now },
}, { timestamps: true });

const Bookmark = mongoose.models.Bookmark || mongoose.model('Bookmark', BookmarkSchema);

// ================= 中间件 =================
const authMiddleware = (req, res, next) => {
  const userId = req.headers['x-user-id'] || req.query.userId;
  if (!userId) {
    return res.status(401).json({ error: 'User ID is required.' });
  }
  req.user = { id: userId };
  next();
};

// ================= Auth API (用户系统) =================

// 注册
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, password, username, role } = req.body;
    
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ error: 'Email already exists' });

    // 生成一个前端用的 String ID
    const userId = new mongoose.Types.ObjectId().toString();
    
    const newUser = new User({
      id: userId,
      email,
      password, 
      username,
      role: role || 'reader',
    });
    
    await newUser.save();
    
    // 返回时去掉密码
    const { password: _, ...userWithoutPassword } = newUser.toObject();
    // 统一返回结构
    res.json({ user: { id: userId, email }, profile: userWithoutPassword });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 登录
app.post('/api/auth/signin', async (req, res) => {
  try {
    const { email, username, password } = req.body;
    const identifier = email || username;

    if (!identifier || !password) {
      return res.status(400).json({ error: 'Please provide account and password' });
    }
    
    const user = await User.findOne({ 
      $or: [{ email: identifier }, { username: identifier }],
      password: password 
    });

    if (!user) return res.status(401).json({ error: 'Invalid account or password' });
    
    const { password: _, ...userWithoutPassword } = user.toObject();
    res.json({ user: { id: user.id, email: user.email }, profile: userWithoutPassword });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取当前用户信息 (Session)
app.get('/api/auth/session', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || req.query.userId;
    if (!userId) return res.json({ user: null, profile: null });
    
    const user = await User.findOne({ id: userId });
    if (!user) return res.json({ user: null, profile: null });
    
    const { password: _, ...userWithoutPassword } = user.toObject();
    res.json({ user: { id: user.id, email: user.email, username: user.username }, profile: userWithoutPassword });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取指定用户信息 (Profile)
app.get('/api/users/:userId/profile', async (req, res) => {
  try {
    const user = await User.findOne({ id: req.params.userId });
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    const { password, ...userWithoutPassword } = user.toObject();
    res.json(userWithoutPassword);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ================= Books API =================

// 获取书籍列表
app.get('/api/books', async (req, res) => {
    try {
      const { orderBy = 'views', order = 'desc', limit } = req.query;
      
      // ✅ 这里现在会去 'users' 表查找 author_id，因为 Book 模型 ref 指向 'User'
      let query = Book.find().populate('author_id', 'username email id');
      
      const sortOrder = order === 'asc' ? 1 : -1;
      query = query.sort({ [orderBy]: sortOrder });
      
      if (limit) query = query.limit(parseInt(limit));
      
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

// 获取单本书
app.get('/api/books/:id', async (req, res) => {
    try {
      // ✅ 同样，populate 会正常工作
      const book = await Book.findById(req.params.id).populate('author_id', 'username email id');
      if (!book) return res.status(404).json({ error: 'Book not found' });
      
      const formattedBook = {
        ...book.toObject(),
        id: book._id.toString()
      };
      
      res.json(formattedBook);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
});

// 创建书籍 (核心修复点)
app.post('/api/books', authMiddleware, async (req, res) => {
  try {
    const { title, description, cover_image, category, status, views, author } = req.body;
    const userId = req.user.id; // 这是 header 里的 string ID
    
    if (!title) return res.status(400).json({ error: 'Title is required' });
    
    // ✅ 关键：通过 String ID 找到 User 文档
    const user = await User.findOne({ id: userId });
    if (!user) {
      return res.status(404).json({ error: 'User not found. Cannot create book.' });
    }
    
    const bookData = {
      title: title.trim(),
      // 存名字（冗余备份）
      author: user.username || author || 'Unknown', 
      // ✅ 存 MongoDB 的 ObjectId，这样 .populate() 才能生效！
      author_id: user._id, 
      
      description: description?.trim() || '',
      cover_image: cover_image || '',
      category: category || '',
      status: status || 'ongoing',
      views: views || 0,
    };
    
    const newBook = new Book(bookData);
    await newBook.save();

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
    if (!book) return res.status(404).json({ error: 'Book not found' });
    res.json(book);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/books/:id', async (req, res) => {
  try {
    const deletedBook = await Book.findByIdAndDelete(req.params.id);
    if (!deletedBook) return res.status(404).json({ error: 'Book not found' });
    // 可选：await Chapter.deleteMany({ bookId: req.params.id }); 
    res.json({ message: 'Book deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ================= Chapters API =================

app.get('/api/books/:bookId/chapters', async (req, res) => {
  try {
    const { bookId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(bookId)) return res.status(400).json({ error: 'Invalid book ID' });
    
    const chapters = await Chapter.find({ bookId: new mongoose.Types.ObjectId(bookId) })
      .sort({ chapter_number: 1 })
      .lean();
    
    const formattedChapters = chapters.map(c => ({
      ...c, id: c._id.toString(), bookId: c.bookId.toString()
    }));
    res.json(formattedChapters);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/chapters/:id', async (req, res) => {
  try {
    const chapter = await Chapter.findById(req.params.id).lean();
    if (!chapter) return res.status(404).json({ error: 'Chapter not found' });
    res.json({ ...chapter, id: chapter._id.toString(), bookId: chapter.bookId.toString() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/chapters', async (req, res) => {
    try {
      const { bookId, title, content, chapterNumber, chapter_number } = req.body;
      const finalChapterNum = chapterNumber || chapter_number;

      if (!bookId || !title || !content || finalChapterNum === undefined) {
        return res.status(400).json({ error: 'Missing required fields' });
      }
      
      const newChapter = new Chapter({
        bookId: new mongoose.Types.ObjectId(bookId),
        title: title.trim(),
        content: content.trim(),
        chapter_number: parseInt(finalChapterNum),
      });

      await newChapter.save();
      res.status(201).json({ ...newChapter.toObject(), id: newChapter._id.toString() });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
});

// ================= Bookmarks API =================

app.get('/api/users/:userId/bookmarks', async (req, res) => {
  try {
    const bookmarks = await Bookmark.find({ user_id: req.params.userId }).populate('bookId');
    res.json(bookmarks);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/users/:userId/bookmarks', async (req, res) => {
  try {
    const { bookId } = req.body;
    if (!bookId) return res.status(400).json({ error: 'bookId is required' });

    const bookmark = new Bookmark({
      user_id: req.params.userId,
      bookId: mongoose.Types.ObjectId.isValid(bookId) ? new mongoose.Types.ObjectId(bookId) : bookId,
    });
    
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
      
    await Bookmark.findOneAndDelete({ user_id: req.params.userId, bookId: bookId });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ================= 启动服务 =================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});