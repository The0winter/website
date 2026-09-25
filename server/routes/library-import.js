import mongoose from 'mongoose';
import {recordBookUpdate} from '../services/book-update-time.js';
import Author from '../models/Author.js';
import Book from '../models/Book.js';
import {ensureBookStatistics} from '../services/initial-book-statistics.js';
import Chapter from '../models/Chapter.js';
import {asyncRoute} from '../security.js';
import {fail, validateChapter, lockBook} from '../services/content.js';
import {importMetadata} from '../services/import-metadata.js';
import {validImportCredential} from '../services/import-auth.js';
import {chapterBodyMatches, storeChapterBodies} from '../services/chapter-storage.js';
import {libraryRevision} from '../../shared/library-revision.mjs';

const normalize = value => String(value || '').normalize('NFKC').trim();

// The desktop explicitly requests missing-only imports. Legacy import clients
// retain their existing route (including cover and source-link enrichment).
export function libraryImportRoutes(app) {
  app.post('/api/admin/upload-book', (req, res, next) => req.body?.missingOnly === true ? next() : next('route'), asyncRoute(async (req, res) => {
    if (!validImportCredential(req)) fail(403, '导入凭据无效');
    const data = req.body;
    if (typeof data.sourceUrl !== 'string' || typeof data.title !== 'string' || !data.title.trim() || data.title.length > 200 ||
        !Array.isArray(data.chapters) || data.chapters.length > 200) fail(400, '导入需稳定来源、书名及最多200章');
    if (data.dryRun !== undefined && typeof data.dryRun !== 'boolean') fail(400, 'dryRun 必须为布尔值');
    if (data.cover_image !== undefined) fail(400, '书库增量上传不修改封面');
    const {author, metadata} = importMetadata(data);
    const chapters = data.chapters.map(chapter => {
      if (!chapter || typeof chapter !== 'object') fail(400, '章节无效');
      const validated = validateChapter(chapter), sourceUrl = chapter.link ?? chapter.sourceUrl;
      if (sourceUrl !== undefined) {
        if (typeof sourceUrl !== 'string' || sourceUrl.length > 2000 || !/^https?:\/\//.test(sourceUrl)) fail(400, '章节来源链接无效');
        validated.sourceUrl = sourceUrl;
      }
      return validated;
    });
    const numbers = chapters.map(chapter => chapter.chapter_number);
    if (new Set(numbers).size !== numbers.length) fail(409, '批次内存在重复章号');

    async function inspect(session = null) {
      const book = await Book.findOne({sourceUrl: data.sourceUrl}).session(session);
      if (book) {
        if (!book.importManaged || book.author_id || book.deletedAt) fail(409, '来源作品已下架或归属不允许自动导入');
        if (normalize(book.title) !== normalize(data.title) || normalize(book.author) !== author.name) fail(409, '网站书籍身份与本地文件不一致');
        if (book.author_profile_id) {
          const profile = await Author.findById(book.author_profile_id).session(session);
          if (!profile || profile.sourceKey !== author.sourceKey) fail(409, '作者来源发生变化，需要明确核实');
        }
      } else if (await Book.exists({title: data.title, author: author.name}).session(session)) fail(409, '网站已有同名同作者的其他来源版本');
      const existing = book && numbers.length ? await Chapter.find({bookId: book._id, chapter_number: {$in: numbers}}).session(session).lean() : [];
      const byNumber = new Map(existing.map(chapter => [chapter.chapter_number, chapter]));
      const missing = [];
      for (const chapter of chapters) {
        const old = byNumber.get(chapter.chapter_number);
        if (!old) { missing.push(chapter); continue; }
        if (old.deletedAt || old.title !== chapter.title || !chapterBodyMatches(old, chapter.content) ||
            (old.sourceUrl && chapter.sourceUrl && old.sourceUrl !== chapter.sourceUrl)) fail(409, `章号 ${chapter.chapter_number} 已下架或内容冲突，已保留网站原章节`);
      }
      return {book, missing};
    }

    // Validate all overlaps before any object writes. Retried requests skip
    // chapters already committed, including their R2 PUT and readback.
    const checked = await inspect();
    if (data.dryRun) return res.json({dryRun: true, newBook: !checked.book, bookId: checked.book && String(checked.book._id), inserted: checked.missing.length, unchanged: chapters.length - checked.missing.length});
    const prepared = process.env.CHAPTER_STORAGE === 'r2' ? await storeChapterBodies(checked.missing) : checked.missing;
    const bodies = new Map(prepared.map(chapter => [chapter.chapter_number, chapter]));
    let result;
    await mongoose.connection.transaction(async session => {
      const current = await inspect(session);
      let book = current.book;
      const previousToken = libraryRevision(book);
      if (!book) [book] = await Book.create([{title: data.title, author: author.name, sourceUrl: data.sourceUrl, importManaged: true, category: data.category || '未分类'}], {session});
      else book = await lockBook(book._id, {role: 'import'}, session);
      const profile = await Author.findOneAndUpdate({sourceKey: author.sourceKey}, {$setOnInsert: author}, {upsert: true, new: true, session});
      Object.assign(book, metadata, {author: profile.name, author_profile_id: profile._id});
      await book.save({session});
      await ensureBookStatistics(book,{session});
      const inserts = current.missing.map(chapter => {
        const preparedChapter = bodies.get(chapter.chapter_number);
        if (!preparedChapter) fail(409, '核对期间网站章节发生变化，请重新上传');
        return {...preparedChapter, bookId: book._id};
      });
      // insertMany bypasses save hooks: R2 references are already written and
      // verified above. Schema validation and the unique chapter index remain.
      if (inserts.length) {
        await Chapter.insertMany(inserts, {session, ordered: true});
        await recordBookUpdate(book._id, session);
      }
      result = {bookId: String(book._id), inserted: inserts.length, unchanged: chapters.length - inserts.length, enriched: 0,
        previousToken, token: libraryRevision(book)};
    });
    res.json(result);
  }));
}
