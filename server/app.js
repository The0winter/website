import { readingRoutes } from './routes/reading.js';
import { importRoutes } from './routes/import.js';
import { contentRoutes } from './routes/content.js';
import { mediaRoutes, validAsset } from './routes/media.js';
import { security, safeHtml, publicUser } from './security.js';
import { authRoutes } from './routes/auth.js';
import Session from './models/Session.js';
﻿import { readConfig } from './config.js'; 
import express from 'express';
import mongoose from 'mongoose';
import crypto from 'crypto';
import { submitToIndexNow } from './utils/indexNow.js'
import cors from 'cors';
import bcrypt from 'bcryptjs';

import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import mongoSanitize from 'express-mongo-sanitize';


// 引入模型
import User from './models/User.js'; 
import Book from './models/Book.js';
import Chapter from './models/Chapter.js';
import Bookmark from './models/Bookmark.js';
import ForumPost from './models/ForumPost.js';  
import ForumReply from './models/ForumReply.js';
import ForumReplyComment from './models/ForumReplyComment.js';

import VerificationCode from './models/VerificationCode.js';
import sendVerificationEmail from './utils/sendEmail.js';


import { createReview, getReviews } from './controllers/reviewController.js';

export function createApp(config = readConfig()) {
const app = express();
app.param(['id','bookId','userId'],(req,res,next,value)=>/^[a-fA-F0-9]{24}$/.test(value)?next():res.status(400).json({error:'资源ID无效'}));
app.use((req,res,next)=>{
  req.requestId=crypto.randomUUID();res.set('X-Request-Id',req.requestId);
  const start=performance.now();res.once('finish',()=>{if(config.mode==='production'||process.env.LOG_REQUESTS==='enabled')console.log(JSON.stringify({requestId:req.requestId,method:req.method,route:req.route?.path||'unmatched',status:res.statusCode,durationMs:Math.round(performance.now()-start)}));});next();
});
app.set('trust proxy', false);

let userViewBuffer = {}; // 存用户阅读量: { "userId1": 5, "userId2": 1 }
let bookViewBuffer = {}; // 存书籍阅读量: { "bookId1": 100, "bookId2": 3 }

app.set('trust proxy', false);

// ================= 1. 安全与配置 (紧急修复版) =================

// 🚨 修复：加回默认值，防止因为缺环境变量导致网站打不开
const JWT_SECRET = config.jwtSecret;


// 👇 1. 新增：恶意乱码 URL 拦截器
app.use((req, res, next) => {
    try {
        decodeURIComponent(req.path);
        next();
    } catch (err) {
        console.warn('⚠️ 拦截到恶意的乱码扫描请求:', req.url);
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
      console.log('🚫 CORS 拦截:', origin);
      return callback(Object.assign(new Error('Not allowed by CORS'), {status:403}));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-secret'],
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
      const clean = item => { if (Array.isArray(item)) return item.map(clean); if (item && typeof item === 'object' && !(item instanceof Date)) return Object.fromEntries(Object.entries(item).map(([k,v]) => [k,k === 'content' && typeof v === 'string' ? safeHtml(v) : clean(v)])); return item; };
      value = clean(JSON.parse(JSON.stringify(value)));
    }
    return json(value);
  };
  next();
});


// ⚠️ 全局限制改回 10mb，防止之前的 100kb 限制导致某些大请求报错
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(mongoSanitize());
app.get('/health/live', (req, res) => res.json({status:'live'}));
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
  const internal=expected && expected.length>=32 && typeof supplied==='string' && expected.length===supplied.length && ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(supplied));
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

const generateRandomPassword = () => Math.random().toString(36).slice(-8);
const normalizeRole = (role) => (role === 'writer' ? 'reader' : role);

const auth = security(app, config);
const authMiddleware = auth.authenticate;
authRoutes(app,auth,config);
mediaRoutes(app,auth);
contentRoutes(app,auth);
importRoutes(app);
readingRoutes(app);

