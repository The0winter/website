import mongoose from 'mongoose';
import Chapter from '../models/Chapter.js';
import ChapterDraft from '../models/ChapterDraft.js';
import ChapterRead from '../models/ChapterRead.js';
import ParagraphComment from '../models/ParagraphComment.js';
import ReadingHistory from '../models/ReadingHistory.js';
import WriterDraft from '../models/WriterDraft.js';
import WriterDiscard from '../models/WriterDiscard.js';
import WriterPublication from '../models/WriterPublication.js';
import WriterBlob from '../models/WriterBlob.js';
import Manuscript from '../models/Manuscript.js';
import User from '../models/User.js';
import {fail, lockBook} from './content.js';

export const TRASH_DAYS = 7;
export const trashDeadline = now => new Date(now.getTime() + TRASH_DAYS * 86400000);

async function clearLegacyDraft(owner, work, draftId, session) {
  if (/^manuscript-\d+$/.test(draftId) && work.startsWith('m_')) {
    const index = Number(draftId.slice(11));
    await Manuscript.updateOne({_id: `${owner}:${work.slice(2)}`, [`chapters.${index}`]: {$exists: true}}, {$set: {[`chapters.${index}`]: {}}, $inc: {revision: 1}, $unset: {savedHash: 1}}, {session});
  }
  if (/^legacy-[a-f0-9]{24}$/.test(draftId)) await ChapterDraft.deleteOne({_id: draftId.slice(7), owner}, {session});
}

export async function moveDraftToTrash(draft, session, now = new Date()) {
  if (!draft.deleted) {
    draft.deleted = true; draft.deletedAt = now; draft.trashUntil = trashDeadline(now);
    draft.revision++; draft.savedHash = undefined;
    await draft.save({session});
  }
  return draft;
}

export async function trashChapter(actor, id, {restore = false, now = new Date()} = {}) {
  let result;
  await mongoose.connection.transaction(async session => {
    const chapter = await Chapter.findById(id).session(session);
    if (!chapter) fail(404, '章节不存在或已过期清除');
    await lockBook(chapter.bookId, actor, session);
    if (restore) {
      if (chapter.deletedAt && chapter.trashUntil && chapter.trashUntil <= now) fail(410, '已超过七天恢复期限');
      if (chapter.deletedAt) {chapter.deletedAt = null; chapter.trashUntil = undefined; await chapter.save({session});}
    } else if (!chapter.deletedAt) {
      chapter.deletedAt = now; chapter.trashUntil = trashDeadline(now); await chapter.save({session});
    }
    result = chapter;
  });
  return result;
}

export async function purgeExpiredWritingTrash(now = new Date(), limit = 100) {
  // D1's sparse expiry indexes require the existence predicate explicitly;
  // otherwise this minute-by-minute task scans all live chapters and drafts.
  const expired = {$exists: true, $lte: now};
  const drafts = await WriterDraft.find({deleted: true, trashUntil: expired}).select('_id').sort({trashUntil: 1}).limit(limit).lean();
  let purgedDrafts = 0, purgedChapters = 0;
  for (const row of drafts) {
    const removed = await mongoose.connection.transaction(async session => {
      const draft = await WriterDraft.findOne({_id: row._id, deleted: true, trashUntil: expired}).session(session);
      if (!draft) return false;
      await User.updateOne({_id: draft.owner}, {$inc: {contentVersion: 1}}, {session});
      await WriterDiscard.updateOne({_id: draft._id}, {$setOnInsert: {owner: draft.owner, work: draft.work, draftId: draft.draftId, removedAt: now}}, {session, upsert: true});
      // Keep legacy array positions stable while removing the original title/body.
      await clearLegacyDraft(draft.owner, draft.work, draft.draftId, session);
      if (draft.contentKey) await WriterBlob.updateOne({_id: draft.contentKey}, {$set: {retireAt: now}}, {session});
      await WriterDraft.deleteOne({_id: draft._id}, {session});
      return true;
    });
    if (removed) purgedDrafts++;
  }
  const chapters = await Chapter.find({deletedAt: {$ne: null}, trashUntil: expired}).select('_id').sort({trashUntil: 1}).limit(limit).lean();
  for (const row of chapters) {
    const removed = await mongoose.connection.transaction(async session => {
      const chapter = await Chapter.findOne({_id: row._id, deletedAt: {$ne: null}, trashUntil: expired}).session(session);
      if (!chapter) return false;
      await ParagraphComment.deleteMany({chapter: chapter._id}, {session});
      await ChapterRead.deleteOne({_id: chapter._id}, {session});
      await ReadingHistory.updateMany({chapterId: chapter._id}, {$unset: {chapterId: 1}}, {session});
      // Publication receipts contain no text and remain as protection against delayed retries.
      for (const receipt of await WriterPublication.find({chapterId: chapter._id}).session(session)) {
        await clearLegacyDraft(receipt.owner, receipt.work, receipt.draftId, session);
        await WriterDraft.deleteOne({_id: receipt._id, published: true}, {session});
      }
      await ChapterDraft.deleteMany({publishedChapterId: chapter._id}, {session});
      await Chapter.deleteOne({_id: chapter._id}, {session});
      return true;
    });
    if (removed) purgedChapters++;
  }
  return {purgedDrafts, purgedChapters};
}
