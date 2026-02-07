import 'dotenv/config'; 
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import cron from 'node-cron';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import jwt from 'jsonwebtoken'; // 🆕 新增：JWT 用于生成 Token
import mongoSanitize from 'express-mongo-sanitize'; // 🆕 新增：防止 NoSQL 注入

// 引入模型
import User from './models/User.js'; 
import Book from './models/Book.js';
import Chapter from './models/Chapter.js';
import Bookmark from './models/Bookmark.js';
import AdminLog from './models/AdminLog.js';

import upload from './utils/upload.js';
import { createReview, getReviews } from './controllers/reviewController.js';

const app = express();

// ✅ Cloudflare 关键配置：信任第一个代理（Cloudflare）
app.set('trust proxy', 1);

// ================= 1. 安全与配置 =================

// 🔑 JWT 密钥 (如果没有配置环境变量，会使用随机备用，但重启后用户需重新登录)
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error("❌ 致命错误：未配置 JWT_SECRET 环境变量！");
}

const ALLOWED_ORIGINS = process.env.NODE_ENV === 'production' 
  ? ['https://jiutianxiaoshuo.com', 'https://www.jiutianxiaoshuo.com']
  : ['http://localhost:3000', 'http://localhost:5000'];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    const isAllowed = ALLOWED_ORIGINS.some(allowed => origin.includes(allowed));
    if (isAllowed) {
      return callback(null, true);
    } else {
      console.log('🚫 CORS 拦截:', origin);
      return callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-secret'], // ❌ 移除了 x-user-id
  credentials: true
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(helmet());

// 🛡️ 新增：防止 MongoDB 查询注入 (例如 { "$ne": null })
app.use(mongoSanitize());

// 1. 全局只给 100kb (足够登录和普通操作)
app.use(express.json({ limit: '100kb' })); 

// 2. 只有上传书籍/图片的接口单独放开限制
// 例如在上传封面的路由里：
app.post('/api/upload/cover', 
  express.json({ limit: '10mb' }), // ✅ 1. 局部允许大请求体
  authMiddleware,                  // ✅ 2. 验证登录
  upload.single('file'),           // ✅ 3. 处理文件流
  (req, res) => {                  // ✅ 4. 这里的花括号里是具体的业务逻辑
    try {
      if (!req.file) return res.status(400).json({ error: '没有上传文件' });
      // 返回文件路径给前端
      res.json({ url: req.file.path });
    } catch (error) {
      res.status(500).json({ error: '上传失败: ' + error.message });
    }
  }
);

// ================= 2. 限流配置 (Cloudflare 修正版) =================

// 帮助函数：获取真实 IP (穿透 Cloudflare)
const getClientIp = (req) => {
    return req.headers['cf-connecting-ip'] || req.ip;
};

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 500, 
  message: '请求过于频繁，请稍后再试',
  keyGenerator: getClientIp, // ✅ 修复：使用 CF 真实 IP，防止误杀全网
  standardHeaders: true,
  legacyHeaders: false,
  validate: { ip: false },
});
app.use('/api/', globalLimiter);

const authLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, 
  max: 20, // 🔒 收紧：登录接口不需要那么高的并发，防止爆破
  message: '操作太频繁',
  keyGenerator: getClientIp,
  validate: { ip: false },
});
app.use('/api/auth/', authLimiter);

// ================= 3. 数据库连接 =================

const MONGO_URL = process.env.MONGO_URI;
if (!MONGO_URL) {
  console.error('❌ 严重错误: 未配置 MONGO_URI 环境变量！');
  process.exit(1);
}

mongoose.connect(MONGO_URL)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

const ADMIN_SECRET = process.env.ADMIN_SECRET;
if (!ADMIN_SECRET) {
    throw new Error("❌ 致命错误：未配置 ADMIN_SECRET 环境变量！");
}

const isProduction = process.env.NODE_ENV === 'production';

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

// 🔥🔥 核心修复：基于 JWT 的身份验证中间件 🔥🔥
const authMiddleware = (req, res, next) => {
  // 1. 尝试从 Authorization Header 获取 Token
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // 格式: "Bearer <token>"

  if (!token) {
      return res.status(401).json({ error: 'Access Denied: No Token Provided' });
  }

  try {
      // 2. 验证 Token
      const verified = jwt.verify(token, JWT_SECRET);
      // 3. 将用户信息挂载到 req.user (包含 id 和 role)
      req.user = verified; 
      next();
  } catch (err) {
      return res.status(403).json({ error: 'Invalid or Expired Token' });
  }
};

