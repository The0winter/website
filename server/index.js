// server/index.js
import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';

// 引入模型
import User from './models/User.js'; 
import Book from './models/Book.js';
import Chapter from './models/Chapter.js';

dotenv.config();
const app = express();

// ================= CORS & Middleware 配置 =================
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (origin.includes('localhost')) return callback(null, true);
    if (origin.endsWith('.vercel.app')) return callback(null, true);
    if (origin.endsWith('.railway.app')) return callback(null, true); // 加上 Railway 域名
    console.log('🚫 CORS 拦截了请求来源:', origin);
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-user-id', 'x-admin-secret'], // 加了 x-admin-secret
  credentials: true
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '50mb' })); 
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ================= 数据库连接 =================
const MONGO_URL = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/novel-site';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'wo_de_pa_chong_mi_ma_123';

mongoose.connect(MONGO_URL)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

// ================= 辅助函数 (Helpers) =================

/**
 * 确保作者存在：在 Users 集合里找作者，找不到就创建
 */
async function ensureAuthorExists(authorName) {
    if (!authorName || authorName === '未知') return null;
    try {
        let user = await User.findOne({ username: authorName });
        if (user) return user;

        console.log(`🆕 上传检测到新作者，正在创建账号: ${authorName}`);
        const timestamp = Date.now();
        const randomNum = Math.floor(Math.random() * 1000);
        
        user = await User.create({
            username: authorName,
            email: `author_${timestamp}_${randomNum}@auto.generated`,
            password: '123456', 
            role: 'writer',
            created_at: new Date()
        });
        return user;
    } catch (e) {
        console.error(`⚠️ 作者创建失败: ${e.message}`);
        return null;
    }
}

// ================= Auth Middleware =================
const authMiddleware = (req, res, next) => {
  const userId = req.headers['x-user-id'] || req.query.userId;
  if (!userId) return res.status(401).json({ error: 'User ID is required.' });
  req.user = { id: userId };
  next();
};

// ================= Admin API (上传接口) =================

// 唯一且正确的上传接口
app.post('/api/admin/upload-book', async (req, res) => {
    try {
        const clientSecret = req.headers['x-admin-secret'];
        if (clientSecret !== ADMIN_SECRET) {
            return res.status(403).json({ error: '🚫 密码错误' });
        }

        const bookData = req.body;
        console.log(`📥 开始接收: 《${bookData.title}》`);

        // --- 1. 处理作者 ---
        let authorId = null;
        if (bookData.author) {
            const authorUser = await ensureAuthorExists(bookData.author);
            if (authorUser) authorId = authorUser._id;
        }

        // --- 2. 处理书籍 ---
        let book = await Book.findOne({ title: bookData.title });
        if (!book) {
            book = await Book.create({
                title: bookData.title,
                bookId: 'auto_' + Date.now(),
                author: bookData.author,
                author_id: authorId,
                category: bookData.category || '搬运', // 读取分类
                description: '离线爬虫上传',
                status: '连载',
                sourceUrl: bookData.sourceUrl,
                chapterCount: bookData.chapters.length
            });
            console.log(`📚 新书入库: ${book.title}`);
        } else {
            // 更新作者和分类
            if (!book.author_id && authorId) book.author_id = authorId;
            if (bookData.category && book.category === '搬运') book.category = bookData.category;
            
            book.chapterCount = Math.max(book.chapterCount, bookData.chapters.length);
            await book.save();
        }

        // --- 3. 处理章节 ---
        const chaptersToInsert = [];
        for (const chap of bookData.chapters) {
            const exists = await Chapter.exists({ bookId: book._id, title: chap.title });
            if (!exists) {
                chaptersToInsert.push({
                    bookId: book._id,
                    title: chap.title,
                    content: chap.content,
                    chapter_number: chap.chapter_number
                });
            }
        }

        if (chaptersToInsert.length > 0) {
            await Chapter.insertMany(chaptersToInsert);
        }

        res.json({ success: true, message: `成功入库！新增 ${chaptersToInsert.length} 章` });
    } catch (error) {
        console.error('上传出错:', error);
        res.status(500).json({ error: error.message });
    }
});

// ================= Auth API (用户系统) =================

app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, password, username, role } = req.body;
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ error: 'Email already exists' });

    const newId = new mongoose.Types.ObjectId(); 
    const newUser = new User({
      _id: newId,         
      id: newId.toString(),
      email,
      password, 
      username,
      role: role || 'reader',
    });
    
    await newUser.save();
    const { password: _, ...userWithoutPassword } = newUser.toObject();
    res.json({ user: { id: newId.toString(), email, username: newUser.username }, profile: userWithoutPassword });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/signin', async (req, res) => {
  try {
    const { email, username, password } = req.body;
    const identifier = email || username;
    if (!identifier || !password) return res.status(400).json({ error: 'Provide account/password' });
    
    const user = await User.findOne({ 
      $or: [{ email: identifier }, { username: identifier }],
      password: password 
    });

    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    
    const { password: _, ...userWithoutPassword } = user.toObject();
    res.json({ user: { id: user.id, email: user.email }, profile: userWithoutPassword });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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

app.get('/api/books', async (req, res) => {
    try {
      const { orderBy = 'views', order = 'desc', limit, author_id } = req.query;
      const filter = {};
      if (author_id) filter.author_id = author_id;

      let query = Book.find(filter).populate('author_id', 'username email id');
      
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

app.get('/api/books/:id', async (req, res) => {
    try {
      const book = await Book.findById(req.params.id).populate('author_id', 'username email id');
      if (!book) return res.status(404).json({ error: 'Book not found' });
      res.json({ ...book.toObject(), id: book._id.toString() });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
});

app.post('/api/books', authMiddleware, async (req, res) => {
  try {
    const { title, description, cover_image, category, status, views, author } = req.body;
    const userId = req.user.id;
    
    if (!title) return res.status(400).json({ error: 'Title is required' });
    
    const user = await User.findOne({ id: userId });
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    const newBook = new Book({
      title: title.trim(),
      author: user.username || author || 'Unknown', 
      author_id: user._id, 
      description: description?.trim() || '',
      cover_image: cover_image || '',
      category: category || '',
      status: status || 'ongoing',
      views: views || 0,
    });
    
    await newBook.save();
    const populatedBook = await Book.findById(newBook._id).populate('author_id', 'username email id');
    res.status(201).json({ ...populatedBook.toObject(), id: populatedBook._id.toString() });
  } catch (error) {
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

// Inline Schema (如果有 models/Bookmark.js，请替换这里的定义)
const BookmarkSchema = new mongoose.Schema({
  user_id: String,
  bookId: { type: mongoose.Schema.Types.ObjectId, ref: 'Book', required: true },
  created_at: { type: Date, default: Date.now },
}, { timestamps: true });
const Bookmark = mongoose.models.Bookmark || mongoose.model('Bookmark', BookmarkSchema);

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

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});