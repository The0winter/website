// server/index.js
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import { createReview, getReviews } from './controllers/reviewController.js';
import cron from 'node-cron';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

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
app.use(express.json({ limit: '5mb' })); 
app.use(express.urlencoded({ limit: '5mb', extended: true }));
app.use(helmet());

//  全局限流 (防止普通爬虫刷崩服务器)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟窗口
  max: 500, // 每个 IP 允许 500 次请求 (根据你的访问量调整)
  message: '请求过于频繁，请稍后再试'
});
app.use('/api/', globalLimiter);

//4. 针对注册/登录接口的严格限流 (防止暴力破解)
const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1小时
  max: 10, // 每个 IP 只能尝试 10 次注册/登录
  message: '尝试次数过多，请一小时后再试'
});
app.use('/api/auth/', authLimiter);

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
const generateRandomPassword = () => {
  return Math.random().toString(36).slice(-8);
};


async function ensureAuthorExists(authorName) {
    if (!authorName || authorName === '未知') return null;
    try {
        let user = await User.findOne({ username: authorName });
        if (user) return user;

        // 1. 生成随机密码并加密
        const randomPassword = generateRandomPassword();
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(randomPassword, salt);

        console.log(`🆕 上传检测到新作者，正在创建账号: ${authorName}`);
        console.log(`🔑 自动生成的密码: ${randomPassword}`); 

        const timestamp = Date.now();
        const randomNum = Math.floor(Math.random() * 1000);
        
        // 2. 创建用户 (只需要这一段！不需要手动生成 _id，Mongoose 会自动处理)
        user = await User.create({
            username: authorName,
            email: `author_${timestamp}_${randomNum}@auto.generated`,
            password: hashedPassword, // ✅ 必须存密文
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

const adminMiddleware = async (req, res, next) => {
    try {
        // req.user.id 是从 authMiddleware 解析出来的（也就是你当前的 ID）
        const user = await User.findById(req.user.id);
        
        // 如果找不到人，或者角色不是 admin，直接轰出去
        if (!user || user.role !== 'admin') {
            return res.status(403).json({ error: '🚫 权限不足：只有管理员可以使用影子登录' });
        }
        next(); // 是管理员，放行
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};
// ================= Admin API (上传接口) =================

// 获取所有用户列表 (仅管理员)
app.get('/api/admin/users', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        // 只查 id, username, email, role, created_at，不查密码
        const users = await User.find()
            .select('username email role created_at')
            .sort({ created_at: -1 })
            .limit(100); // 限制100个防止数据太大，你可以以后做分页
        res.json(users);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 🆕 新增：差异化同步检查接口 (接收清单，返回缺少的章节)
app.post('/api/admin/check-sync', async (req, res) => {
    try {
        const clientSecret = req.headers['x-admin-secret'];
        const mySecret = process.env.ADMIN_SECRET || 'wo_de_pa_chong_mi_ma_123';
        if (clientSecret !== mySecret) return res.status(403).json({ error: '🚫 密码错误' });

        const { title, simpleChapters } = req.body; // simpleChapters 只有 title 和 chapter_number
        console.log(`🔍 正在核对书籍同步状态: 《${title}》`);

        // 1. 找书
        const book = await Book.findOne({ title });
        
        // 2. 如果书都没创建，说明全是新的，直接告诉前端“全部上传”
        if (!book) {
            return res.json({ 
                needsFullUpload: true, 
                missingTitles: [] 
            });
        }

        // 3. 如果书存在，查出数据库里这本书所有章节的标题 (只查 title 字段，速度极快)
        // 使用 .select('title') 减少内存消耗
        const existingChapters = await Chapter.find({ bookId: book._id }).select('title').lean();
        
        // 转成 Set 集合，方便 O(1) 复杂度快速查找
        const existingTitlesSet = new Set(existingChapters.map(c => c.title));

        // 4. 对比清单，找出缺少的
        const missingTitles = simpleChapters
            .filter(c => !existingTitlesSet.has(c.title))
            .map(c => c.title);

        console.log(`📋 核对结果: 本地 ${simpleChapters.length} 章 vs 云端 ${existingTitlesSet.size} 章 -> 需上传 ${missingTitles.length} 章`);

        res.json({ 
            needsFullUpload: false, 
            missingTitles: missingTitles 
        });

    } catch (error) {
        console.error('核对出错:', error);
        res.status(500).json({ error: error.message });
    }
});

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
                description: '无',
                status: '连载',
                sourceUrl: bookData.sourceUrl,
                chapterCount: bookData.chapters.length,
                views: bookData.views || 0
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

    // 🔥 新增：加密用户输入的密码
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    const newId = new mongoose.Types.ObjectId(); 
    const newUser = new User({
      _id: newId,         
      //id: newId.toString(),
      email,
      password: hashedPassword,
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
    
    // 🔥 核心修改：使用 bcrypt.compare 进行比对
    // 它会自动把用户输入的明文 password 加密，然后和数据库里的密文 user.password 比对
    const isMatch = await bcrypt.compare(password, user.password);
    
    if (!isMatch) return res.status(401).json({ error: 'Invalid credentials' }); // 密码错误
    
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
    
    //const user = await User.findOne({ id: userId });
    const user = await User.findById(userId);
    if (!user) return res.json({ user: null, profile: null });
    
    const { password: _, ...userWithoutPassword } = user.toObject();
    res.json({ user: { id: user.id, email: user.email, username: user.username }, profile: userWithoutPassword });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/users/:userId/profile', async (req, res) => {
  try {
    //const user = await User.findOne({ id: req.params.userId });
    const user = await User.findById(req.params.userId);

    if (!user) return res.status(404).json({ error: 'User not found' });
    const { password, ...userWithoutPassword } = user.toObject();
    res.json(userWithoutPassword);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取某本书的评论 (公开)
app.get('/api/books/:id/reviews', getReviews);

// 发表评论 (需要登录)
// 注意：这里用到了你现有的 authMiddleware 
app.post('/api/books/:id/reviews', authMiddleware, createReview);

// ================= Books API =================

app.get('/api/books', async (req, res) => {
    try {
      const { orderBy = 'views', order = 'desc', limit, author_id } = req.query;
      const filter = {};
      if (author_id) filter.author_id = author_id;

      // 获取书籍 (lean() 可以提高查询速度)
      let books = await Book.find(filter).populate('author_id', 'username email id').lean();

      // 🔥 核心排序逻辑
      if (orderBy === 'composite') {
          // 1. 综合推荐算法：评分(60%) + 周热度(40%)
          books.sort((a, b) => {
              const scoreA = ((a.rating || 0) * 100 * 0.6) + ((a.weekly_views || 0) * 0.4);
              const scoreB = ((b.rating || 0) * 100 * 0.6) + ((b.weekly_views || 0) * 0.4);
              return scoreB - scoreA; // 降序
          });
      } else {
          // 2. 普通榜单排序 (周榜、月榜、日榜、更新榜)
          books.sort((a, b) => {
              const valA = a[orderBy] || 0;
              const valB = b[orderBy] || 0;
              
              // 如果是时间排序
              if (orderBy === 'updatedAt' || orderBy === 'createdAt') {
                  return new Date(order === 'asc' ? valA : valB) - new Date(order === 'asc' ? valB : valA);
              }
              // 如果是数字排序
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
    const userId = req.user.id;
    
    if (!title) return res.status(400).json({ error: 'Title is required' });
    
    //const user = await User.findOne({ id: userId });

    const user = await User.findById(userId);

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

// server/index.js (修改 DELETE 接口)

app.delete('/api/books/:id', async (req, res) => {
  try {
    const bookId = req.params.id;
    console.log(`🗑️ [删除调试] 收到请求，目标ID: ${bookId}`);

    // 1. 先尝试只查询，看看能不能找到
    const checkBook = await Book.findById(bookId);
    if (!checkBook) {
        console.log(`⚠️ [删除调试] 失败：数据库里根本找不到这本书！`);
        console.log(`   -> 请检查 Railway 环境变量 MONGO_URI 是否连对了数据库`);
        return res.status(404).json({ error: 'Book not found in DB' });
    }

    console.log(`✅ [删除调试] 找到了书: 《${checkBook.title}》，正在执行删除...`);

    // 2. 执行删除
    await Book.findByIdAndDelete(bookId);
    
    // 3. 顺手删掉章节，防止残留
    const deleteChapters = await Chapter.deleteMany({ bookId: bookId });
    console.log(`🧹 [删除调试] 关联章节已清理: ${deleteChapters.deletedCount} 章`);

    res.json({ message: 'Book deleted successfully' });
  } catch (error) {
    console.error(`💥 [删除调试] 报错:`, error);
    res.status(500).json({ error: error.message });
  }
});

// 修改后的阅读量接口：同时增加 4 个计数器
app.post('/api/books/:id/views', async (req, res) => {
  try {
    await Book.findByIdAndUpdate(req.params.id, { 
        $inc: { 
            views: 1, 
            daily_views: 1, 
            weekly_views: 1, 
            monthly_views: 1 
        } 
    });
    res.json({ success: true });
  } catch (error) {
    console.error('Update views error:', error);
    res.json({ success: false }); 
  }
});

// 新增：专门检查某本书是否被某用户收藏
app.get('/api/users/:userId/bookmarks/:bookId/check', async (req, res) => {
  try {
    const bookId = mongoose.Types.ObjectId.isValid(req.params.bookId) 
      ? new mongoose.Types.ObjectId(req.params.bookId)
      : req.params.bookId;

    // countDocuments 比 find 更快，只返回数量
    const count = await Bookmark.countDocuments({ 
      user_id: req.params.userId, 
      bookId: bookId 
    });

    // 返回 boolean
    res.json({ isBookmarked: count > 0 });
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
      .select('title chapter_number published_at bookId') // ❌ 千万别加 content
      .sort({ chapter_number: 1 })
      .lean();
    
    const formattedChapters = chapters.map(c => ({
      ...c, 
      id: c._id.toString(), 
      bookId: c.bookId ? c.bookId.toString() : bookId 
    }));
    res.json(formattedChapters);
  } catch (error) {
    console.error('获取目录失败:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/chapters/:id', async (req, res) => {
  try {

    // 🔥 简单的防盗链检查
  const referer = req.headers.referer || '';
  const allowedDomains = ['localhost', 'vercel.app', 'railway.app']; // 你的域名白名单
  // 如果 Referer 存在且不包含白名单域名，拒绝访问
  if (referer && !allowedDomains.some(domain => referer.includes(domain))) {
     // 可以返回假数据，或者直接 403

     return res.status(403).json({ error: 'Forbidden' });
  }

    // ✅ 这里直接 findById，默认会查出 content (正文)
    const chapter = await Chapter.findById(req.params.id).lean();
    
    if (!chapter) return res.status(404).json({ error: 'Chapter not found' });
    
    res.json({ 
        ...chapter, 
        id: chapter._id.toString(), 
        bookId: chapter.bookId.toString() 
    });
  } catch (error) {
    console.error('获取章节详情失败:', error);
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

app.delete('/api/chapters/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // 执行删除
    const result = await Chapter.findByIdAndDelete(id);

    if (!result) {
      return res.status(404).json({ error: 'Chapter not found' });
    }

    res.json({ message: 'Chapter deleted successfully' });
  } catch (error) {
    console.error('删除章节失败:', error);
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

    const userId = req.params.userId;
    // 统一转成 ObjectId 格式，防止字符串匹配问题
    const targetBookId = mongoose.Types.ObjectId.isValid(bookId) 
      ? new mongoose.Types.ObjectId(bookId) 
      : bookId;

    // 🔥 关键修复步骤 1：先查是否存在！
    const existing = await Bookmark.findOne({ 
      user_id: userId, 
      bookId: targetBookId 
    });

    // 如果已经存在，直接返回这一条，不要创建新的！
    if (existing) {
      console.log('⚠️ 收藏已存在，跳过创建');
      return res.json(existing);
    }

    // 不存在才创建
    const bookmark = new Bookmark({
      user_id: userId,
      bookId: targetBookId,
    });
    
    await bookmark.save();
    res.json(bookmark);
  } catch (error) {
    console.error('Add bookmark error:', error);
    res.status(500).json({ error: error.message });
  }
});

// server/index.js (补充在 POST bookmarks 之后，PORT 之前)

app.delete('/api/users/:userId/bookmarks/:bookId', async (req, res) => {
  try {
    const { userId, bookId } = req.params;

    // 统一转成 ObjectId，防止因格式问题删不掉
    const targetBookId = mongoose.Types.ObjectId.isValid(bookId) 
      ? new mongoose.Types.ObjectId(bookId)
      : bookId;

    const result = await Bookmark.findOneAndDelete({ 
      user_id: userId, 
      bookId: targetBookId 
    });

    if (!result) {
      return res.status(404).json({ error: 'Bookmark not found' });
    }

    res.json({ success: true, message: 'Removed from bookshelf' });
  } catch (error) {
    console.error('Delete bookmark error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ================= 定时任务 (Cron Jobs) =================

// 1. 日榜重置：每天凌晨 00:00
cron.schedule('0 0 * * *', async () => {
    console.log('⏰ 执行日榜重置...');
    await Book.updateMany({}, { daily_views: 0 });
});

// 2. 周榜重置：每周四晚上 23:00 (星期四=4)
cron.schedule('0 23 * * 4', async () => {
    console.log('⏰ 执行周榜重置 (周四晚)...');
    await Book.updateMany({}, { weekly_views: 0 });
});

// 3. 月榜重置：每月 1 号凌晨 00:00
cron.schedule('0 0 1 * *', async () => {
    console.log('⏰ 执行月榜重置...');
    await Book.updateMany({}, { monthly_views: 0 });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});