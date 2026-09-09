import { forumWrites } from './routes/forum-writes.js';
import {pagination} from './services/pagination.js';
import {createRequestMetrics,allowMetrics} from './services/observability.js';
import { readingRoutes } from './routes/reading.js';
import { importRoutes } from './routes/import.js';
import { contentRoutes } from './routes/content.js';
import { draftRoutes } from './routes/drafts.js';
import { forumViewRoutes } from './routes/forum-views.js';
import { mediaRoutes } from './routes/media.js';
import { security, safeHtml, publicUser } from './security.js';
import { authRoutes } from './routes/auth.js';
import Session from './models/Session.js';
﻿import { readConfig } from './config.js'; 
import express from 'express';
import mongoose from 'mongoose';
import crypto from 'crypto';
import cors from 'cors';

import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import mongoSanitize from 'express-mongo-sanitize';


// 引入模型
import User from './models/User.js'; 
import Book from './models/Book.js';
import Chapter from './models/Chapter.js';
import ForumPost from './models/ForumPost.js';  
import ForumReply from './models/ForumReply.js';
import ForumReplyComment from './models/ForumReplyComment.js';



import { getReviews } from './controllers/reviewController.js';

export function createApp(config = readConfig()) {
const app = express();
const metrics = createRequestMetrics();
app.use((req,res,next)=>{ res.once('finish',()=>{if(!req.path.startsWith('/health/'))metrics.record(res.statusCode);});next(); });
app.param(['id','bookId','userId'],(req,res,next,value)=>/^[a-fA-F0-9]{24}$/.test(value)?next():res.status(400).json({error:'资源ID无效'}));
app.use((req,res,next)=>{
  req.requestId=crypto.randomUUID();res.set('X-Request-Id',req.requestId);
  const start=performance.now();res.once('finish',()=>{if(config.mode==='production'||process.env.LOG_REQUESTS==='enabled')console.log(JSON.stringify({requestId:req.requestId,method:req.method,route:req.route?.path||'unmatched',status:res.statusCode,durationMs:Math.round(performance.now()-start)}));});next();
});
app.set('trust proxy', config.trustProxy==='loopback'?'loopback':false);



// ================= 1. 安全与配置 (紧急修复版) =================

// 🚨 修复：加回默认值，防止因为缺环境变量导致网站打不开


// 👇 1. 新增：恶意乱码 URL 拦截器
app.use((req, res, next) => {
    try {
        decodeURIComponent(req.path);
        next();
    } catch (err) {
        console.warn('Malformed request URL', {requestId:req.requestId});
        return res.status(400).send('Bad Request');
    }
});


const ALLOWED_ORIGINS = config.origins;

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    const isAllowed = ALLOWED_ORIGINS.includes(origin);
    if (isAllowed) {
      return callback(null, true);
    } else {
      console.warn('Origin rejected', {status:403});
      return callback(Object.assign(new Error('Not allowed by CORS'), {status:403}));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-csrf-token', 'Idempotency-Key'],
  credentials: true
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(helmet());
app.use((req,res,next) => {
  const json = res.json.bind(res);
  res.json = value => {
    if(res.statusCode >= 500) value={error:'服务暂不可用，请重试'};
    if (req.path.startsWith('/api/forum')) {
      res.set('Cache-Control','private, no-store');
      const clean = item => { if (Array.isArray(item)) return item.map(clean); if (item && typeof item === 'object' && !(item instanceof Date)) return Object.fromEntries(Object.entries(item).map(([k,v]) => [k,k === 'content' && typeof v === 'string' ? safeHtml(v) : clean(v)])); return item; };
      value = clean(JSON.parse(JSON.stringify(value)));
    }
    return json(value);
  };
  next();
});


app.use('/api',(req,res,next)=>config.writeMode==='readonly'&&!['GET','HEAD','OPTIONS'].includes(req.method)?res.status(503).json({error:'当前维护中，暂不接受写入'}):next());
// Only the dedicated batch importer needs multi-megabyte JSON; ordinary writes stay bounded.
app.use('/api/admin/upload-book',express.json({limit:'10mb'}));
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ limit: '256kb', extended: false, parameterLimit:100 }));
app.use(mongoSanitize());
app.get('/health/live', (req, res) => res.json({status:'live'}));
app.get('/health/metrics', (req,res)=>{
  if(!allowMetrics(req))return res.status(404).end();
  res.set('Cache-Control','private, no-store').json({...metrics.snapshot(),databaseReady:mongoose.connection.readyState===1});
});
app.get('/health/ready', (req, res) => res.status(mongoose.connection.readyState === 1 ? 200 : 503).json({ready:mongoose.connection.readyState === 1}));
app.use('/api', (req, res, next) => mongoose.connection.readyState === 1 ? next() : res.status(503).json({error:'数据库暂不可用'}));

