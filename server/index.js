// server/index.js
import 'dotenv/config'; // ✅ 现代化引入，自动读取 .env
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import cron from 'node-cron';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

// 引入模型
import User from './models/User.js'; 
import Book from './models/Book.js';
import Chapter from './models/Chapter.js';
import Bookmark from './models/Bookmark.js'; // ✅ 补全模型引入，防止报错
import upload from './utils/upload.js';
import { createReview, getReviews } from './controllers/reviewController.js';

const app = express();
app.set('trust proxy', 1);

// ================= 1. 安全与跨域配置 (优化版) =================

// 定义允许访问的白名单 (以后加新域名只改这里)
const ALLOWED_ORIGINS = [
  'http://localhost:3000',      // 本地前端
  'http://localhost:5000',      // 本地后端调试
  'https://jiutianxiaoshuo.com',     // ✅ 正式域名
  'https://www.jiutianxiaoshuo.com'  // ✅ www 子域名
  // 'https://你的旧项目.up.railway.app' // 如果还需要旧版，取消注释
];

const corsOptions = {
  origin: function (origin, callback) {
    // 允许没有 origin 的请求 (比如 Postman, 服务器端 curl, 或者同源请求)
    if (!origin) return callback(null, true);

    // 检查是否在白名单里
    // 只要 origin 包含白名单里的任何一个字符串，就放行 (更宽松的匹配，防止 https/http 差异)
    const isAllowed = ALLOWED_ORIGINS.some(allowed => origin.includes(allowed));

    if (isAllowed) {
      return callback(null, true);
    } else {
      console.log('🚫 CORS 拦截了非法请求来源:', origin);
      return callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-user-id', 'x-admin-secret'],
  credentials: true
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// 安全头配置
app.use(helmet());

// 解析器配置
app.use(express.json({ limit: '10mb' })); // 稍微调大一点，防止上传大章节报错
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// ================= 2. 限流配置 =================

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 500, 
  message: '请求过于频繁，请稍后再试'
});
app.use('/api/', globalLimiter);

const authLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, 
  max: 10000, // 🚀 够用了
  message: '操作太频繁'
});
app.use('/api/auth/', authLimiter);

// ================= 3. 数据库连接 =================

const MONGO_URL = process.env.MONGO_URI;
// 如果没配置数据库，直接报错，不再默默连本地
if (!MONGO_URL) {
  console.error('❌ 严重错误: 未配置 MONGO_URI 环境变量！');
  process.exit(1);
}

mongoose.connect(MONGO_URL)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

// 管理员密钥 (优先读环境变量)
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'wo_de_pa_chong_mi_ma_123';

// ================= 4. 中间件与辅助函数 =================

const generateRandomPassword = () => Math.random().toString(36).slice(-8);

async function ensureAuthorExists(authorName) {
    if (!authorName || authorName === '未知') return null;
    try {
        let user = await User.findOne({ username: authorName });
        if (user) return user;

        const randomPassword = generateRandomPassword();
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(randomPassword, salt);

        console.log(`🆕 自动创建作者账号: ${authorName}`);
        
        user = await User.create({
            username: authorName,
            email: `author_${Date.now()}_${Math.floor(Math.random() * 1000)}@auto.generated`,
            password: hashedPassword,
            role: 'writer',
            created_at: new Date()
        });
        return user;
    } catch (e) {
        console.error(`⚠️ 作者创建失败: ${e.message}`);
        return null;
    }
}

const authMiddleware = (req, res, next) => {
  const userId = req.headers['x-user-id'] || req.query.userId;
  if (!userId) return res.status(401).json({ error: 'User ID is required.' });
  req.user = { id: userId };
  next();
};

const adminMiddleware = async (req, res, next) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user || user.role !== 'admin') {
            return res.status(403).json({ error: '🚫 权限不足：需要管理员权限' });
        }
        next();
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// ================= 5. API 路由 =================

