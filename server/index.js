import 'dotenv/config'; 
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import cron from 'node-cron';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import mongoSanitize from 'express-mongo-sanitize';

// 引入模型
import User from './models/User.js'; 
import Book from './models/Book.js';
import Chapter from './models/Chapter.js';
import Bookmark from './models/Bookmark.js';

import VerificationCode from './models/VerificationCode.js';
import sendVerificationEmail from './utils/sendEmail.js';

import upload from './utils/upload.js';
import { createReview, getReviews } from './controllers/reviewController.js';

const app = express();

app.set('trust proxy', 1);

// ================= 1. 安全与配置 (紧急修复版) =================

// 🚨 修复：加回默认值，防止因为缺环境变量导致网站打不开
const JWT_SECRET = process.env.JWT_SECRET || 'temp_emergency_secret_key_123456';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'temp_admin_secret_123';

// 如果不想用默认值，请确保 .env 文件里配置了这两个变量

const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5000',
  'https://jiutianxiaoshuo.com',
  'https://www.jiutianxiaoshuo.com'
];

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
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-secret'],
  credentials: true
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(helmet());
app.use(mongoSanitize());

// ⚠️ 全局限制改回 10mb，防止之前的 100kb 限制导致某些大请求报错
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// ================= 2. 限流配置 =================

const getClientIp = (req) => {
    return req.headers['cf-connecting-ip'] || req.ip;
};

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 500, 
  message: '请求过于频繁，请稍后再试',
  keyGenerator: getClientIp, 
  validate: { ip: false } 
});
app.use('/api/', globalLimiter);

const authLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, 
  max: 20, 
  message: '操作太频繁',
  keyGenerator: getClientIp,
  validate: { ip: false }
});
app.use('/api/auth/', authLimiter);

// ================= 3. 数据库连接 =================

const MONGO_URL = process.env.MONGO_URI;
if (!MONGO_URL) {
  console.error('❌ [严重警告] 未读到 MONGO_URI，请检查 .env 文件！');
} else {
  mongoose.connect(MONGO_URL)
    .then(() => {
        // 👇👇👇 改这里：打印出当前连的是哪个库 👇👇👇
        console.log(`✅ MongoDB 连接成功！当前数据库: [ ${mongoose.connection.name} ]`);
        console.log('💡 如果上面显示的不是 "data"，请去 .env 文件修改连接字符串！');
    })
    .catch(err => console.error('❌ MongoDB 连接失败:', err));
}

// ================= 4. 中间件 =================

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

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
      return res.status(401).json({ error: 'Access Denied: No Token Provided' });
  }

  try {
      const verified = jwt.verify(token, JWT_SECRET);
      req.user = verified; 
      next();
  } catch (err) {
      return res.status(403).json({ error: 'Invalid or Expired Token' });
  }
};

