import crypto from 'node:crypto';
import {chapterVolumeFields} from '../../shared/reading-cleanup.mjs';
import {libraryRevision, libraryBookFields} from '../../shared/library-revision.mjs';
import {readerParagraphs} from '../../shared/reader-paragraphs.mjs';

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const bodyHash = c => typeof c.content === 'string' ? digest(c.content) : c.contentSha256;
const volume = c => JSON.stringify([c.volume_title || null, c.volume_number || null]);
const fail = message => { throw Object.assign(Error(message), {publicMessage: message}); };
const fields = '_id bookId title chapter_number sourceUrl content contentKey contentSha256 volume_title volume_number word_count deletedAt updatedAt';
const allowed = b => b?.importManaged && !b.author_id && !b.deletedAt;

export async function inspectCleaningBook(identity, {Book, Chapter}) {
  const matches = await Book.find({sourceUrl: identity.sourceUrl}).select(libraryBookFields + ' updatedAt').limit(2).lean();
  const book = matches[0];
  if (matches.length !== 1 || !allowed(book) || book.title !== identity.title || book.author.normalize('NFKC').trim() !== identity.author.normalize('NFKC').trim()) fail('清理作品身份不唯一或归属不允许修订');
  const chapters = await Chapter.find({bookId: book._id, deletedAt: null}).select(fields).sort({chapter_number: 1}).lean();
  const after = await Book.findById(book._id).select(libraryBookFields).lean();
  if (libraryRevision(book) !== libraryRevision(after)) fail('核对期间书籍发生变化，请重新核对');
  return {bookId: String(book._id), token: libraryRevision(book), chapters: chapters.map(c => ({id: String(c._id), number: c.chapter_number, title: c.title, link: c.sourceUrl, hash: bodyHash(c), ...chapterVolumeFields(c)}))};
}

