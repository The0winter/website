import crypto from 'node:crypto';
import mongoose from 'mongoose';
import Book from '../models/Book.js';
import User from '../models/User.js';
import Post from '../models/ForumPost.js';
import Reply from '../models/ForumReply.js';
import AdminLog from '../models/AdminLog.js';
import {safeHtml} from '../security.js';
import {forumExcerpt} from './forum-feed.js';
import {importedAuthor} from './author-identity.js';
import {assertCollectedReviewQuality, reviewContentKey} from '../../shared/review-quality.mjs';
import {visibleForumReplies} from './forum-curation.js';

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = message => {throw new Error(message);};
const licenses = new Map([
  ['CC BY-SA 4.0', 'https://creativecommons.org/licenses/by-sa/4.0/'],
  ['CC BY-NC-SA 4.0', 'https://creativecommons.org/licenses/by-nc-sa/4.0/'],
  ['CC BY-NC-ND 2.0', 'https://creativecommons.org/licenses/by-nc-nd/2.0/'],
]);
const label = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

export function validateForumImport(manifest) {
  const collected = manifest?.usage === 'public-collected-reviews';
  if (manifest?.version !== 1 || !['public-licensed-reviews', 'public-collected-reviews'].includes(manifest.usage) || !/^[a-z0-9-]{1,80}$/.test(manifest.batch || '')) fail('请提供明确用于公开收录的书评清单');
  if (!label(manifest.book?.title, 200) || !label(manifest.book?.author, 200) || !label(manifest.book?.description, 5000)) fail('书籍资料不完整');
  if (collected && (!/^[a-f0-9]{24}$/.test(manifest.book.id || '') || manifest.book.allowCreate)) fail('采集书评须指定已核对的现有书籍编号');
  if (!label(manifest.question?.title, 200) || !label(manifest.question?.content, 20000) || safeHtml(manifest.question.content) !== manifest.question.content) fail('问题内容无效');
  if (!Array.isArray(manifest.articles) || !manifest.articles.length || manifest.articles.length > 20) fail('每批需包含 1 至 20 篇书评');
  const ids = new Set(), urls = new Set(), bodies = new Set();
  for (const article of manifest.articles) {
    if (!/^[a-z0-9-]{1,100}$/.test(article.id || '') || ids.has(article.id) || !label(article.title, 200) || !label(article.content, 200000) || digest(article.content) !== article.sha256 || safeHtml(article.content) !== article.content) fail('文章正文、编号或校验值无效');
    const source = article.source;
    let url; try {url = new URL(source?.url);} catch {fail('原文链接无效');}
    if (!label(source?.author, 200) || !label(source.title, 200) || url.protocol !== 'https:' || url.username || url.password || urls.has(url.href)) fail('文章来源信息不完整');
    const hasLicense = source.license !== undefined || source.licenseUrl !== undefined;
    if ((!collected || hasLicense) && (!licenses.has(source.license) || licenses.get(source.license) !== source.licenseUrl)) fail('文章来源或许可信息不完整');
    if ((!collected || source.publishedAt !== undefined) && !Number.isFinite(Date.parse(source.publishedAt))) fail('原文发布时间无效');
    if (collected) {
      assertCollectedReviewQuality(article);
      const body = reviewContentKey(article.content);
      if (bodies.has(body)) fail('同一书籍的清单中存在重复书评正文');
      bodies.add(body);
    }
    ids.add(article.id); urls.add(url.href);
  }
}