const adminMiddleware = async (req, res, next) => {
    try {
        // req.user.id 来自 authMiddleware 解析的 Token
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

// 影子登录 (Impersonate)
app.post('/api/admin/impersonate/:userId', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const targetUser = await User.findById(req.params.userId);
        if (!targetUser) return res.status(404).json({ error: '找不到该用户' });

        await AdminLog.create({
            admin_id: req.user.id,           // 操作者：当前管理员的 ID
            target_user_id: targetUser._id,  // 受害者/目标：被登录的用户 ID
            action: 'IMPERSONATE_LOGIN',     // 动作名称
            ip_address: req.ip || req.headers['cf-connecting-ip'], // 记录管理员的 IP
            details: `管理员 [${req.user.role}] 登录了用户 [${targetUser.username}]`
        });

        console.log(`🕵️‍♂️ [审计] 管理员 ${req.user.id} 影子登录 -> ${targetUser.username}`);

        console.log(`🕵️‍♂️ 管理员 [${req.user.id}] 影子登录 -> [${targetUser.username}]`);
        
        // 生成该用户的 Token 供管理员使用
        const token = jwt.sign(
            { id: targetUser._id, role: targetUser.role }, 
            JWT_SECRET, 
            { expiresIn: '1h' }
        );

        const { password: _, ...userWithoutPassword } = targetUser.toObject();
        res.json({ 
            token, // 返回 Token
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

// 爬虫同步接口 (保持使用 x-admin-secret 验证)
app.post('/api/admin/check-sync', async (req, res) => {
    try {
        const clientSecret = req.headers['x-admin-secret'];
        if (clientSecret !== ADMIN_SECRET) return res.status(403).json({ error: '🚫 密码错误' });

        const { title, simpleChapters } = req.body;
        const book = await Book.findOne({ title });
        if (!book) return res.json({ needsFullUpload: true, missingTitles: [] });

        const existingChapters = await Chapter.find({ bookId: book._id }).select('title').lean();
        const existingTitlesSet = new Set(existingChapters.map(c => c.title));
        
        const missingTitles = simpleChapters
            .filter(c => !existingTitlesSet.has(c.title))
            .map(c => c.title);

        res.json({ needsFullUpload: false, missingTitles });
    } catch (error) {
        res.status(500).json({ 
    error: isProduction ? '服务器内部错误，请稍后重试' : error.message 
});
    }
});

app.post('/api/admin/upload-book', async (req, res) => {
    try {
        const clientSecret = req.headers['x-admin-secret'];
        if (clientSecret !== ADMIN_SECRET) return res.status(403).json({ error: '🚫 密码错误' });

        const bookData = req.body;
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
        res.status(500).json({ 
    error: isProduction ? '服务器内部错误，请稍后重试' : error.message 
});
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
    
    // ✅ 生成 Token
    const token = jwt.sign(
        { id: newUser._id, role: newUser.role }, 
        JWT_SECRET, 
        { expiresIn: '7d' }
    );

    const { password: _, ...userWithoutPassword } = newUser.toObject();
    // ✅ 返回 Token 给前端
    res.json({ 
        token,
        user: { id: newUser._id.toString(), email, username: newUser.username }, 
        profile: userWithoutPassword 
    });
  } catch (error) {
    res.status(500).json({ 
    error: isProduction ? '服务器内部错误，请稍后重试' : error.message 
});
  }
});

// 常量定义：最大尝试次数 和 锁定时间
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_TIME = 60 * 60 * 1000; // 1 小时 (毫秒)

app.post('/api/auth/signin', async (req, res) => {
  try {
    const { email, username, password } = req.body;
    const identifier = email || username;
    if (!identifier || !password) return res.status(400).json({ error: '请输入账号和密码' });
    
    // 1. 查找用户
    const user = await User.findOne({ 
      $or: [{ email: identifier }, { username: identifier }]
    });

    if (!user) return res.status(401).json({ error: '账号或密码错误' }); // 模糊报错，防止枚举账号

    // 2. 🛑 检查账号是否被锁定
    if (user.isLocked) {
        // 计算还需要等多久
        const secondsLeft = Math.ceil((user.lockUntil - Date.now()) / 1000);
        // 如果时间到了，自动解锁（把 lockUntil 和 loginAttempts 重置）
        if (secondsLeft <= 0) {
            user.loginAttempts = 0;
            user.lockUntil = undefined;
            await user.save();
        } else {
            // 如果还在锁定期，直接拒绝
            const minutes = Math.ceil(secondsLeft / 60);
            return res.status(403).json({ 
                error: `账号已锁定，请 ${minutes} 分钟后再试` 
            });
        }
    }

    // 3. 验证密码
    const isMatch = await bcrypt.compare(password, user.password);
    
    if (!isMatch) {
        // ❌ 密码错误逻辑：增加错误次数
        user.loginAttempts += 1;
        
        // 检查是否达到上限
        if (user.loginAttempts >= MAX_LOGIN_ATTEMPTS) {
            user.lockUntil = Date.now() + LOCK_TIME; // 设定锁定截止时间
            await user.save();
            return res.status(403).json({ error: '密码错误次数过多，账号已锁定 1 小时' });
        }

        await user.save();
        return res.status(401).json({ 
            error: `密码错误，还剩 ${MAX_LOGIN_ATTEMPTS - user.loginAttempts} 次机会` 
        });
    }

    // ✅ 4. 登录成功逻辑：重置计数器
    if (user.loginAttempts > 0 || user.lockUntil) {
        user.loginAttempts = 0;
        user.lockUntil = undefined;
        await user.save();
    }
    
    // ... 下面是原有的生成 Token 代码，保持不变 ...
    const token = jwt.sign(
        { id: user._id, role: user.role }, 
        JWT_SECRET, 
        { expiresIn: '7d' }
    );

    const { password: _, loginAttempts, lockUntil, ...userWithoutPassword } = user.toObject();
    
    res.json({ 
      token, 
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
    res.status(500).json({ 
    error: isProduction ? '服务器内部错误，请稍后重试' : error.message 
});
  }
});

// 获取当前会话 (Session)
app.get('/api/auth/session', async (req, res) => {
  try {
    // 兼容：如果前端发了 Header 里的 Authorization
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.json({ user: null, profile: null });

    const token = authHeader.split(' ')[1];
    if (!token) return res.json({ user: null, profile: null });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.id);
        if (!user) return res.json({ user: null, profile: null });

        const { password: _, ...userWithoutPassword } = user.toObject();
        res.json({ 
            user: { id: user._id.toString(), email: user.email, username: user.username, role: user.role }, 
            profile: userWithoutPassword 
        });
    } catch (e) {
        return res.json({ user: null, profile: null });
    }
  } catch (error) {
    res.status(500).json({ 
    error: isProduction ? '服务器内部错误，请稍后重试' : error.message 
});
  }
});

app.get('/api/users/:userId/profile', async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { password, ...userWithoutPassword } = user.toObject();
    res.json(userWithoutPassword);
  } catch (error) {
    res.status(500).json({ 
    error: isProduction ? '服务器内部错误，请稍后重试' : error.message 
});
  }
});

// --- Reviews ---
app.get('/api/books/:id/reviews', getReviews);
app.post('/api/books/:id/reviews', authMiddleware, createReview);

// 上传图片
app.post('/api/upload/cover', authMiddleware, upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '没有上传文件' });
    res.json({ url: req.file.path });
  } catch (error) {
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
      const formattedBooks = books.map(book => ({ ...book, id: book._id.toString() }));
      res.json(formattedBooks);
    } catch (error) {
      res.status(500).json({ 
    error: isProduction ? '服务器内部错误，请稍后重试' : error.message 
});
    }
});