// ================= 2. 限流配置 =================

// 删除了自定义的 getClientIp 和 keyGenerator，让官方库原生接管 req.ip，它能安全地处理 IPv6 的子网掩蔽防刷机制。

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 500, 
  message: '请求过于频繁，请稍后再试',
  // keyGenerator: getClientIp, 删掉这行
});
const publicReadLimiter = rateLimit({windowMs:60000,limit:3000,message:{error:'读取过于频繁'}});
const internalReadLimiter = rateLimit({windowMs:60000,limit:6000,message:{error:'内部读取容量已满'}});
app.use('/api/', (req,res,next) => {
  if (req.method !== 'GET') return globalLimiter(req,res,next);
  const expected=process.env.INTERNAL_API_SECRET;
  const supplied=req.headers['x-internal-api-secret'];
  const internal=expected && expected.length>=32 && typeof supplied==='string' && Buffer.byteLength(expected)===Buffer.byteLength(supplied) && ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(supplied));
  return (internal ? internalReadLimiter : publicReadLimiter)(req,res,next);
});

const authLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, 
  max: 20, 
  message: {error:'操作太频繁'},
  // keyGenerator: getClientIp, 删掉这行
});
app.use('/api/auth/', (req,res,next) => ['GET','HEAD','OPTIONS'].includes(req.method) ? next() : authLimiter(req,res,next));

// ================= 3. 数据库连接 =================

// ================= 4. 中间件 =================

const normalizeRole = (role) => (role === 'writer' ? 'reader' : role);

const auth = security(app, config);
const authMiddleware = auth.authenticate;
authRoutes(app,auth,config);
mediaRoutes(app,auth);
contentRoutes(app,auth);
draftRoutes(app,auth);
forumViewRoutes(app,auth);
importRoutes(app);
readingRoutes(app,auth);
forumWrites(app,auth);

const getOptionalUserId = auth.optionalUserId;

const adminMiddleware = async (req, res, next) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user || user.role !== 'admin') {
            return res.status(403).json({ error: '🚫 权限不足' });
        }
        next();
    } catch (e) {
        res.status(e.status || 500).json({ error: e.message });
    }
};

const ownBook = async (req,res,next) => {
  try {
    let id = req.params.id || req.body.bookId;
    if (req.path.startsWith('/api/chapters/') && req.params.id) {
      const chapter = await Chapter.findById(req.params.id);
      if (!chapter) return res.status(404).json({error:'章节不存在'});
      id = chapter.bookId;
    }
    const book = await Book.findById(id);
    if (!book) return res.status(404).json({error:'作品不存在'});
    if (req.user.role !== 'admin' && String(book.author_id) !== req.user.id) return res.status(403).json({error:'无权修改此作品'});
    next();
  } catch(e) { next(e); }
};
const ownShelf = (req,res,next) => req.params.userId === req.user.id ? next() : res.status(403).json({error:'无权访问他人书架'});
const fields = allowed => (req,res,next) => Object.keys(req.body).some(k => !allowed.includes(k)) ? res.status(400).json({error:'包含不可修改的字段'}) : next();
// ================= 5. API 路由 =================

