import 'dotenv/config'; 
import express from 'express';
import mongoose from 'mongoose';
import crypto from 'crypto';
import { submitToIndexNow } from './utils/indexNow.js'
import cors from 'cors';
import bcrypt from 'bcryptjs';
import cron from 'node-cron';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import mongoSanitize from 'express-mongo-sanitize';
import { v2 as cloudinary } from 'cloudinary'; // 引入 cloudinary

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

import upload from './utils/upload.js';
import { createReview, getReviews } from './controllers/reviewController.js';

const app = express();
app.set('trust proxy', 1);

let userViewBuffer = {}; // 存用户阅读量: { "userId1": 5, "userId2": 1 }
let bookViewBuffer = {}; // 存书籍阅读量: { "bookId1": 100, "bookId2": 3 }

app.set('trust proxy', 1);

// ================= 1. 安全与配置 (紧急修复版) =================

// 🚨 修复：加回默认值，防止因为缺环境变量导致网站打不开
const JWT_SECRET = process.env.JWT_SECRET || 'temp_emergency_secret_key_123456';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'temp_admin_secret_123';

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

// 删除了自定义的 getClientIp 和 keyGenerator，让官方库原生接管 req.ip，它能安全地处理 IPv6 的子网掩蔽防刷机制。

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 500, 
  message: '请求过于频繁，请稍后再试',
  // keyGenerator: getClientIp, 删掉这行
});
app.use('/api/', globalLimiter);

const authLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, 
  max: 20, 
  message: '操作太频繁',
  // keyGenerator: getClientIp, 删掉这行
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
const normalizeRole = (role) => (role === 'writer' ? 'reader' : role);

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
            role: 'reader',
            created_at: new Date()
        });
        return user;
    } catch (e) {
        console.error(`⚠️ 作者创建失败: ${e.message}`);
        return null;
    }
}

// ================= 配额检查中间件 (新增) =================

const DAILY_WORD_LIMIT = 100000; // ⚡ 设定限制：普通用户每天 2万字