const adminMiddleware = async (req, res, next) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user || user.role !== 'admin') {
            return res.status(403).json({ error: '🚫 权限不足' });
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

// 影子登录 (Impersonate) - 🚨 紧急修复版：移除日志记录
app.post('/api/admin/impersonate/:userId', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const targetUser = await User.findById(req.params.userId);
        if (!targetUser) return res.status(404).json({ error: '找不到该用户' });

        // ⚠️ 暂时注释掉日志，防止报错
        /*
        try {
             await AdminLog.create({
                admin_id: req.user.id,
                target_user_id: targetUser._id,
                action: 'IMPERSONATE_LOGIN',
                ip_address: req.ip || req.headers['cf-connecting-ip'],
                details: `管理员 [${req.user.role}] 登录了用户 [${targetUser.username}]`
            });
        } catch (logErr) {
            console.error('日志写入失败，跳过:', logErr);
        }
        */

        console.log(`🕵️‍♂️ 管理员 [${req.user.id}] 影子登录 -> [${targetUser.username}]`);
        
        const token = jwt.sign(
            { id: targetUser._id, role: targetUser.role }, 
            JWT_SECRET, 
            { expiresIn: '1h' }
        );

        const { password: _, ...userWithoutPassword } = targetUser.toObject();
        res.json({ 
            token, 
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
        res.status(500).json({ error: error.message });
    }
});

// --- Auth API ---
app.post('/api/auth/signup', async (req, res) => {
  try {
    // ✅ 1. 多接收一个 code 参数
    const { email, password, username, role, code } = req.body;

    // ✅ 2. 校验验证码 (这是新增的核心逻辑)
    const validCode = await VerificationCode.findOne({ email, code });
    if (!validCode) {
      return res.status(400).json({ error: '验证码错误或已过期' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ error: '该邮箱已被注册' });

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    const newUser = await User.create({
      email,
      password: hashedPassword,
      username,
      role: role || 'reader',
      loginAttempts: 0 
    });
    
    // ✅ 3. 注册成功后，删除验证码
    await VerificationCode.deleteOne({ _id: validCode._id });

    const token = jwt.sign(
        { id: newUser._id, role: newUser.role }, 
        JWT_SECRET, // 注意：确保这里能访问到 JWT_SECRET 变量
        { expiresIn: '7d' }
    );

    const { password: _, ...userWithoutPassword } = newUser.toObject();
    res.json({ 
        token,
        user: { id: newUser._id.toString(), email, username: newUser.username }, 
        profile: userWithoutPassword 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 🚨 登录接口：包含数据修复逻辑
app.post('/api/auth/signin', async (req, res) => {
  try {
    const { email, username, password } = req.body;
    const identifier = (email || username || '').trim();
    if (!identifier || !password) return res.status(400).json({ error: '请输入账号和密码' });
    
    const user = await User.findOne({ 
      $or: [{ email: identifier }, { username: identifier }]
    });

    if (!user) return res.status(401).json({ error: '账号或密码错误' });

    // 修复1：防止 isLocked 报错 (兼容 Schema 未更新的情况)
    if (user.lockUntil && user.lockUntil > Date.now()) {
        const lockTime = user.lockUntil;
        // 计算剩余秒数
        const secondsLeft = Math.ceil((lockTime - Date.now()) / 1000);
        
        if (secondsLeft > 0) {
            const minutes = Math.ceil(secondsLeft / 60);
            return res.status(403).json({ error: `账号已锁定，请 ${minutes} 分钟后再试` });
        } else {
            // 如果锁定时间已过，重置状态（这一步其实你下面的代码也写了，这里可以为了保险加上）
            user.loginAttempts = 0;
            user.lockUntil = undefined;
            await user.save();
        }
    }

 const isMatch = await bcrypt.compare(password, user.password);
    
    if (!isMatch) {
        // --- 调试代码开始 ---
        console.log(`❌ [调试] 密码错误。当前数据库记录次数: ${user.loginAttempts}`);
        // ------------------

        const currentAttempts = user.loginAttempts || 0;
        user.loginAttempts = currentAttempts + 1;
        
        // --- 调试代码 ---
        console.log(`📉 [调试] 准备更新为: ${user.loginAttempts}`);
        // ----------------
        
        if (user.loginAttempts >= 5) {
            user.lockUntil = Date.now() + (60 * 60 * 1000); 
            await user.save();
            console.log('🔒 [调试] 已触发锁定！'); // 看看这行会不会打印
            return res.status(403).json({ error: '密码错误次数过多，账号已锁定 1 小时' });
        }

        await user.save();
        console.log('💾 [调试] 已保存错误次数'); 
        
        return res.status(401).json({ 
            error: `密码错误，还剩 ${5 - user.loginAttempts} 次机会` 
        });
    }
    // ... 后面的代码 ...

    // 修复3：登录成功也做兼容检查
    if ((user.loginAttempts && user.loginAttempts > 0) || user.lockUntil) {
        user.loginAttempts = 0;
        user.lockUntil = undefined;
        await user.save();
    }
    
    const token = jwt.sign(
        { id: user._id, role: user.role }, 
        JWT_SECRET, 
        { expiresIn: '7d' }
    );

    const userObj = user.toObject();
    delete userObj.password;
    delete userObj.loginAttempts;
    delete userObj.lockUntil;

    res.json({ 
      token, 
      user: { id: user._id.toString(), email: user.email, username: user.username, role: user.role }, 
      profile: userObj 
    });

  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({ error: '登录异常' });
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
    res.status(500).json({ error: error.message });
  }
});

// ✅ 新增：发送验证码接口
app.post('/api/auth/send-code', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: "请填写邮箱" });

  // 生成6位随机数
  const code = Math.floor(100000 + Math.random() * 900000).toString();

  try {
    // 删除旧验证码，防止重复
    await VerificationCode.deleteMany({ email });
    
    // 保存新验证码
    await new VerificationCode({ email, code }).save();

    // 发送邮件
    await sendVerificationEmail(email, code);
    res.json({ message: "验证码已发送" });
  } catch (error) {
    console.error("邮件发送错误:", error);
    res.status(500).json({ message: "邮件发送失败" });
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

// 上传图片
app.post('/api/upload/cover', 
    express.json({ limit: '10mb' }),
    authMiddleware, 
    upload.single('file'), 
    (req, res) => {
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
    const book = await Book.findByIdAndDelete(bookId);
    if (!book) return res.status(404).json({ error: 'Book not found' });
    await Chapter.deleteMany({ bookId: bookId });
    res.json({ message: 'Book deleted successfully' });
  } catch (error) {
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
    const referer = req.headers.referer || '';
    const ALLOWED_DOMAINS = ['localhost', 'jiutianxiaoshuo.com']; 
    if (referer && !ALLOWED_DOMAINS.some(domain => referer.includes(domain))) {
       // console.log('🚫 章节防盗链拦截:', referer);
       // 暂时放宽防盗链，避免前端调试问题
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

cron.schedule('0 0 * * *', async () => {
    try {
        await Book.updateMany({}, { daily_views: 0 });
        console.log('✅ [Cron] 日榜重置成功');
    } catch (error) {
        console.error('❌ [Cron] 日榜重置失败:', error.message);
    }
});

cron.schedule('0 23 * * 4', async () => {
    try {
        await Book.updateMany({}, { weekly_views: 0 });
        console.log('✅ [Cron] 周榜重置成功');
    } catch (error) {
        console.error('❌ [Cron] 周榜重置失败:', error.message);
    }
});

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