// --- Admin API ---
// 替换原来的 /api/admin/users 接口
app.get('/api/admin/users', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { search } = req.query;
        let query = {};
        
        // 1. 检索功能
        if (search) {
            if(typeof search!=='string'||search.length>100)return res.status(400).json({error:'搜索关键词无效'});
            const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'i');
            query = { 
                $or: [ 
                    { username: regex }, 
                    { email: regex } 
                ] 
            };
        }

        const {limit,skip}=pagination(req.query,15,50);
        const users = await User.find(query)
            // 2. 选择需要的字段 (包括 stats)
            .select('username email role created_at isBanned stats weekly_score')
            // 3. 排序：按 weekly_score (活跃分) 倒序，分数一样按注册时间
            .sort({ weekly_score: -1, created_at: -1, _id:1 })
            // 4. 限制 15 条
            .skip(skip).limit(limit).maxTimeMS(3000);
        res.set('X-Total-Count',String(await User.countDocuments(query).maxTimeMS(3000)));
        res.set('Cache-Control','private, no-store');

        res.json(
            users.map((u) => ({
                ...u.toObject(),
                id: String(u._id),
                role: normalizeRole(u.role)
            }))
        );
    } catch (e) {
        res.status(e.status || 500).json({ error: e.message });
    }
});

//封号/解封接口
app.patch('/api/admin/users/:userId/ban', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { userId } = req.params;
        const { isBanned } = req.body;
        if (typeof isBanned !== 'boolean') return res.status(400).json({error:'isBanned must be boolean'});

        // 防止封禁自己 (可选，但建议加上)
        if (userId === req.user.id) {
            return res.status(400).json({ error: '不能封禁自己' });
        }

        let user;
        await mongoose.connection.transaction(async session=>{
          user=await User.findByIdAndUpdate(userId,{$set:{isBanned},$inc:{authVersion:1}},{new:true,session});
          if(!user)throw Object.assign(new Error('用户不存在'),{status:404});
          await Session.deleteMany({userId},{session});
        });

        res.json({ success: true, message: isBanned ? '用户已封禁' : '用户已解封', user: publicUser(user) });
    } catch (e) {
        res.status(e.status || 500).json({ error: e.message });
    }
});

// 影子登录 (Impersonate) - 🚨 紧急修复版：移除日志记录
app.post('/api/admin/impersonate/:userId', authMiddleware, adminMiddleware, (req,res) => res.status(410).json({error:'影子登录已停用'}));

// ================= 临时/运维：清理错误章节 (带安全预览版) =================
app.post('/api/admin/clean-dirty-chapters',authMiddleware,adminMiddleware,(req,res)=>res.status(410).json({error:'旧破坏性清理已停用，请先运行迁移盘点'}));

