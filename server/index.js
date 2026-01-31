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
app.use(express.json({ limit: '50mb' })); 
app.use(express.urlencoded({ limit: '50mb', extended: true }));
// ================= 数据库连接 =================
const MONGO_URL = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/novel-site';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'wo_de_pa_chong_mi_ma_123';

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
// server/index.js

app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, password, username, role } = req.body;
    
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ error: 'Email already exists' });

    // ✅ 修复点：生成一个 ObjectId，同时赋值给 _id 和 id
    const newId = new mongoose.Types.ObjectId(); 
    
    const newUser = new User({
      _id: newId,            // 1. 强制 MongoDB 使用这个 ID
      id: newId.toString(),  // 2. 我们的字符串 ID 也用这个
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

app.post('/api/admin/upload-book', async (req, res) => {
    try {
        // --- 安全检查 ---
        const clientSecret = req.headers['x-admin-secret'];
        if (clientSecret !== ADMIN_SECRET) {
            return res.status(403).json({ error: '🚫 密码错误，禁止上传！' });
        }

        const bookData = req.body; // 从 HTTP 请求体里拿数据
        console.log(`📥 收到上传请求: 《${bookData.title}》`);

        // --- 1. 处理作者 (User) ---
        let authorId = null;
        if (bookData.author && bookData.author !== '未知') {
            let user = await User.findOne({ username: bookData.author });
            if (!user) {
                // 简单创建作者
                user = await User.create({
                    username: bookData.author,
                    email: `author_${Date.now()}_${Math.floor(Math.random()*1000)}@auto.com`,
                    password: '123456', // 默认密码
                    role: 'writer'
                });
            }
            authorId = user._id;
        }

        // --- 2. 处理书籍 (Book) ---
        let book = await Book.findOne({ title: bookData.title });
        if (!book) {
            book = await Book.create({
                title: bookData.title,
                bookId: 'auto_' + Date.now(),
                author: bookData.author,
                author_id: authorId,
                description: '离线爬虫上传',
                status: '连载',
                sourceUrl: bookData.sourceUrl,
                chapterCount: bookData.chapters.length
            });
            console.log(`📚 新书创建: ${book.title}`);
        } else {
            // 更新现有书
            book.chapterCount = Math.max(book.chapterCount, bookData.chapters.length);
            if (!book.sourceUrl) book.sourceUrl = bookData.sourceUrl;
            await book.save();
            console.log(`🔄 更新书籍: ${book.title}`);
        }

        // --- 3. 处理章节 (Chapter) ---
        // 批量写入比循环写入快得多
        const chaptersToInsert = [];
        for (const chap of bookData.chapters) {
            // 检查章节是否存在 (为了性能，这里可以优化，但先保持简单)
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

        console.log(`✅ 《${book.title}》处理完毕，新增 ${chaptersToInsert.length} 章`);
        
        res.json({ 
            success: true, 
            message: `上传成功！书籍：${book.title}，新增章节：${chaptersToInsert.length}` 
        });

    } catch (error) {
        console.error('💥 上传接口报错:', error);
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

// server/index.js

app.get('/api/books', async (req, res) => {
    try {
      // 1. ✅ 新增 author_id 参数
      const { orderBy = 'views', order = 'desc', limit, author_id } = req.query;
      
      // 2. ✅ 构建过滤条件
      const filter = {};
      if (author_id) {
          filter.author_id = author_id;
      }

      // 3. ✅ 把 filter 传给 find()
      let query = Book.find(filter).populate('author_id', 'username email id');
      
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

// ================= ✂️ 从这里开始粘贴新代码 ✂️ =================

// 1. 定义辅助函数：帮我们在 Users 集合里找作者，找不到就创建
async function ensureAuthorExists(authorName) {
    // 过滤无效名字
    if (!authorName || authorName === '未知') return null;

    try {
        // 先去数据库查
        let user = await User.findOne({ username: authorName });
        if (user) return user;

        // 没查到，说明是新作者，创建一个
        console.log(`🆕 上传检测到新作者，正在创建账号: ${authorName}`);
        
        const timestamp = Date.now();
        const randomNum = Math.floor(Math.random() * 1000);
        
        // 这里的逻辑和 scraperService.js 里一模一样，确保数据结构一致
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

// 2. 定义上传接口：这是 upload_to_railway.js 要敲的门
app.post('/api/admin/upload-book', async (req, res) => {
    try {
        // 简单的密码验证
        const clientSecret = req.headers['x-admin-secret'];
        const mySecret = process.env.ADMIN_SECRET || 'wo_de_pa_chong_mi_ma_123';
        
        if (clientSecret !== mySecret) {
            return res.status(403).json({ error: '🚫 密码错误' });
        }

        const bookData = req.body; // 拿到上传的大包裹
        console.log(`📥 开始接收: 《${bookData.title}》`);

        // --- 步骤 A: 处理作者 (放入 users 集合) ---
        let authorId = null;
        if (bookData.author) {
            const authorUser = await ensureAuthorExists(bookData.author);
            if (authorUser) {
                authorId = authorUser._id; // 拿到作者的身份证号
            }
        }

        // --- 步骤 B: 处理书籍 (放入 books 集合) ---
        let book = await Book.findOne({ title: bookData.title });
        if (!book) {
            book = await Book.create({
                title: bookData.title,
                bookId: 'auto_' + Date.now(),
                author: bookData.author,
                author_id: authorId, // 🔥 关键：把书和刚才找到的作者关联起来
                category: bookData.category || '搬运',
                description: '离线爬虫上传',
                status: '连载',
                sourceUrl: bookData.sourceUrl,
                chapterCount: bookData.chapters.length
            });
            console.log(`📚 新书入库: ${book.title}`);
        } else {
            // 如果书已经在库里，就更新一下作者关联
            if (!book.author_id && authorId) {
                book.author_id = authorId;
                await book.save();
            }
        }

        // --- 步骤 C: 处理章节 (放入 chapters 集合) ---
        const chaptersToInsert = [];
        for (const chap of bookData.chapters) {
            // 检查章节是否已存在 (避免重复)
            const exists = await Chapter.exists({ bookId: book._id, title: chap.title });
            if (!exists) {
                chaptersToInsert.push({
                    bookId: book._id, // 这一章属于刚才那本书
                    title: chap.title,
                    content: chap.content,
                    chapter_number: chap.chapter_number
                });
            }
        }

        // 批量一次性插入，速度极快
        if (chaptersToInsert.length > 0) {
            await Chapter.insertMany(chaptersToInsert);
        }

        res.json({ success: true, message: `成功入库！新增 ${chaptersToInsert.length} 章` });

    } catch (error) {
        console.error('上传出错:', error);
        res.status(500).json({ error: error.message });
    }
});

// ================= ✂️ 粘贴结束 ✂️ =================

// ================= 启动服务 ================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});