const getOptionalUserId = (req) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return null;

  try {
    const verified = jwt.verify(token, JWT_SECRET);
    return verified?.id ? String(verified.id) : null;
  } catch {
    return null;
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
            const regex = new RegExp(search, 'i'); // 模糊匹配，不区分大小写
            query = { 
                $or: [ 
                    { username: regex }, 
                    { email: regex } 
                ] 
            };
        }

        const users = await User.find(query)
            // 2. 选择需要的字段 (包括 stats)
            .select('username email role created_at isBanned stats weekly_score')
            // 3. 排序：按 weekly_score (活跃分) 倒序，分数一样按注册时间
            .sort({ weekly_score: -1, created_at: -1 }) // 直接按分数排，现在分数是秒级更新的
            // 4. 限制 15 条
            .limit(15);

        res.json(
            users.map((u) => ({
                ...u.toObject(),
                role: normalizeRole(u.role)
            }))
        );
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

//封号/解封接口
app.patch('/api/admin/users/:userId/ban', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { userId } = req.params;
        const { isBanned } = req.body;
        if (typeof isBanned !== 'boolean') return res.status(400).json({error:'isBanned must be boolean'});
        await Session.deleteMany({userId}); // 前端传 true 或 false

        // 防止封禁自己 (可选，但建议加上)
        if (userId === req.user.id) {
            return res.status(400).json({ error: '不能封禁自己' });
        }

        const user = await User.findByIdAndUpdate(
            userId, 
            { $set:{isBanned}, $inc:{authVersion:1} }, 
            { new: true }
        );

        if (!user) return res.status(404).json({ error: '用户不存在' });

        res.json({ success: true, message: isBanned ? '用户已封禁' : '用户已解封', user: publicUser(user) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 影子登录 (Impersonate) - 🚨 紧急修复版：移除日志记录
app.post('/api/admin/impersonate/:userId', authMiddleware, adminMiddleware, (req,res) => res.status(410).json({error:'影子登录已停用'}));

const DIRTY_TITLE_REGEX = /(?:^|\s)\d+\s*[.、:：\-]\s*第/u;

const normalizeChapterTitleForDedup = (title = '') =>
    String(title)
        .replace(/^\s*\d+\s*[.、:：\-]\s*/u, '')
        .replace(/\s+/g, '')
        .trim();

const normalizeContentSampleForDedup = (content = '', maxChars = 600) => {
    const normalized = String(content)
        .replace(/\s+/g, '')
        .replace(/[.,，。!?！？:：;；、"'`~\-—_()[\]{}<>《》【】]/g, '');
    return normalized.slice(0, maxChars);
};

const calcPrefixSimilarity = (a = '', b = '') => {
    if (!a || !b) return 0;
    const minLen = Math.min(a.length, b.length);
    let sameCount = 0;
    while (sameCount < minLen && a[sameCount] === b[sameCount]) {
        sameCount++;
    }
    return sameCount / minLen;
};

const buildNgramSet = (text, n = 3) => {
    const set = new Set();
    if (!text) return set;
    if (text.length < n) {
        set.add(text);
        return set;
    }
    for (let i = 0; i <= text.length - n; i++) {
        set.add(text.slice(i, i + n));
    }
    return set;
};

const calcNgramJaccardSimilarity = (a = '', b = '') => {
    if (!a || !b) return 0;
    const setA = buildNgramSet(a);
    const setB = buildNgramSet(b);
    if (setA.size === 0 || setB.size === 0) return 0;

    let intersection = 0;
    for (const token of setA) {
        if (setB.has(token)) intersection++;
    }
    const union = setA.size + setB.size - intersection;
    if (union <= 0) return 0;
    return intersection / union;
};

const calcContentSimilarity = (a = '', b = '') =>
    Math.max(calcPrefixSimilarity(a, b), calcNgramJaccardSimilarity(a, b));

const buildCleanupConfirmToken = (pairs = [], options = {}) => {
    const payload = JSON.stringify({
        ids: pairs.map(p => String(p.deleteId)).sort(),
        threshold: options.threshold,
        compareChars: options.compareChars
    });
    return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 20);
};

// ================= 临时/运维：清理错误章节 (带安全预览版) =================
app.post('/api/admin/clean-dirty-chapters',authMiddleware,adminMiddleware,(req,res)=>res.status(410).json({error:'旧破坏性清理已停用，请先运行迁移盘点'}));

app.get('/api/users/:userId/profile', async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(publicUser(user));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Reviews ---
app.get('/api/books/:id/reviews', getReviews);


// 上传图片
// ================= 论坛 (Forum) API =================

const FORUM_LIMITS = {
  titleMax: 120,
  postContentMax: 30000,
  replyContentMax: 12000,
  commentContentMax: 2000,
  maxTags: 8,
  maxTagLength: 20,
  duplicateWindowMs: 60 * 1000
};

const sanitizeForumHtml = safeHtml;

const stripHtml = (input = '') => String(input)
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim();

// 注意这里多加了一个 res 参数
const getForumActorKey = (req, res) => {
  if (req.user?.id) return `uid:${req.user.id}`;

  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token) {
    try {
      const verified = jwt.verify(token, JWT_SECRET);
      if (verified?.id) return `uid:${verified.id}`;
    } catch {
      // ignore bad token and fallback to IP
    }
  }

  // ✅ 使用官方推荐的 ipKeyGenerator 替代原始 req.ip，彻底解决 IPv6 报错
  return ipKeyGenerator(req, res);
};

const forumPostCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 15,
  message: '发帖过于频繁，请稍后再试',
  // keyGenerator: getForumActorKey  <-- 加上 // 注释掉
});

const forumReplyCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 40,
  message: '回答提交过于频繁，请稍后再试',
  // keyGenerator: getForumActorKey  <-- 加上 // 注释掉
});

const forumCommentCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 80,
  message: '评论提交过于频繁，请稍后再试',
  // keyGenerator: getForumActorKey  <-- 加上 // 注释掉
});

// 1. 发布帖子 (修复：返回 id 字段)
app.post('/api/forum/posts', authMiddleware, forumPostCreateLimiter, async (req, res) => {
  try {
    const { title, content, type, tags } = req.body;

    const finalType = type === 'article' ? 'article' : 'question';
    const safeTitle = stripHtml(title);
    const safeContent = sanitizeForumHtml(content);
    const plainContent = stripHtml(safeContent);

    if (!safeTitle) {
      return res.status(400).json({ error: '标题不能为空' });
    }
    if (!plainContent) {
      return res.status(400).json({ error: '内容不能为空' });
    }
    if (safeTitle.length > FORUM_LIMITS.titleMax) {
      return res.status(400).json({ error: `标题不能超过 ${FORUM_LIMITS.titleMax} 字` });
    }
    if (plainContent.length > FORUM_LIMITS.postContentMax) {
      return res.status(400).json({ error: `内容不能超过 ${FORUM_LIMITS.postContentMax} 字` });
    }
    if (finalType === 'question' && !/[?？]\s*$/.test(safeTitle)) {
      return res.status(400).json({ error: '提问标题必须以问号结尾' });
    }

    const normalizedTags = Array.isArray(tags)
      ? [...new Set(tags.map(tag => stripHtml(tag).slice(0, FORUM_LIMITS.maxTagLength)).filter(Boolean))]
          .slice(0, FORUM_LIMITS.maxTags)
      : [];

    const duplicatePost = await ForumPost.findOne({
      author: req.user.id,
      title: safeTitle,
      type: finalType,
      createdAt: { $gte: new Date(Date.now() - FORUM_LIMITS.duplicateWindowMs) }
    }).select('_id');

    if (duplicatePost) {
      return res.status(429).json({ error: '请勿短时间重复发布相同内容' });
    }

    const summary = plainContent.substring(0, 100) + (plainContent.length > 100 ? '...' : '');

    const newPost = await ForumPost.create({
      title: safeTitle,
      content: safeContent,
      summary,
      type: finalType,
      tags: normalizedTags,
      author: req.user.id
    });

    // 🔥 修复点：明确返回 id 字符串，防止前端拿到 undefined
    res.status(201).json({
        ...newPost.toObject(),
        id: newPost._id.toString() 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. 获取帖子列表 (修复：确保 id 存在)
app.get('/api/forum/posts', async (req, res) => {
  try {
    const { tab = 'recommend', page = 1 } = req.query;
    const currentUserId = getOptionalUserId(req);
    const limit = 20;
    const skip = (page - 1) * limit;

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
      .populate('author', 'username email _id') 
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(); 

    const postIds = posts.map(p => p._id);
    const topReplyMap = new Map();
    if (postIds.length > 0) {
      const replies = await ForumReply.find({ postId: { $in: postIds } })
        .populate('author', 'username _id avatar')
        .sort({ postId: 1, likes: -1, createdAt: -1 })
        .lean();

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
    res.status(500).json({ error: error.message });
  }
});

// 3. 获取单个帖子详情 (问题页)
app.get('/api/forum/posts/:id', async (req, res) => {
  try {
    const currentUserId = getOptionalUserId(req);
    // 浏览量 +1
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(400).json({ error: '无效的帖子ID' });
    }
    const post = await ForumPost.findByIdAndUpdate(
      req.params.id, 
      { $inc: { views: 1 } }, 
      { new: true }
    ).populate('author', 'username email _id').lean();

    if (!post) return res.status(404).json({ error: '帖子不存在' });

    res.json({
      ...post,
      id: post._id,
      hasLiked: currentUserId
        ? (post.likedBy || []).some(uid => String(uid) === currentUserId)
        : false,
      author: {
        name: post.author?.username,
        id: post.author?._id
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. 获取某个帖子的所有回答/评论
app.get('/api/forum/posts/:id/replies', async (req, res) => {
  try {
    const currentUserId = getOptionalUserId(req);

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        // ID 都不合法，肯定没有回复，直接回空数组
        return res.json([]); 
    }
    const replies = await ForumReply.find({ postId: req.params.id })
      .populate('author', 'username email _id')
      .sort({ likes: -1, createdAt: -1 }) // 赞多的排前面
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
    res.status(500).json({ error: error.message });
  }
});

// 5. 发布回答/评论
app.post('/api/forum/posts/:id/replies', authMiddleware, forumReplyCreateLimiter, async (req, res) => {
  try {
    const { content } = req.body;
    const postId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({ error: '无效的帖子ID' });
    }

    const safeContent = sanitizeForumHtml(content);
    const plainContent = stripHtml(safeContent);
    if (!plainContent) {
      return res.status(400).json({ error: '回答内容不能为空' });
    }
    if (plainContent.length > FORUM_LIMITS.replyContentMax) {
      return res.status(400).json({ error: `回答不能超过 ${FORUM_LIMITS.replyContentMax} 字` });
    }

    const postExists = await ForumPost.exists({ _id: postId });
    if (!postExists) {
      return res.status(404).json({ error: '帖子不存在' });
    }

    const duplicateReply = await ForumReply.findOne({
      postId,
      author: req.user.id,
      content: safeContent,
      createdAt: { $gte: new Date(Date.now() - FORUM_LIMITS.duplicateWindowMs) }
    }).select('_id');

    if (duplicateReply) {
      return res.status(429).json({ error: '请勿短时间重复提交相同回答' });
    }

    const newReply = await ForumReply.create({
      postId,
      author: req.user.id,
      content: safeContent
    });

    // 更新主帖的回复数、最后回复时间
    await ForumPost.findByIdAndUpdate(postId, {
      $inc: { replyCount: 1 },
      lastReplyAt: new Date()
    });

    res.status(201).json(newReply);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 6. 点赞/取消点赞帖子（toggle）
app.post('/api/forum/posts/:id/like', authMiddleware, async (req, res) => {
  try {
    const postId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({ error: '无效的帖子ID' });
    }

    const userObjectId = new mongoose.Types.ObjectId(req.user.id);

    const likedPost = await ForumPost.findOneAndUpdate(
      { _id: postId, likedBy: { $ne: userObjectId } },
      { $addToSet: { likedBy: userObjectId }, $inc: { likes: 1 } },
      { new: true, select: 'likes' }
    );

    if (likedPost) {
      return res.json({ liked: true, votes: likedPost.likes });
    }

    const unlikedPost = await ForumPost.findOneAndUpdate(
      { _id: postId, likedBy: userObjectId },
      { $pull: { likedBy: userObjectId }, $inc: { likes: -1 } },
      { new: true, select: 'likes' }
    );

    if (unlikedPost) {
      return res.json({ liked: false, votes: Math.max(0, unlikedPost.likes || 0) });
    }

    return res.status(404).json({ error: '帖子不存在' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 7. 点赞/取消点赞回答（toggle）
app.post('/api/forum/replies/:id/like', authMiddleware, async (req, res) => {
  try {
    const replyId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(replyId)) {
      return res.status(400).json({ error: '无效的回答ID' });
    }

    const userObjectId = new mongoose.Types.ObjectId(req.user.id);

    const likedReply = await ForumReply.findOneAndUpdate(
      { _id: replyId, likedBy: { $ne: userObjectId } },
      { $addToSet: { likedBy: userObjectId }, $inc: { likes: 1 } },
      { new: true, select: 'likes postId' }
    );

    if (likedReply) {
      return res.json({ liked: true, votes: likedReply.likes, postId: likedReply.postId });
    }

    const unlikedReply = await ForumReply.findOneAndUpdate(
      { _id: replyId, likedBy: userObjectId },
      { $pull: { likedBy: userObjectId }, $inc: { likes: -1 } },
      { new: true, select: 'likes postId' }
    );

    if (unlikedReply) {
      return res.json({
        liked: false,
        votes: Math.max(0, unlikedReply.likes || 0),
        postId: unlikedReply.postId
      });
    }

    return res.status(404).json({ error: '回答不存在' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 8. 获取回答评论（含一级和二级，二级不再嵌套）
app.get('/api/forum/replies/:id/comments', async (req, res) => {
  try {
    const replyId = req.params.id;
    const currentUserId = getOptionalUserId(req);

    if (!mongoose.Types.ObjectId.isValid(replyId)) {
      return res.json([]);
    }

    const comments = await ForumReplyComment.find({ replyId })
      .populate('author', 'username _id avatar')
      .sort({ createdAt: 1 })
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
    res.status(500).json({ error: error.message });
  }
});

// 9. 发表评论（支持二级回复，最多两级）
app.post('/api/forum/replies/:id/comments', authMiddleware, forumCommentCreateLimiter, async (req, res) => {
  try {
    const replyId = req.params.id;
    const { content, parentCommentId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(replyId)) {
      return res.status(400).json({ error: '无效的回答ID' });
    }
    const safeContent = sanitizeForumHtml(content);
    const plainContent = stripHtml(safeContent);

    if (!plainContent) {
      return res.status(400).json({ error: '评论内容不能为空' });
    }
    if (plainContent.length > FORUM_LIMITS.commentContentMax) {
      return res.status(400).json({ error: `评论不能超过 ${FORUM_LIMITS.commentContentMax} 字` });
    }

    const reply = await ForumReply.findById(replyId).select('_id postId');
    if (!reply) {
      return res.status(404).json({ error: '回答不存在' });
    }

    let parent = null;
    let finalParentId = null;

    if (parentCommentId) {
      if (!mongoose.Types.ObjectId.isValid(parentCommentId)) {
        return res.status(400).json({ error: '无效的父评论ID' });
      }

      parent = await ForumReplyComment.findOne({
        _id: parentCommentId,
        replyId: reply._id
      }).select('_id parentCommentId');

      if (!parent) {
        return res.status(404).json({ error: '父评论不存在' });
      }

      if (parent.parentCommentId) {
        return res.status(400).json({ error: '仅支持二级评论' });
      }

      finalParentId = parent._id;
    }

    const duplicateComment = await ForumReplyComment.findOne({
      replyId: reply._id,
      author: req.user.id,
      content: safeContent,
      createdAt: { $gte: new Date(Date.now() - FORUM_LIMITS.duplicateWindowMs) }
    }).select('_id');

    if (duplicateComment) {
      return res.status(429).json({ error: '请勿短时间重复提交相同评论' });
    }

    const created = await ForumReplyComment.create({
      postId: reply.postId,
      replyId: reply._id,
      parentCommentId: finalParentId,
      author: req.user.id,
      content: safeContent
    });

    if (finalParentId) {
      await ForumReplyComment.findByIdAndUpdate(finalParentId, {
        $inc: { replyCount: 1 }
      });
    }

    await ForumReply.findByIdAndUpdate(reply._id, {
      $inc: { comments: 1 }
    });

    const populated = await ForumReplyComment.findById(created._id)
      .populate('author', 'username _id avatar')
      .lean();

    return res.status(201).json({
      id: populated._id.toString(),
      postId: populated.postId?.toString(),
      replyId: populated.replyId?.toString(),
      parentCommentId: populated.parentCommentId ? populated.parentCommentId.toString() : null,
      content: populated.content,
      votes: populated.likes || 0,
      hasLiked: false,
      replyCount: populated.replyCount || 0,
      time: new Date(populated.createdAt).toLocaleString(),
      author: {
        name: populated.author?.username || '匿名',
        avatar: populated.author?.avatar || '',
        id: populated.author?._id?.toString() || ''
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 10. 点赞/取消点赞评论（toggle）
app.post('/api/forum/comments/:id/like', authMiddleware, async (req, res) => {
  try {
    const commentId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(commentId)) {
      return res.status(400).json({ error: '无效的评论ID' });
    }

    const userObjectId = new mongoose.Types.ObjectId(req.user.id);

    const likedComment = await ForumReplyComment.findOneAndUpdate(
      { _id: commentId, likedBy: { $ne: userObjectId } },
      { $addToSet: { likedBy: userObjectId }, $inc: { likes: 1 } },
      { new: true, select: 'likes' }
    );

    if (likedComment) {
      return res.json({ liked: true, votes: likedComment.likes });
    }

    const unlikedComment = await ForumReplyComment.findOneAndUpdate(
      { _id: commentId, likedBy: userObjectId },
      { $pull: { likedBy: userObjectId }, $inc: { likes: -1 } },
      { new: true, select: 'likes' }
    );

    if (unlikedComment) {
      return res.json({ liked: false, votes: Math.max(0, unlikedComment.likes || 0) });
    }

    return res.status(404).json({ error: '评论不存在' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===========================================

// --- Books ---


app.get('/api/books/:id', async (req, res) => {
    try {
      const book = await Book.findOne({_id:req.params.id,deletedAt:null}).populate('author_id', 'username id');
      if (!book) return res.status(404).json({ error: 'Book not found' });
      res.json({ ...book.toObject(), id: book._id.toString() });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
});





// --- Chapters ---

// ✅ 修复后的章节获取接口：自动增加书籍浏览量 + 用户阅读量
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

    res.json({ ...chapter, id: chapter._id.toString(), bookId: chapter.bookId.toString() });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ✅ 修改：加入 checkUploadQuota




// --- Bookmarks ---




// ================= 6. 定时任务 =================

app.use((err, req, res, next) => {
    if (err instanceof URIError) {
        console.warn('⚠️ URL 参数解码失败:', req.url);
        return res.status(400).json({ error: '无效的 URL 格式' });
    }
    
    const status = err.status || (err.name==='MulterError' ? (err.code==='LIMIT_FILE_SIZE'?413:400) : 0) || (err.code === 11000 ? 409 : ['ValidationError','CastError'].includes(err.name) ? 400 : 500);
    console.error('Request failed', {name:err.name, status});
    res.status(status).json({ error: status === 500 ? '服务器内部错误' : status === 409 ? '数据冲突，请刷新重试' : '请求无效或无权限' });
});
// 👆 全局错误兜底结束

return app;
}