app.get('/api/users/:userId/profile', async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(publicUser(user));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// --- Reviews ---
app.get('/api/books/:id/reviews', getReviews);


// 上传图片
// ================= 论坛 (Forum) API =================

// 2. 获取帖子列表 (修复：确保 id 存在)
app.get('/api/forum/posts', async (req, res) => {
  try {
    const { tab = 'recommend' } = req.query;
    const currentUserId = await getOptionalUserId(req);
    const {limit,skip}=pagination(req.query);

    let sort = {};
    let filter = {};

    if (tab === 'hot') {
      sort = { views: -1, replyCount: -1 }; 
    } else if (tab === 'follow') {
      sort = { createdAt: -1 };
    } else {
      sort = { lastReplyAt: -1, views: -1 };
    }

    const posts = await ForumPost.find(filter)
      .populate('author', 'username _id')
      .sort({...sort,_id:1})
      .skip(skip)
      .limit(limit)
      .lean(); 

    const postIds = posts.map(p => p._id);
    const topReplyMap = new Map();
    if (postIds.length > 0) {
      const replies = (await Promise.all(postIds.map(postId=>ForumReply.findOne({postId}).populate('author','username _id avatar').sort({likes:-1,createdAt:-1,_id:1}).maxTimeMS(3000).lean()))).filter(Boolean);

      for (const reply of replies) {
        const key = String(reply.postId);
        if (!topReplyMap.has(key)) {
          topReplyMap.set(key, reply);
        }
      }
    }

    // 🔥 修复点：强制转换 _id 为 id
    const formattedPosts = posts.map(p => ({
      topReply: (() => {
        const topReply = topReplyMap.get(String(p._id));
        if (!topReply) return null;
        const plainContent = String(topReply.content || '').replace(/<[^>]+>/g, '');
        const preview = plainContent.slice(0, 180) + (plainContent.length > 180 ? '...' : '');
        return {
          id: String(topReply._id),
          content: preview,
          votes: topReply.likes || 0,
          comments: topReply.comments || 0,
          author: {
            id: topReply.author?._id ? String(topReply.author._id) : '',
            name: topReply.author?.username || '匿名',
            avatar: topReply.author?.avatar || ''
          }
        };
      })(),
      id: p._id.toString(), // 确保是字符串
      title: p.title,
      excerpt: p.summary,
      author: p.author?.username || '匿名',
      authorId: p.author?._id?.toString(),
      votes: p.likes, 
      comments: p.replyCount,
      hasLiked: currentUserId
        ? (p.likedBy || []).some(uid => String(uid) === currentUserId)
        : false,
      tags: p.tags,
      isHot: p.views > 1000, 
      type: p.type,
      views: p.views
    }));

    res.json(formattedPosts);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// 3. 获取单个帖子详情 (问题页)
app.get('/api/forum/posts/:id', async (req, res) => {
  try {
    const currentUserId = await getOptionalUserId(req);
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(400).json({ error: '无效的帖子ID' });
    }
    const post = await ForumPost.findById(req.params.id).populate('author', 'username _id').lean();

    if (!post) return res.status(404).json({ error: '帖子不存在' });

    const {likedBy,...publicPost}=post;
    res.json({
      ...publicPost,
      id: post._id,
      votes:post.likes||0,comments:post.replyCount||0,created_at:post.createdAt,
      hasLiked: currentUserId
        ? (post.likedBy || []).some(uid => String(uid) === currentUserId)
        : false,
      author: {
        name: post.author?.username,
        id: post.author?._id
      }
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// 4. 获取某个帖子的所有回答/评论
app.get('/api/forum/posts/:id/replies', async (req, res) => {
  try {
    const currentUserId = await getOptionalUserId(req);

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        // ID 都不合法，肯定没有回复，直接回空数组
        return res.json([]); 
    }
    const {limit,skip}=pagination(req.query);
    const filter={postId:req.params.id};
    if(req.query.target){if(typeof req.query.target!=='string'||!/^[a-f0-9]{24}$/i.test(req.query.target))return res.status(400).json({error:'回答ID无效'});filter._id=req.query.target;}
    const replies = await ForumReply.find(filter)
      .populate('author', 'username _id')
      .sort({ likes: -1, createdAt: -1, _id:1 }).skip(skip).limit(limit).maxTimeMS(3000)
      .lean();

    const formattedReplies = replies.map(r => ({
      id: r._id,
      content: r.content,
      votes: r.likes,
      hasLiked: currentUserId
        ? (r.likedBy || []).some(uid => String(uid) === currentUserId)
        : false,
      comments: r.comments,
      time: new Date(r.createdAt).toLocaleString(),
      author: {
        name: r.author?.username,
        bio: '暂无介绍', // 以后可以在 User 表加 bio 字段
        avatar: '', 
        id: r.author?._id
      }
    }));

    res.json(formattedReplies);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// 5. 发布回答/评论

// 6. 点赞/取消点赞帖子（toggle）

// 7. 点赞/取消点赞回答（toggle）

// 8. 获取回答评论（含一级和二级，二级不再嵌套）
app.get('/api/forum/replies/:id/comments', async (req, res) => {
  try {
    const replyId = req.params.id;
    const currentUserId = await getOptionalUserId(req);

    if (!mongoose.Types.ObjectId.isValid(replyId)) {
      return res.json([]);
    }

    const {limit,skip}=pagination(req.query,100,100);
    const comments = await ForumReplyComment.find({ replyId })
      .populate('author', 'username _id avatar')
      .sort({ createdAt: 1, _id:1 }).skip(skip).limit(limit).maxTimeMS(3000)
      .lean();

    const formatted = comments.map(c => ({
      id: c._id.toString(),
      postId: c.postId?.toString(),
      replyId: c.replyId?.toString(),
      parentCommentId: c.parentCommentId ? c.parentCommentId.toString() : null,
      content: c.content,
      votes: c.likes || 0,
      hasLiked: currentUserId
        ? (c.likedBy || []).some(uid => String(uid) === currentUserId)
        : false,
      replyCount: c.replyCount || 0,
      time: new Date(c.createdAt).toLocaleString(),
      author: {
        name: c.author?.username || '匿名',
        avatar: c.author?.avatar || '',
        id: c.author?._id?.toString() || ''
      }
    }));

    res.json(formatted);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// 9. 发表评论（支持二级回复，最多两级）

// 10. 点赞/取消点赞评论（toggle）

// ===========================================

// --- Books ---


app.get('/api/books/:id', async (req, res) => {
    try {
      const book = await Book.findOne({_id:req.params.id,deletedAt:null}).populate('author_id', 'username id');
      if (!book) return res.status(404).json({ error: 'Book not found' });
      res.json({ ...book.toObject(), id: book._id.toString() });
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message });
    }
});





// --- Chapters ---

// Chapter reads are side-effect free; visible reading is reported separately.
app.get('/api/chapters/:id', async (req, res) => {
  try {
    // 1. 防盗链检查 (保持你原有的逻辑)
    const referer = req.headers.referer || '';
    const ALLOWED_DOMAINS = ['localhost', 'jiutianxiaoshuo.com']; 
    if (referer && !ALLOWED_DOMAINS.some(domain => referer.includes(domain))) {
       // console.log('🚫 章节防盗链拦截:', referer);
    }

    // 2. 先查章节，确保章节存在
    const chapter = await Chapter.findOne({_id:req.params.id,deletedAt:null}).lean();
    if (!chapter || !await Book.exists({_id:chapter.bookId,deletedAt:null})) return res.status(404).json({ error: 'Chapter not found' });

    let navigation={};
    if(req.query.navigation==='1'){
      const filter={bookId:chapter.bookId,deletedAt:null};
      const [previous,next]=await Promise.all([
        Chapter.findOne({...filter,chapter_number:{$lt:chapter.chapter_number}}).sort({chapter_number:-1}).select('_id').maxTimeMS(3000).lean(),
        Chapter.findOne({...filter,chapter_number:{$gt:chapter.chapter_number}}).sort({chapter_number:1}).select('_id').maxTimeMS(3000).lean(),
      ]);
      navigation={previousId:previous?String(previous._id):null,nextId:next?String(next._id):null};
    }
    res.json({ ...chapter, ...navigation, id: chapter._id.toString(), bookId: chapter.bookId.toString() });

  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// ✅ 修改：加入 checkUploadQuota




// --- Bookmarks ---




// ================= 6. 定时任务 =================

app.use((err, req, res, next) => {
    if (err instanceof URIError) {
        console.warn('URL decoding failed', {requestId:req.requestId});
        return res.status(400).json({ error: '无效的 URL 格式' });
    }
    
    const status = err.status || (err.name==='MulterError' ? (err.code==='LIMIT_FILE_SIZE'?413:400) : 0) || (err.code === 11000 ? 409 : ['ValidationError','CastError'].includes(err.name) ? 400 : 500);
    console.error('Request failed', {name:err.name, status});
    res.status(status).json({ error: status === 500 ? '服务器内部错误' : status === 409 ? '数据冲突，请刷新重试' : '请求无效或无权限' });
});
// 👆 全局错误兜底结束

return app;
}