app.get('/api/books/:id', async (req, res) => {
    try {
      const book = await Book.findById(req.params.id).populate('author_id', 'username email id');
      if (!book) return res.status(404).json({ error: 'Book not found' });
      res.json({ ...book.toObject(), id: book._id.toString() });
    } catch (error) {
      res.status(500).json({ 
    error: isProduction ? '服务器内部错误，请稍后重试' : error.message 
});
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
    res.status(500).json({ 
    error: isProduction ? '服务器内部错误，请稍后重试' : error.message 
});
  }
});

app.patch('/api/books/:id', async (req, res) => {
  // 注意：此处理论上应该增加 adminMiddleware 或检查 owner，暂时保持功能不变
  try {
    const book = await Book.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!book) return res.status(404).json({ error: 'Book not found' });
    res.json(book);
  } catch (error) {
    res.status(500).json({ 
    error: isProduction ? '服务器内部错误，请稍后重试' : error.message 
});
  }
});

app.delete('/api/books/:id', async (req, res) => {
  try {
    // 注意：建议未来这里加上 authMiddleware
    const bookId = req.params.id;
    const book = await Book.findByIdAndDelete(bookId);
    if (!book) return res.status(404).json({ error: 'Book not found' });

    await Chapter.deleteMany({ bookId: bookId });
    res.json({ message: 'Book deleted successfully' });
  } catch (error) {
    res.status(500).json({ 
    error: isProduction ? '服务器内部错误，请稍后重试' : error.message 
});
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
    res.status(500).json({ 
    error: isProduction ? '服务器内部错误，请稍后重试' : error.message 
});
  }
});