// Additive, idempotent import. Existing books, answers, likes and comments are
// never overwritten. The real administrator curates the sources; no author or
// local test login is fabricated from the attribution fields.
export async function importForumArticles(manifest, {apply = false, admin} = {}) {
  validateForumImport(manifest);
  const id = key => digest(`${manifest.batch}:${key}`).slice(0, 24);
  async function inspect(session) {
    const admins = await User.find({role:'admin', isBanned:{$ne:true}, isTestAccount:{$ne:true}, ...(admin ? {username:admin} : {})}).select('_id username').limit(2).session(session).lean();
    if (admins.length !== 1) fail('需指定唯一的现有管理员');
    const actor = admins[0];
    const books = await Book.find({title:manifest.book.title, author:manifest.book.author, deletedAt:null}).limit(2).session(session).lean();
    if (books.length > 1) fail('存在重复书籍，需先核对书籍身份');
    const book = books[0];
    if (manifest.usage === 'public-collected-reviews' && (!book || String(book._id) !== manifest.book.id)) fail('书籍编号与书名作者不符，停止关联书评');
    if (book?.visibility === 'private') fail('不能将现有私密书自动公开');
    const bookId = String(book?._id || id('book')), questionId = id('question');
    if (!book && await Book.exists({_id:bookId}).session(session)) fail('书籍编号已被占用');
    const question = await Post.findById(questionId).session(session).lean();
    if (question && (String(question.bookId) !== bookId || question.type !== 'question' || question.title !== manifest.question.title || question.content !== manifest.question.content || String(question.author) !== String(actor._id))) fail('问题已被修改，停止重复导入');
    const answerIds = manifest.articles.map(article => id(`answer:${article.id}`));
    const existing = await Reply.find({_id:{$in:answerIds}}).session(session).lean();
    if (manifest.usage === 'public-collected-reviews') {
      const posts = await Post.find({bookId, type:'question'}).select('_id').session(session).lean();
      const collected = await Reply.find({postId:{$in:posts.map(row=>row._id)}, 'source.url':{$exists:true}, 'curation.status':{$ne:'withheld'}}).select('_id content source').session(session).lean();
      for (const [index, article] of manifest.articles.entries()) {
        if (existing.some(row=>String(row._id)===answerIds[index])) continue;
        if (collected.some(row=>row.source.url===article.source.url || reviewContentKey(row.content)===reviewContentKey(article.content))) fail('这本书已收录相同来源或相同正文，停止重复导入');
      }
    }
    for (const [index, article] of manifest.articles.entries()) {
      const answer = existing.find(row => String(row._id) === answerIds[index]);
      const date = value => value ? new Date(value).toISOString() : null;
      if (answer && (String(answer.postId) !== questionId || String(answer.author) !== String(actor._id) || answer.title !== article.title || answer.content !== article.content || ['title','author','url','license','licenseUrl','kind'].some(key => answer.source?.[key] !== article.source[key]) || date(answer.source?.publishedAt) !== date(article.source.publishedAt))) fail('回答已被修改，停止重复导入');
    }
    return {actor, bookId, questionId, answerIds, createBook:!book, createQuestion:!question, createAnswers:answerIds.filter(value => !existing.some(row => String(row._id) === value))};
  }
  let plan = await inspect(null);
  if (apply) await mongoose.connection.transaction(async session => {
    plan = await inspect(session);
    if (!plan.createBook && !plan.createQuestion && !plan.createAnswers.length) return;
    if (!(await User.updateOne({_id:plan.actor._id,role:'admin',isBanned:{$ne:true},isTestAccount:{$ne:true}}, {$inc:{contentVersion:1}}, {session})).matchedCount) fail('管理员状态已变化');
    if (plan.createBook) {
      const author = await importedAuthor({name:manifest.book.author, sourceKey:`forum:${manifest.batch}:book-author`}, session);
      await Book.create([{_id:plan.bookId, title:manifest.book.title, author:manifest.book.author, description:manifest.book.description, category:'科幻', status:'完结', visibility:'public', author_profile_id:author._id}], {session});
    } else if (!(await Book.updateOne({_id:plan.bookId, title:manifest.book.title, author:manifest.book.author, deletedAt:null, visibility:{$ne:'private'}}, {$inc:{writeVersion:1}}, {session})).matchedCount) fail('书籍状态已变化');
    if (plan.createQuestion) await Post.create([{_id:plan.questionId, title:manifest.question.title, content:manifest.question.content, summary:forumExcerpt(manifest.question.content), type:'question', bookId:plan.bookId, author:plan.actor._id, tags:[manifest.book.title, '读后感', '含剧透']}], {session});
    for (const [index, article] of manifest.articles.entries()) if (plan.createAnswers.includes(plan.answerIds[index])) {
      await Reply.create([{_id:plan.answerIds[index], postId:plan.questionId, author:plan.actor._id, title:article.title, content:article.content, source:article.source}], {session});
    }
    const total = await Reply.countDocuments({postId:plan.questionId,...visibleForumReplies}).session(session);
    await Post.updateOne({_id:plan.questionId}, {$set:{replyCount:total}}, {session});
    await AdminLog.create([{admin_id:plan.actor._id, action:manifest.usage === 'public-collected-reviews' ? 'import_collected_forum_articles' : 'import_licensed_forum_articles', details:JSON.stringify({batch:manifest.batch, bookId:plan.bookId, questionId:plan.questionId, answerIds:plan.createAnswers})}], {session});
  });
  return {applied:apply, batch:manifest.batch, bookId:plan.bookId, questionId:plan.questionId, answerIds:plan.answerIds, curator:plan.actor.username, created:{books:Number(plan.createBook), questions:Number(plan.createQuestion), answers:plan.createAnswers.length}};
}