export async function reviseCleaningBatch(job, deps) {
  const {mongoose, Book, Chapter, ParagraphComment, readBody, storeBodies, writeBackup} = deps;
  if (!/^[a-zA-Z0-9-]{1,100}$/u.test(job.runId || '') || !Array.isArray(job.chapters) || !job.chapters.length || job.chapters.length > 200) fail('修订批次参数无效');
  if (new Set(job.chapters.map(c=>c.id)).size !== job.chapters.length) fail('修订批次含重复章节');
  for (const c of job.chapters) {
    if (!/^[a-f0-9]{24}$/u.test(c.id || '') || !/^[a-f0-9]{64}$/u.test(c.beforeHash || '') || typeof c.content !== 'string' || !c.content.trim() || c.content.length > 60000) fail('修订正文或原文哈希无效');
    chapterVolumeFields(c);
  }
  async function inspect(session = null) {
    const book = await Book.findById(job.bookId).session(session).lean();
    if (!allowed(book) || book.title !== job.title || book.sourceUrl !== job.sourceUrl || libraryRevision(book) !== job.token) fail('书籍版本或归属已变化，暂停修订');
    const rows = await Chapter.find({_id: {$in: job.chapters.map(c=>c.id)}, bookId: book._id}).select(fields).session(session).lean();
    const old = new Map(rows.map(c=>[String(c._id),c]));
    for (const c of job.chapters) {
      const prior = old.get(c.id);
      if (!prior || prior.deletedAt || prior.title !== c.title || prior.chapter_number !== c.number || prior.sourceUrl && c.link && prior.sourceUrl !== c.link || bodyHash(prior) !== c.beforeHash || volume(prior) !== volume(c.beforeVolume || {})) fail('章节原文、卷信息或身份已变化：' + c.number);
    }
    return {book, old};
  }
  const checked = await inspect(), commentMoves = [];
  // Most books have no paragraph comments. Only affected annotated chapters
  // require old R2 reads. Never silently orphan a comment on removed text.
  const comments = await ParagraphComment.find({chapter: {$in: job.chapters.map(c=>c.id)}}).lean();
  for (const c of job.chapters) {
    const attached = comments.filter(row=>String(row.chapter) === c.id);
    if (!attached.length) continue;
    const oldParagraphs = readerParagraphs(await readBody(checked.old.get(c.id)), c.title, c.number);
    const nextParagraphs = readerParagraphs(c.content, c.title, c.number);
    for (const comment of attached) {
      if (!oldParagraphs.some(p=>p.key === comment.paragraphKey && p.text === comment.paragraphText)) fail('存在未能定位的历史段落评论，需单独核对：' + c.number);
      let target = nextParagraphs.find(p=>p.key === comment.paragraphKey && p.text === comment.paragraphText);
      if (!target) {
        const matches = nextParagraphs.filter(p=>p.text === comment.paragraphText);
        if (matches.length !== 1) fail('清理会影响段落评论定位，已保留原章：' + c.number);
        target = matches[0];
      }
      if (target.key !== comment.paragraphKey) commentMoves.push({id: String(comment._id), before: comment.paragraphKey, after: target.key});
    }
  }
  const backup = {version: 1, runId: job.runId, bookId: job.bookId, token: job.token,
    createdAt: new Date().toISOString(), before: [...checked.old.values()], commentMoves,
    after: job.chapters.map(c=>({id: c.id, hash: digest(c.content), ...chapterVolumeFields(c)}))};
  if (job.preview) return {preview: true, chapters: job.chapters.length, comments: comments.length};
  const backupFile = await writeBackup(backup);
  // Volume-only revisions reuse the old verified reference; body revisions are
  // written to immutable keys and read back before any database changes.
  const changed = job.chapters.filter(c=>digest(c.content) !== c.beforeHash);
  const stored = new Map((await storeBodies(changed)).map(c=>[c.id,c]));
  let result;
  await mongoose.connection.transaction(async session => {
    // D1 otherwise performs a remote read for every updateOne. Prefetch the
    // bounded batch inside this transaction; its revision guard still applies.
    if (session.prefetch) await Promise.all([
      session.prefetch(Chapter.collection.name, {_id: {$in: job.chapters.map(c=>c.id)}, bookId: job.bookId}),
      session.prefetch(Book.collection.name, {_id: job.bookId}),
    ]);
    const current = await inspect(session);
    const book = await Book.findOneAndUpdate({_id: current.book._id, importManaged: true, author_id: null, deletedAt: null}, {$inc: {writeVersion: 1}}, {new: true, session, timestamps: false});
    if (!book) fail('无法锁定修订作品');
    // A new comment arriving after preflight must be reviewed before committing.
    const nowComments = await ParagraphComment.find({chapter: {$in: job.chapters.map(c=>c.id)}}).session(session).lean();
    const signature = list => digest(JSON.stringify(list.map(c=>[String(c._id),c.paragraphKey,c.paragraphText]).sort((a,b)=>a[0].localeCompare(b[0]))));
    if (signature(nowComments) !== signature(comments)) fail('修订期间段落评论发生变化，请重新核对');
    for (const c of job.chapters) {
      const prepared = stored.get(c.id), set = {word_count: c.content.length, ...chapterVolumeFields(c)}, unset = {};
      if (prepared) {
        if (prepared.contentKey) { Object.assign(set, {contentKey: prepared.contentKey, contentSha256: prepared.contentSha256}); unset.content = 1; }
        else { set.content = c.content; unset.contentKey = 1; unset.contentSha256 = 1; }
      }
      for (const field of ['volume_title', 'volume_number']) if (c[field] === undefined) unset[field] = 1;
      await Chapter.updateOne({_id: c.id, bookId: book._id}, {$set: set, ...(Object.keys(unset).length ? {$unset: unset} : {})}, {session, timestamps: false});
    }
    for (const move of commentMoves) await ParagraphComment.updateOne({_id: move.id, paragraphKey: move.before}, {$set: {paragraphKey: move.after}}, {session, timestamps: false});
    result = {bookId: job.bookId, updated: job.chapters.length, bodyUpdates: changed.length, token: libraryRevision(book), backupFile};
  });
  return result;
}

export async function restoreCleaningBackup(backup, {mongoose, Book, Chapter, ParagraphComment}) {
  if (backup.version !== 1 || !Array.isArray(backup.before) || !Array.isArray(backup.after) || backup.before.length !== backup.after.length) fail('恢复清单无效');
  return mongoose.connection.transaction(async session => {
    const book = await Book.findById(backup.bookId).session(session).lean();
    if (!allowed(book)) fail('作品归属已变化，暂停恢复');
    for (const original of backup.before) {
      const id = String(original._id), expected = backup.after.find(c=>c.id===id);
      const current = await Chapter.findOne({_id: id, bookId: backup.bookId}).session(session).lean();
      if (!current || !expected || current.deletedAt || bodyHash(current) !== expected.hash || volume(current) !== volume(expected) || current.title !== original.title || current.chapter_number !== original.chapter_number) fail('恢复目标已发生新的修改，保留当前版本');
    }
    await Book.updateOne({_id: book._id}, {$inc: {writeVersion: 1}}, {session, timestamps: false});
    for (const original of backup.before) {
      const set = {}, unset = {};
      for (const field of ['content', 'contentKey', 'contentSha256', 'volume_title', 'volume_number', 'word_count']) {
        if (original[field] === undefined) unset[field] = 1; else set[field] = original[field];
      }
      await Chapter.updateOne({_id: original._id, bookId: book._id}, {$set: set, $unset: unset}, {session, timestamps: false});
    }
    for (const move of backup.commentMoves || []) {
      const result = await ParagraphComment.updateOne({_id: move.id, paragraphKey: move.after}, {$set: {paragraphKey: move.before}}, {session, timestamps: false});
      if (result.matchedCount !== 1) fail('段落评论已变化，暂停恢复');
    }
    return {restored: backup.before.length};
  });
}
