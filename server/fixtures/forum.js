import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import mongoose from 'mongoose';
import Book from '../models/Book.js';
import User from '../models/User.js';
import Post from '../models/ForumPost.js';
import Reply from '../models/ForumReply.js';
import {safeHtml} from '../security.js';
import {forumExcerpt} from '../services/forum-feed.js';

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const localRoot = fileURLToPath(new URL('../../.runtime/test-tmp/', import.meta.url));

// Only a disposable local SQLite database accepts this fixture. Source texts
// stay in the ignored task directory and are never bundled with the website.
export async function seedForumFixture(manifest, config) {
  const uri = mongoose.connection._connectionString || '';
  const filename = uri.startsWith('sqlite:') ? fileURLToPath(uri.replace(/^sqlite:/, 'file:')) : '';
  const relative = filename ? path.relative(localRoot, filename) : '..';
  if (!['development', 'test'].includes(config.mode) || uri !== config.uri || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('论坛测试素材只能导入项目内的本地隔离数据库');
  if (manifest.version !== 1 || manifest.usage !== 'local-noncommercial-test' || !/^[a-z0-9-]+$/.test(manifest.batch || '') || !manifest.articles?.length) throw new Error('论坛素材清单无效');
  const ids = new Set();
  for (const article of manifest.articles) {
    if (!article.id || ids.has(article.id) || typeof article.content !== 'string' || digest(article.content) !== article.sha256 || safeHtml(article.content) !== article.content) throw new Error('文章正文或校验值无效');
    ids.add(article.id);
    const source = article.source;
    if (!article.title || !source?.author || !source.title || !source.license || !/^https:\/\//.test(source.url || '') || !/^https:\/\/creativecommons\.org\/licenses\//.test(source.licenseUrl || '') || !Number.isFinite(Date.parse(source.publishedAt))) throw new Error('文章来源或许可信息不完整');
  }
  const id = key => digest(`${manifest.batch}:${key}`).slice(0, 24);
  const authorId = id('curator'), bookId = id('book'), questionId = id('question');
  const answerIds = manifest.articles.map(article => id(`answer:${article.id}`));
  await mongoose.connection.transaction(async session => {
    await User.updateOne({_id:authorId}, {$setOnInsert:{username:`书评资料整理 · ${manifest.batch}`, email:`${manifest.batch}@example.test`, password:digest(crypto.randomBytes(48)), isTestAccount:true, testBatch:manifest.batch}}, {upsert:true, session});
    await Book.updateOne({_id:bookId}, {$setOnInsert:{...manifest.book, category:'科幻', status:'完结', visibility:'public'}}, {upsert:true, session});
    await Post.updateOne({_id:questionId}, {$setOnInsert:{title:manifest.question.title, content:safeHtml(manifest.question.content), summary:forumExcerpt(manifest.question.content), type:'question', bookId, author:authorId, tags:[manifest.book.title, '读后感', '含剧透']}}, {upsert:true, session});
    for (const [index, article] of manifest.articles.entries()) {
      await Reply.updateOne({_id:answerIds[index]}, {$setOnInsert:{postId:questionId, author:authorId, title:article.title, content:article.content, source:article.source}}, {upsert:true, session});
    }
    const total = await Reply.countDocuments({postId:questionId}).session(session);
    await Post.updateOne({_id:questionId}, {$set:{replyCount:total}}, {session});
  });
  return {bookId, questionId, answerIds, articles:manifest.articles.length};
}