app.get('/api/chapters/:id', async (req, res) => {
  try {
    const referer = req.headers.referer || '';
    const ALLOWED_DOMAINS = ['localhost', 'jiutianxiaoshuo.com']; 
    if (referer && !ALLOWED_DOMAINS.some(domain => referer.includes(domain))) {
       console.log('🚫 章节防盗链拦截:', referer);
       return res.status(403).json({ error: 'Forbidden' });
    }

    const chapter = await Chapter.findById(req.params.id).lean();
    if (!chapter) return res.status(404).json({ error: 'Chapter not found' });
    
    res.json({ ...chapter, id: chapter._id.toString(), bookId: chapter.bookId.toString() });
  } catch (error) {
    res.status(500).json({ 
    error: isProduction ? '服务器内部错误，请稍后重试' : error.message 
});
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
      res.status(500).json({ 
    error: isProduction ? '服务器内部错误，请稍后重试' : error.message 
});
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
    res.status(500).json({ 
    error: isProduction ? '服务器内部错误，请稍后重试' : error.message 
});
  }
});

app.delete('/api/chapters/:id', async (req, res) => {
  try {
    const result = await Chapter.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ error: 'Chapter not found' });
    res.json({ message: 'Chapter deleted successfully' });
  } catch (error) {
    res.status(500).json({ 
    error: isProduction ? '服务器内部错误，请稍后重试' : error.message 
});
  }
});

// --- Bookmarks ---
app.get('/api/users/:userId/bookmarks', async (req, res) => {
  try {
    const bookmarks = await Bookmark.find({ user_id: req.params.userId }).populate('bookId');
    res.json(bookmarks);
  } catch (error) {
    res.status(500).json({ 
    error: isProduction ? '服务器内部错误，请稍后重试' : error.message 
});
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
    res.status(500).json({ 
    error: isProduction ? '服务器内部错误，请稍后重试' : error.message 
});
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
    res.status(500).json({ 
    error: isProduction ? '服务器内部错误，请稍后重试' : error.message 
});
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
    res.status(500).json({ 
    error: isProduction ? '服务器内部错误，请稍后重试' : error.message 
});
  }
});

// ================= 6. 定时任务 =================

// 1. 日榜重置
cron.schedule('0 0 * * *', async () => {
    try {
        await Book.updateMany({}, { daily_views: 0 });
        console.log('✅ [Cron] 日榜重置成功');
    } catch (error) {
        console.error('❌ [Cron] 日榜重置失败:', error.message);
    }
});

// 2. 周榜重置 (周四晚)
cron.schedule('0 23 * * 4', async () => {
    try {
        await Book.updateMany({}, { weekly_views: 0 });
        console.log('✅ [Cron] 周榜重置成功');
    } catch (error) {
        console.error('❌ [Cron] 周榜重置失败:', error.message);
    }
});

// 3. 月榜重置
cron.schedule('0 0 1 * *', async () => {
    try {
        await Book.updateMany({}, { monthly_views: 0 });
        console.log('✅ [Cron] 月榜重置成功');
    } catch (error) {
        console.error('❌ [Cron] 月榜重置失败:', error.message);
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});