const checkUploadQuota = async (req, res, next) => {
    try {
        // 1. 如果是管理员，直接放行 (你的影子登录或者管理员账号不受限)
        if (req.user.role === 'admin') {
            return next(); 
        }

        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ error: '用户不存在' });

        const today = new Date().toDateString(); // 获取 "Fri Feb 09 2026"
        const lastDate = new Date(user.last_upload_date).toDateString();

        // 2. 如果上次上传不是今天，重置计数器
        if (today !== lastDate) {
            user.daily_upload_words = 0;
            user.last_upload_date = new Date();
            await user.save();
        }

        // 3. 预估本次上传字数 (章节内容长度)
        // 注意：req.body.content 可能还没传过来，或者就是 content
        const incomingContent = req.body.content || '';
        const incomingCount = incomingContent.length;

        // 4. 检查是否超标
        if (user.daily_upload_words + incomingCount > DAILY_WORD_LIMIT) {
             return res.status(403).json({ 
                 error: `今日上传额度已用完！(限额 ${DAILY_WORD_LIMIT} 字/天，您已用 ${user.daily_upload_words} 字)` 
             });
        }

        // 5. 暂时把要增加的字数挂在 req 上，等真正保存成功了再写入数据库
        // (这一步我们在具体的路由里做)
        req.incomingWordCount = incomingCount;
        
        next();
    } catch (e) {
        return res.status(500).json({ error: '配额检查失败: ' + e.message });
    }
};

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
        const { isBanned } = req.body; // 前端传 true 或 false

        // 防止封禁自己 (可选，但建议加上)
        if (userId === req.user.id) {
            return res.status(400).json({ error: '不能封禁自己' });
        }

        const user = await User.findByIdAndUpdate(
            userId, 
            { isBanned: isBanned }, 
            { new: true }
        );

        if (!user) return res.status(404).json({ error: '用户不存在' });

        res.json({ success: true, message: isBanned ? '用户已封禁' : '用户已解封', user });
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

        const targetRole = normalizeRole(targetUser.role);
        
        const token = jwt.sign(
            { id: targetUser._id, role: targetRole }, 
            JWT_SECRET, 
            { expiresIn: '1h' }
        );

        const { password: _, ...userWithoutPassword } = targetUser.toObject();
        userWithoutPassword.role = targetRole;
        res.json({ 
            token, 
            user: { 
                id: targetUser._id.toString(), 
                email: targetUser.email, 
                username: targetUser.username, 
                role: targetRole 
            }, 
            profile: userWithoutPassword 
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

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
app.post('/api/admin/clean-dirty-chapters', async (req, res) => {
    try {
        const clientSecret = req.headers['x-admin-secret'];
        const ADMIN_SECRET = process.env.ADMIN_SECRET || 'temp_admin_secret_123';
        if (clientSecret !== ADMIN_SECRET) {
            return res.status(403).json({ error: '🚫 密码错误，无权执行清理' });
        }

        const {
            action = 'preview',
            similarityThreshold = 0.92,
            contentCompareChars = 600,
            previewLimit = 80,
            confirmToken: clientConfirmToken
        } = req.body || {};

        const safeThreshold = Math.min(0.99, Math.max(0.8, Number(similarityThreshold) || 0.92));
        const safeCompareChars = Math.min(2000, Math.max(200, Number(contentCompareChars) || 600));
        const safePreviewLimit = Math.min(300, Math.max(10, Number(previewLimit) || 80));

        // 1) 先按“脏标题”找候选，但不直接删除
        const dirtyChapters = await Chapter.find({
            title: { $regex: DIRTY_TITLE_REGEX }
        })
            .select('_id bookId title content chapter_number createdAt')
            .populate('bookId', 'title')
            .lean();

        if (dirtyChapters.length === 0) {
            return res.json({
                success: true,
                isDryRun: true,
                message: '🎉 数据库很干净，没有发现脏标题章节。',
                summary: [],
                preview: [],
                skipped: []
            });
        }

        const bookIds = [...new Set(
            dirtyChapters
                .map(doc => String(doc.bookId?._id || doc.bookId || ''))
                .filter(Boolean)
        )];

        // 2) 拉取同书所有章节做二次校验（正文相似度）
        const relatedChapters = await Chapter.find({
            bookId: { $in: bookIds }
        })
            .select('_id bookId title content chapter_number createdAt')
            .lean();

        const chaptersByBook = new Map();
        for (const chapter of relatedChapters) {
            const bookKey = String(chapter.bookId);
            if (!chaptersByBook.has(bookKey)) {
                chaptersByBook.set(bookKey, []);
            }
            chaptersByBook.get(bookKey).push({
                ...chapter,
                idStr: String(chapter._id),
                normalizedTitle: normalizeChapterTitleForDedup(chapter.title),
                contentSample: normalizeContentSampleForDedup(chapter.content, safeCompareChars),
                isDirtyTitle: DIRTY_TITLE_REGEX.test(String(chapter.title || ''))
            });
        }

        const previewPairs = [];
        const skipped = [];
        const summaryMap = {};

        for (const dirtyDoc of dirtyChapters) {
            const dirtyId = String(dirtyDoc._id);
            const bookKey = String(dirtyDoc.bookId?._id || dirtyDoc.bookId || '');
            const bookTitle = dirtyDoc.bookId?.title || `未知书籍(ID:${bookKey})`;
            const dirtySample = normalizeContentSampleForDedup(dirtyDoc.content, safeCompareChars);
            const dirtyNormalizedTitle = normalizeChapterTitleForDedup(dirtyDoc.title);
            const dirtyCandidates = chaptersByBook.get(bookKey) || [];

            let bestMatch = null;

            for (const candidate of dirtyCandidates) {
                if (candidate.idStr === dirtyId) continue;
                if (candidate.isDirtyTitle) continue; // 只与“非脏标题章节”比对，避免误删一整组脏数据

                const sameChapterNumber =
                    Number.isFinite(dirtyDoc.chapter_number) &&
                    Number.isFinite(candidate.chapter_number) &&
                    dirtyDoc.chapter_number === candidate.chapter_number;

                const sameNormalizedTitle =
                    !!dirtyNormalizedTitle &&
                    !!candidate.normalizedTitle &&
                    dirtyNormalizedTitle === candidate.normalizedTitle;

                if (!sameChapterNumber && !sameNormalizedTitle) continue;
                if (dirtySample.length < 80 || candidate.contentSample.length < 80) continue;

                const similarity = calcContentSimilarity(dirtySample, candidate.contentSample);
                const lengthRatio = Math.min(dirtySample.length, candidate.contentSample.length) /
                    Math.max(dirtySample.length, candidate.contentSample.length);

                if (similarity < safeThreshold || lengthRatio < 0.6) continue;

                const score =
                    similarity +
                    (sameChapterNumber ? 0.03 : 0) +
                    (sameNormalizedTitle ? 0.02 : 0) +
                    Math.min(lengthRatio, 1) * 0.01;

                if (!bestMatch || score > bestMatch.score) {
                    bestMatch = {
                        candidate,
                        similarity,
                        score,
                        sameChapterNumber,
                        sameNormalizedTitle
                    };
                }
            }

            if (!bestMatch) {
                skipped.push({
                    id: dirtyId,
                    bookTitle,
                    chapterNumber: dirtyDoc.chapter_number,
                    title: dirtyDoc.title,
                    reason: '未找到通过正文校验的对应章节，已自动跳过'
                });
                continue;
            }

            const reasonParts = [];
            if (bestMatch.sameChapterNumber) reasonParts.push('同章号');
            if (bestMatch.sameNormalizedTitle) reasonParts.push('同规范化标题');
            reasonParts.push(`正文相似度 ${(bestMatch.similarity * 100).toFixed(2)}%`);

            previewPairs.push({
                deleteId: dirtyId,
                deleteTitle: dirtyDoc.title,
                keepId: bestMatch.candidate.idStr,
                keepTitle: bestMatch.candidate.title,
                bookTitle,
                chapterNumber: dirtyDoc.chapter_number,
                similarity: Number(bestMatch.similarity.toFixed(4)),
                reason: reasonParts.join(' + '),
                deletePreview: String(dirtyDoc.content || '').replace(/\s+/g, ' ').slice(0, 80),
                keepPreview: String(bestMatch.candidate.content || '').replace(/\s+/g, ' ').slice(0, 80)
            });

            summaryMap[bookTitle] = (summaryMap[bookTitle] || 0) + 1;
        }

        const summary = Object.keys(summaryMap)
            .map(title => ({ title, count: summaryMap[title] }))
            .sort((a, b) => b.count - a.count);

        const serverConfirmToken = buildCleanupConfirmToken(previewPairs, {
            threshold: safeThreshold,
            compareChars: safeCompareChars
        });

        // 3) 默认预览模式：先展示明细，再由你确认
        if (action !== 'execute') {
            return res.json({
                success: true,
                isDryRun: true,
                message: `【预览模式】命中 ${dirtyChapters.length} 条脏标题；其中 ${previewPairs.length} 条通过正文校验可删除，${skipped.length} 条已跳过。`,
                summary,
                preview: previewPairs.slice(0, safePreviewLimit),
                skipped: skipped.slice(0, safePreviewLimit),
                deletableCount: previewPairs.length,
                skippedCount: skipped.length,
                options: {
                    similarityThreshold: safeThreshold,
                    contentCompareChars: safeCompareChars
                },
                confirmToken: serverConfirmToken
            });
        }

        if (!clientConfirmToken || clientConfirmToken !== serverConfirmToken) {
            return res.status(409).json({
                success: false,
                isDryRun: true,
                error: '确认令牌不匹配，请先重新预览后再执行删除。',
                deletableCount: previewPairs.length,
                skippedCount: skipped.length,
                summary,
                preview: previewPairs.slice(0, safePreviewLimit),
                skipped: skipped.slice(0, safePreviewLimit),
                confirmToken: serverConfirmToken
            });
        }

        const idsToDelete = previewPairs.map(item => item.deleteId);

        if (idsToDelete.length === 0) {
            return res.json({
                success: true,
                isDryRun: false,
                message: '没有通过正文校验的重复章节，未执行删除。',
                summary: [],
                deletedCount: 0,
                skippedCount: skipped.length
            });
        }

        const result = await Chapter.deleteMany({
            _id: { $in: idsToDelete }
        });

        res.json({
            success: true,
            isDryRun: false,
            message: `【执行模式】清理完成：共删除 ${result.deletedCount} 条重复章节（正文校验通过）。`,
            summary,
            requestedDeleteCount: idsToDelete.length,
            deletedCount: result.deletedCount,
            skippedCount: skipped.length
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
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
                // 👇 修改开始：接收返回值
                const insertedDocs = await Chapter.insertMany(chaptersToInsert);
                // 🔥 新增：后台静默推送（不影响主流程）
                try {
                    const newUrls = insertedDocs.map(doc => 
                      `https://jiutianxiaoshuo.com/book/${book._id}/${doc._id}`
                  );
                    submitToIndexNow(newUrls).catch(err => console.error('IndexNow推送异常:', err));
                } catch (e) {
                    console.error('生成URL失败:', e);
                }
            }

            // ✅ 修复：只留这一个 res.json，并且前面加上 return 结束函数
            return res.json({ success: true, message: `入库成功，新增 ${chaptersToInsert.length} 章` });
            
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    });

// --- Auth API ---
app.post('/api/auth/signup', async (req, res) => {
  try {
    // ✅ 1. 多接收一个 code 参数
    const { email, password, username, role, code } = req.body;

// ✅ 2. 校验验证码 (修改后)
    const validCode = await VerificationCode.findOne({ email, code });
    
    // 情况A: 根本找不到 (可能没发过，或者过了1小时被数据库自动删了)
    if (!validCode) {
      return res.status(400).json({ error: '验证码错误或不存在' });
    }

    // 情况B: 找到了，但我们要检查是不是“超时”了 (核心逻辑)
    // 计算现在的时间 - 发送的时间
    const timeDiff = Date.now() - new Date(validCode.lastSentAt).getTime();
    const isExpired = timeDiff > 5 * 60 * 1000; // 5分钟 = 300000毫秒

    if (isExpired) {
       return res.status(400).json({ error: '验证码已过期(超过5分钟)，请重新获取' });
    }

    // --- 验证通过，继续下面的注册逻辑 ---

    const existingUser = await User.findOne({ email });
    // ... (后面的代码不用动)
    if (existingUser) return res.status(400).json({ error: '该邮箱已被注册' });

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    const newUser = await User.create({
      email,
      password: hashedPassword,
      username,
      role: 'reader',
      loginAttempts: 0 
    });
    
    // ✅ 3. 注册成功后，删除验证码
    await VerificationCode.deleteOne({ _id: validCode._id });

    const token = jwt.sign(
        { id: newUser._id, role: normalizeRole(newUser.role) }, 
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

    if (user.isBanned) {
        return res.status(403).json({ error: '您的账号已被封禁，请联系管理员。' });
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
        { id: user._id, role: normalizeRole(user.role) }, 
        JWT_SECRET, 
        { expiresIn: '7d' }
    );

    const userObj = user.toObject();
    userObj.role = normalizeRole(userObj.role);
    delete userObj.password;
    delete userObj.loginAttempts;
    delete userObj.lockUntil;

    res.json({ 
      token, 
      user: { id: user._id.toString(), email: user.email, username: user.username, role: normalizeRole(user.role) }, 
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
        userWithoutPassword.role = normalizeRole(userWithoutPassword.role);
        res.json({ 
            user: { id: user._id.toString(), email: user.email, username: user.username, role: normalizeRole(user.role) }, 
            profile: userWithoutPassword 
        });
    } catch (e) {
        return res.json({ user: null, profile: null });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ✅ 发送验证码接口 (完整版：防重复 + 防轰炸 + 限流)
app.post('/api/auth/send-code', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: "请填写邮箱" });

  try {
    // 🔥 第一步：检查邮箱是否已被注册
    // 如果用户已经是会员了，就别让他发验证码了，直接让他去登录
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "该邮箱已被注册，请直接登录" });
    }

    // --- 下面是之前的防轰炸/限流逻辑 ---
    
    // 生成6位随机数
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // 查一下验证码表里的记录
    let record = await VerificationCode.findOne({ email });

    if (record) {
      // 存在记录，检查是否超频
      const now = Date.now();
      const lastSentTime = new Date(record.lastSentAt).getTime();
      const diffSeconds = (now - lastSentTime) / 1000;

      // 限制A：60秒冷却
      if (diffSeconds < 60) {
        return res.status(429).json({ message: `发送太频繁，请 ${Math.ceil(60 - diffSeconds)} 秒后再试` });
      }

      // 限制B：1小时内最多5次
      if (record.sendCount >= 5) {
        return res.status(429).json({ message: "操作太频繁，请 1 小时后再试" });
      }

      // 允许发送：更新数据
      record.code = code;
      record.sendCount += 1;
      record.lastSentAt = now;
      await record.save();

    } else {
      // 没有记录，创建新记录
      await new VerificationCode({
        email,
        code,
        sendCount: 1,
        lastSentAt: Date.now()
      }).save();
    }

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
    userWithoutPassword.role = normalizeRole(userWithoutPassword.role);
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

// 删除云端图片
app.delete('/api/upload/cover', authMiddleware, async (req, res) => {
    try {
        const { url } = req.body;
        
        // 1. 拦截空数据或非 Cloudinary 链接
        if (!url || !url.includes('cloudinary.com')) {
            return res.status(400).json({ error: '无效的图片 URL' });
        }

        // 2. 提取 Cloudinary 的 public_id
        // 典型的 URL 格式: https://res.cloudinary.com/xxx/image/upload/v1700000000/novel_covers/abc123.jpg
        const urlParts = url.split('/upload/');
        if (urlParts.length !== 2) {
            return res.status(400).json({ error: '解析图片 URL 失败' });
        }
        
        // 去除版本号 (v1700000000/) 
        const pathWithoutVersion = urlParts[1].replace(/^v\d+\//, '');
        // 去除文件后缀名 (.jpg / .png)
        const publicId = pathWithoutVersion.substring(0, pathWithoutVersion.lastIndexOf('.'));

        // 3. 呼叫 Cloudinary 销毁该图片
        const result = await cloudinary.uploader.destroy(publicId);
        
        if (result.result === 'ok' || result.result === 'not found') {
            res.json({ success: true, message: '图片已从云端彻底删除' });
        } else {
            throw new Error(result.result);
        }
    } catch (error) {
        console.error('❌ 删除云端图片失败:', error);
        res.status(500).json({ error: '删除失败: ' + error.message });
    }
});


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

const sanitizeForumHtml = (input = '') => String(input)
  .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
  .replace(/javascript:/gi, '')
  .trim();

const stripHtml = (input = '') => String(input)
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const getForumActorKey = (req) => {
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

  // ✅ 修复：直接使用 req.ip 即可，配合 trust proxy，它就是最准确的真实 IP
  return `ip:${req.ip}`; 
};
const forumPostCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 15,
  message: '发帖过于频繁，请稍后再试',
  keyGenerator: getForumActorKey
});

const forumReplyCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 40,
  message: '回答提交过于频繁，请稍后再试',
  keyGenerator: getForumActorKey
});

const forumCommentCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 80,
  message: '评论提交过于频繁，请稍后再试',
  keyGenerator: getForumActorKey
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
app.get('/api/books/sitemap-pool', async (req, res) => {
    try {
        // 只查 _id 和 updatedAt，不查简介和内容，速度极快
        // limit(1000) 保证书多了也不会超时
        const books = await Book.find({})
            .select('_id updatedAt') 
            .sort({ updatedAt: -1 })
            .limit(1000); 

        res.json(books);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

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
    const chapter = await Chapter.findById(req.params.id).lean();
    if (!chapter) return res.status(404).json({ error: 'Chapter not found' });

// ================= 🔥 [修改] 改为内存记账 🔥 =================
    
    // A. 记录书籍浏览量 (只是在内存对象里 +1)
    const bookIdStr = chapter.bookId.toString();
    if (!bookViewBuffer[bookIdStr]) {
        bookViewBuffer[bookIdStr] = 0;
    }
    bookViewBuffer[bookIdStr]++; 

    // B. 记录用户浏览量
    const authHeader = req.headers['authorization'];
    if (authHeader) {
        const token = authHeader.split(' ')[1];
        if (token) {
            try {
                // 解码拿到 UserID
                const decoded = jwt.verify(token, JWT_SECRET);
                const userId = decoded.id;

                // 内存记账
                if (!userViewBuffer[userId]) {
                    userViewBuffer[userId] = 0;
                }
                userViewBuffer[userId]++;
                
            } catch (e) { /* Token 无效忽略 */ }
        }
    }
    // ==========================================================
    
    res.json({ ...chapter, id: chapter._id.toString(), bookId: chapter.bookId.toString() });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ✅ 修改：加入 checkUploadQuota
app.post('/api/chapters', authMiddleware, checkUploadQuota, async (req, res) => {
    try {
      const { bookId, title, content, chapterNumber, chapter_number } = req.body;
      const finalChapterNum = chapterNumber || chapter_number;

      // ... (中间的校验逻辑保持不变) ...
      
      const newChapter = new Chapter({
          bookId: new mongoose.Types.ObjectId(bookId),
          title: title.trim(),
          content: content.trim(),
          word_count: content.trim().length, 
          chapter_number: parseInt(finalChapterNum),
      });

      await newChapter.save();

      if (req.user.role !== 'admin') {
          await User.findByIdAndUpdate(req.user.id, {
              $inc: { 
                  daily_upload_words: req.incomingWordCount || 0,
                  'stats.today_uploads': 1, // 今日上传数 +1
                  'weekly_score': 5         // 🌟 核心：总分立刻 +5 (让你一眼看到上传狂魔)
              },
              last_upload_date: new Date()
          });
      }
            try {
          const chapterUrl = `https://jiutianxiaoshuo.com/book/${bookId}/${newChapter._id}`;
          submitToIndexNow([chapterUrl]).catch(err => console.error('IndexNow推送异常:', err));
      } catch (e) {
          console.error('IndexNow 生成URL失败:', e);
      }
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

// 添加一个新的 Cron 任务 (每天凌晨 00:05 执行)
// 在 server/index.js 的 Cron 任务部分

cron.schedule('5 0 * * *', async () => {
    console.log('🔄 [Cron] 开始归档用户活跃数据...');
    try {
        const users = await User.find({});
        
        for (const user of users) {
            // 1. 获取今日数据（如果没有则为0）
            const v = user.stats?.today_views || 0;
            const u = user.stats?.today_uploads || 0;
            const w = user.daily_upload_words || 0; // 今日字数

            // 2. 只有当用户今天有活动时，才推入 history (或者为了图表连续性，每天都推也可以)
            // 这里我们选择：保留最近 7 天的历史记录
            const newHistoryEntry = {
                date: new Date(),
                views: v,
                uploads: u
            };

            // 3. 确保 stats 对象存在
            if (!user.stats) user.stats = { history: [] };
            if (!user.stats.history) user.stats.history = [];

            // 4. 推入历史并限制长度（防止数组无限增长，只留最近30天）
            user.stats.history.push(newHistoryEntry);
            if (user.stats.history.length > 30) {
                user.stats.history.shift(); // 删掉最旧的一天
            }

            // 5. 计算活跃分 (侧重检测恶意上传)
            // 逻辑：阅读一章 1分，上传一次 50分 (上传操作权重更高，容易发现刷子)
            let totalScore = 0;
            user.stats.history.forEach(h => {
                totalScore += (h.views || 0) * 1 + (h.uploads || 0) * 50;
            });

            // 6. 重置今日数据
            user.stats.today_views = 0;
            user.stats.today_uploads = 0;
            user.daily_upload_words = 0; 
            
            user.weekly_score = totalScore;

            await user.save();
        }
        console.log(`✅ [Cron] 数据归档完成，处理了 ${users.length} 名用户`);
    } catch (error) {
        console.error('❌ [Cron] 失败:', error);
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

// ================= 🔥 [新增] 5分钟自动刷盘定时器 🔥 =================

// 设置为 5 分钟 (300000 毫秒) 执行一次
setInterval(async () => {
    // 1. 检查是否有数据需要处理
    const userIds = Object.keys(userViewBuffer);
    const bookIds = Object.keys(bookViewBuffer);

    if (userIds.length === 0 && bookIds.length === 0) return; // 没人看书，啥也不做

    console.log(`💾 [Buffer] 开始批量写入数据库... 用户更新:${userIds.length}人, 书籍更新:${bookIds.length}本`);

    // --- 🔒 锁定数据：把当前 buffer 复制出来，并立即清空全局 buffer ---
    // 这样做是为了防止在写入数据库的这几秒内，新进来的点击被弄丢或者重复计算
    const currentUsers = { ...userViewBuffer };
    const currentBooks = { ...bookViewBuffer };
    
    userViewBuffer = {}; // 立即清空，准备接收下一波
    bookViewBuffer = {}; // 立即清空

    try {
        // --- 2. 批量更新书籍 (Book) ---
        if (Object.keys(currentBooks).length > 0) {
            const bookOps = Object.keys(currentBooks).map(bookId => ({
                updateOne: {
                    filter: { _id: bookId },
                    update: { 
                        $inc: { 
                            views: currentBooks[bookId],
                            daily_views: currentBooks[bookId],
                            weekly_views: currentBooks[bookId],
                            monthly_views: currentBooks[bookId]
                        } 
                    }
                }
            }));
            await Book.bulkWrite(bookOps);
        }

        // --- 3. 批量更新用户 (User) ---
        if (Object.keys(currentUsers).length > 0) {
            const userOps = Object.keys(currentUsers).map(userId => ({
                updateOne: {
                    filter: { _id: userId },
                    update: { 
                        $inc: { 
                            'stats.today_views': currentUsers[userId],
                            'weekly_score': currentUsers[userId] // 同时也更新活跃分
                        } 
                    }
                }
            }));
            await User.bulkWrite(userOps);
        }

        console.log('✅ [Buffer] 批量写入完成！');

    } catch (err) {
        console.error('❌ [Buffer] 写入失败，数据可能丢失:', err);
        // 如果你需要非常严格的数据安全，这里可以把 currentUsers 加回 userViewBuffer
        // 但对于浏览量统计，偶尔丢一次通常可以接受，为了代码简单暂不处理回滚
    }

}, 5 * 60 * 1000); // 5分钟



app.use((err, req, res, next) => {
    if (err instanceof URIError) {
        console.warn('⚠️ URL 参数解码失败:', req.url);
        return res.status(400).json({ error: '无效的 URL 格式' });
    }
    
    console.error('❌ 服务器未捕获的错误:', err.message);
    res.status(500).json({ error: '服务器内部错误' });
});
// 👆 全局错误兜底结束

app.listen(5000, () => {
    console.log('🚀 Server running on port 5000');
});