// --- Admin API ---
app.get('/api/admin/users', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const users = await User.find()
            .select('username email role created_at')
            .sort({ created_at: -1 })
            .limit(100);
        res.json(users);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/impersonate/:userId', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const targetUser = await User.findById(req.params.userId);
        if (!targetUser) return res.status(404).json({ error: '找不到该用户' });

        console.log(`🕵️‍♂️ 管理员 [${req.user.id}] 影子登录 -> [${targetUser.username}]`);
        
        const { password: _, ...userWithoutPassword } = targetUser.toObject();
        res.json({ 
            user: { 
                id: targetUser._id.toString(), 
                email: targetUser.email, 
                username: targetUser.username, 
                role: targetUser.role 
            }, 
            profile: userWithoutPassword 
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/check-sync', async (req, res) => {
    try {
        const clientSecret = req.headers['x-admin-secret'];
        if (clientSecret !== ADMIN_SECRET) return res.status(403).json({ error: '🚫 密码错误' });

        const { title, simpleChapters } = req.body;
        console.log(`🔍 核对同步: 《${title}》`);

        const book = await Book.findOne({ title });
        if (!book) return res.json({ needsFullUpload: true, missingTitles: [] });

        const existingChapters = await Chapter.find({ bookId: book._id }).select('title').lean();
        const existingTitlesSet = new Set(existingChapters.map(c => c.title));
        
        const missingTitles = simpleChapters
            .filter(c => !existingTitlesSet.has(c.title))
            .map(c => c.title);

        res.json({ needsFullUpload: false, missingTitles });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/admin/upload-book', async (req, res) => {
    try {
        const clientSecret = req.headers['x-admin-secret'];
        if (clientSecret !== ADMIN_SECRET) return res.status(403).json({ error: '🚫 密码错误' });

        const bookData = req.body;
        console.log(`📥 接收书籍: 《${bookData.title}》`);

        let authorId = null;
        if (bookData.author) {
            const authorUser = await ensureAuthorExists(bookData.author);
            if (authorUser) authorId = authorUser._id;
        }

        let book = await Book.findOne({ title: bookData.title });
        if (!book) {
            book = await Book.create({
                title: bookData.title,
                bookId: 'auto_' + Date.now(),
                author: bookData.author,
                author_id: authorId,
                category: bookData.category || '搬运',
                description: bookData.description || '无',
                status: '连载',
                sourceUrl: bookData.sourceUrl,
                chapterCount: bookData.chapters.length,
                views: bookData.views || 0
            });
            console.log(`📚 新书创建: ${book.title}`);
        } else {
            if (!book.author_id && authorId) book.author_id = authorId;
            if (bookData.category && book.category === '搬运') book.category = bookData.category;
            book.chapterCount = Math.max(book.chapterCount, bookData.chapters.length);
            await book.save();
        }

        const chaptersToInsert = [];
        for (const chap of bookData.chapters) {
            const exists = await Chapter.exists({ bookId: book._id, title: chap.title });
            if (!exists) {
                chaptersToInsert.push({
                    bookId: book._id,
                    title: chap.title,
                    content: chap.content,
                    word_count: chap.content.length,
                    chapter_number: chap.chapter_number
                });
            }
        }

        if (chaptersToInsert.length > 0) {
            await Chapter.insertMany(chaptersToInsert);
        }

        res.json({ success: true, message: `入库成功，新增 ${chaptersToInsert.length} 章` });
    } catch (error) {
        console.error('上传出错:', error);
        res.status(500).json({ error: error.message });
    }
});

// --- Auth API ---
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, password, username, role } = req.body;
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ error: 'Email already exists' });

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    const newUser = await User.create({
      email,
      password: hashedPassword,
      username,
      role: role || 'reader',
    });
    
    const { password: _, ...userWithoutPassword } = newUser.toObject();
    res.json({ user: { id: newUser._id.toString(), email, username: newUser.username }, profile: userWithoutPassword });
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
      $or: [{ email: identifier }, { username: identifier }]
    });

    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ error: 'Invalid credentials' });
    
    const { password: _, ...userWithoutPassword } = user.toObject();
    res.json({ 
      user: { id: user._id.toString(), email: user.email, username: user.username, role: user.role }, 
      profile: userWithoutPassword 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/change-password', authMiddleware, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) return res.status(400).json({ error: '旧密码错误' });

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    await user.save();

    res.json({ success: true, message: '密码修改成功' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/auth/session', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || req.query.userId;
    if (!userId) return res.json({ user: null, profile: null });
    
    const user = await User.findById(userId);
    if (!user) return res.json({ user: null, profile: null });
    
    const { password: _, ...userWithoutPassword } = user.toObject();
    res.json({ 
      user: { id: user._id.toString(), email: user.email, username: user.username, role: user.role }, 
      profile: userWithoutPassword 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/users/:userId/profile', async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { password, ...userWithoutPassword } = user.toObject();
    res.json(userWithoutPassword);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Reviews ---
app.get('/api/books/:id/reviews', getReviews);
app.post('/api/books/:id/reviews', authMiddleware, createReview);
app.post('/api/upload/cover', authMiddleware, upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '没有上传文件' });
    }
    // Cloudinary 会返回一个 path (即 secure_url)
    res.json({ url: req.file.path });
  } catch (error) {
    console.error('Upload Error:', error);
    res.status(500).json({ error: '上传失败: ' + error.message });
  }
});

// --- Books ---
app.get('/api/books', async (req, res) => {
    try {
      const { orderBy = 'views', order = 'desc', limit, author_id } = req.query;
      const filter = {};
      if (author_id) filter.author_id = author_id;

      let books = await Book.find(filter).populate('author_id', 'username email id').lean();

      if (orderBy === 'composite') {
          books.sort((a, b) => {
              const scoreA = ((a.rating || 0) * 100 * 0.6) + ((a.weekly_views || 0) * 0.4);
              const scoreB = ((b.rating || 0) * 100 * 0.6) + ((b.weekly_views || 0) * 0.4);
              return scoreB - scoreA;
          });
      } else {
          books.sort((a, b) => {
              const valA = a[orderBy] || 0;
              const valB = b[orderBy] || 0;
              if (orderBy === 'updatedAt' || orderBy === 'createdAt') {
                  return new Date(order === 'asc' ? valA : valB) - new Date(order === 'asc' ? valB : valA);
              }
              return order === 'asc' ? valA - valB : valB - valA;
          });
      }
      
      if (limit) books = books.slice(0, parseInt(limit));
      const formattedBooks = books.map(book => ({
        ...book,
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
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    const newBook = new Book({
      title: title.trim(),
      author: user.username || author || 'Unknown', 
      author_id: user._id, 
      description: description?.trim() || '',
      cover_image: cover_image || '',
      category: category || '',
      status: status || '连载',
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
    const bookId = req.params.id;
    console.log(`🗑️ 删除书籍 ID: ${bookId}`);

    const book = await Book.findByIdAndDelete(bookId);
    if (!book) return res.status(404).json({ error: 'Book not found' });

    await Chapter.deleteMany({ bookId: bookId });
    res.json({ message: 'Book deleted successfully' });
  } catch (error) {
    console.error(`💥 删除出错:`, error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/books/:id/views', async (req, res) => {
  try {
    await Book.findByIdAndUpdate(req.params.id, { 
        $inc: { views: 1, daily_views: 1, weekly_views: 1, monthly_views: 1 } 
    });
    res.json({ success: true });
  } catch (error) {
    res.json({ success: false }); 
  }
});

// --- Chapters ---
app.get('/api/books/:bookId/chapters', async (req, res) => {
  try {
    const { bookId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(bookId)) return res.status(400).json({ error: 'Invalid book ID' });
    
    const chapters = await Chapter.find({ bookId: new mongoose.Types.ObjectId(bookId) })
      .select('title chapter_number published_at bookId word_count')
      .sort({ chapter_number: 1 })
      .lean();
    
    const formattedChapters = chapters.map(c => ({
      ...c, 
      id: c._id.toString(), 
      bookId: c.bookId ? c.bookId.toString() : bookId 
    }));
    res.json(formattedChapters);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/chapters/:id', async (req, res) => {
  try {
    // 🔥🔥 防盗链逻辑 (已修复: 增加了你的新域名) 🔥🔥
    const referer = req.headers.referer || '';
    // 这里非常关键！如果不加 jiutianxiaoshuo.com，章节内容会报 403 Forbidden
    const ALLOWED_DOMAINS = ['localhost', 'jiutianxiaoshuo.com']; 
    
    // 只有当 referer 存在且不包含白名单时才拦截 (方便你用 Postman 调试)
    if (referer && !ALLOWED_DOMAINS.some(domain => referer.includes(domain))) {
       console.log('🚫 章节防盗链拦截:', referer);
       return res.status(403).json({ error: 'Forbidden' });
    }

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
          word_count: content.trim().length, 
          chapter_number: parseInt(finalChapterNum),
      });

      await newChapter.save();
      res.status(201).json({ ...newChapter.toObject(), id: newChapter._id.toString() });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
});

app.patch('/api/chapters/:id', async (req, res) => {
  try {
    const { title, content, chapter_number } = req.body;
    const updateData = { title, content, word_count: content ? content.length : 0 };
    if (chapter_number) updateData.chapter_number = chapter_number;

    const updatedChapter = await Chapter.findByIdAndUpdate(req.params.id, updateData, { new: true });
    if (!updatedChapter) return res.status(404).json({ error: 'Chapter not found' });

    res.json({ ...updatedChapter.toObject(), id: updatedChapter._id.toString() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/chapters/:id', async (req, res) => {
  try {
    const result = await Chapter.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ error: 'Chapter not found' });
    res.json({ message: 'Chapter deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Bookmarks ---
app.get('/api/users/:userId/bookmarks', async (req, res) => {
  try {
    const bookmarks = await Bookmark.find({ user_id: req.params.userId }).populate('bookId');
    res.json(bookmarks);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/users/:userId/bookmarks/:bookId/check', async (req, res) => {
  try {
    const bookId = mongoose.Types.ObjectId.isValid(req.params.bookId) 
      ? new mongoose.Types.ObjectId(req.params.bookId)
      : req.params.bookId;
    const count = await Bookmark.countDocuments({ user_id: req.params.userId, bookId });
    res.json({ isBookmarked: count > 0 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/users/:userId/bookmarks', async (req, res) => {
  try {
    const { bookId } = req.body;
    if (!bookId) return res.status(400).json({ error: 'bookId is required' });

    const userId = req.params.userId;
    const targetBookId = mongoose.Types.ObjectId.isValid(bookId) 
      ? new mongoose.Types.ObjectId(bookId) : bookId;

    const existing = await Bookmark.findOne({ user_id: userId, bookId: targetBookId });
    if (existing) return res.json(existing);

    const bookmark = new Bookmark({ user_id: userId, bookId: targetBookId });
    await bookmark.save();
    res.json(bookmark);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/users/:userId/bookmarks/:bookId', async (req, res) => {
  try {
    const { userId, bookId } = req.params;
    const targetBookId = mongoose.Types.ObjectId.isValid(bookId) 
      ? new mongoose.Types.ObjectId(bookId) : bookId;

    const result = await Bookmark.findOneAndDelete({ user_id: userId, bookId: targetBookId });
    if (!result) return res.status(404).json({ error: 'Bookmark not found' });

    res.json({ success: true, message: 'Removed from bookshelf' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ================= 6. 定时任务 =================
// ================= 6. 定时任务 (已修复：增加防崩溃保护) =================

// 1. 日榜重置 (每天 00:00)
cron.schedule('0 0 * * *', async () => {
    console.log('⏰ [Cron] 开始执行日榜重置...');
    try {
        await Book.updateMany({}, { daily_views: 0 });
        console.log('✅ [Cron] 日榜重置成功');
    } catch (error) {
        console.error('❌ [Cron] 日榜重置失败 (服务器未崩溃):', error.message);
    }
});

// 2. 周榜重置 (每周四 23:00)
cron.schedule('0 23 * * 4', async () => {
    console.log('⏰ [Cron] 开始执行周榜重置 (周四晚)...');
    try {
        await Book.updateMany({}, { weekly_views: 0 });
        console.log('✅ [Cron] 周榜重置成功');
    } catch (error) {
        console.error('❌ [Cron] 周榜重置失败 (服务器未崩溃):', error.message);
    }
});

// 3. 月榜重置 (每月 1号 00:00)
cron.schedule('0 0 1 * *', async () => {
    console.log('⏰ [Cron] 开始执行月榜重置...');
    try {
        await Book.updateMany({}, { monthly_views: 0 });
        console.log('✅ [Cron] 月榜重置成功');
    } catch (error) {
        console.error('❌ [Cron] 月榜重置失败 (服务器未崩溃):', error.message);
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});