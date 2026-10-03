import crypto from 'node:crypto';
import mongoose from 'mongoose';
import ReadingPosition from '../models/ReadingPosition.js';
import ReadingPositionOperation from '../models/ReadingPositionOperation.js';
import ReadingHistory from '../models/ReadingHistory.js';
import Chapter from '../models/Chapter.js';
import {readChapterBody} from './chapter-storage.js';
import {readerParagraphs} from '../../shared/reader-paragraphs.mjs';

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
export const positionId = (userId, bookId) => `${userId}:${bookId}`.toLowerCase();
export const positionJson = row => ({
  revision: row?.revision || 0,
  position: row?.position ? {...row.position, chapterId: String(row.position.chapterId)} : null,
  furthest: row?.furthest ? {...row.furthest, chapterId: String(row.furthest.chapterId)} : null,
  deleted: row?.deleted || false,
  deviceId: row?.deviceId || null,
  updatedAt: row?.updatedAt || null,
});
function failure(status, code, message, details = {}) {
  return Object.assign(new Error(message), {status, code, details});
}
const validId = value => typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value);

export async function validateReadingAnchor(bookId, input) {
  if (!input || !validId(input.chapterId) || !/^[a-f0-9]{64}$/.test(input.contentVersion || '') ||
      !/^[a-f0-9]{16}-[1-9]\d{0,7}$/.test(input.paragraphKey || '') ||
      !Number.isSafeInteger(input.charOffset) || input.charOffset < 0) {
    throw failure(400, 'INVALID_ANCHOR', '阅读位置参数无效');
  }
  const chapter = await Chapter.findOne({_id: input.chapterId, bookId, deletedAt: null}).lean();
  if (!chapter) throw failure(404, 'CHAPTER_UNAVAILABLE', '章节不可用');
  const content = await readChapterBody(chapter);
  const contentVersion = digest(content);
  if (contentVersion !== input.contentVersion) throw failure(409, 'CONTENT_CHANGED', '章节正文已更新，请重新定位', {contentVersion});
  const paragraphs = readerParagraphs(content, chapter.title, chapter.chapter_number);
  const paragraphIndex = paragraphs.findIndex(row => row.key === input.paragraphKey);
  const text = paragraphs[paragraphIndex]?.text;
  if (text === undefined || input.charOffset > text.length ||
      (input.charOffset > 0 && /[\uD800-\uDBFF]/.test(text[input.charOffset - 1]) && /[\uDC00-\uDFFF]/.test(text[input.charOffset] || ''))) {
    throw failure(400, 'INVALID_ANCHOR', '段落或字符偏移无效');
  }
  return {chapterId: chapter._id, chapterNumber: chapter.chapter_number, contentVersion,
    paragraphKey: input.paragraphKey, paragraphIndex, charOffset: input.charOffset};
}

function isFurther(a, b) {
  if (!b) return true;
  if (a.chapterNumber !== b.chapterNumber) return a.chapterNumber > b.chapterNumber;
  if (String(a.chapterId) !== String(b.chapterId) || a.contentVersion !== b.contentVersion) return true;
  return a.paragraphIndex > b.paragraphIndex || (a.paragraphIndex === b.paragraphIndex && a.charOffset > b.charOffset);
}

export async function saveReadingPosition(userId, bookId, input, {remove = false} = {}) {
  bookId = String(bookId).toLowerCase();
  if (!Number.isSafeInteger(input.baseRevision) || input.baseRevision < 0 ||
      !/^[A-Za-z0-9_-]{16,100}$/.test(input.operationId || '') ||
      !/^[A-Za-z0-9_-]{8,100}$/.test(input.deviceId || '')) {
    throw failure(400, 'INVALID_OPERATION', '同步操作参数无效');
  }
  const operationKey = digest(`${userId}\0${input.operationId}`);
  const fingerprint = digest(JSON.stringify([bookId, remove, input.baseRevision, input.deviceId,
    input.position?.chapterId, input.position?.contentVersion, input.position?.paragraphKey, input.position?.charOffset]));
  const repeat = await ReadingPositionOperation.findById(operationKey).lean();
  if (repeat) {
    if (repeat.fingerprint !== fingerprint) throw failure(409, 'OPERATION_REUSED', '操作编号已被其他内容使用');
    return repeat.response;
  }
  const position = remove ? null : await validateReadingAnchor(bookId, input.position);
  let response;
  try {
    await mongoose.connection.transaction(async session => {
      const priorOperation = await ReadingPositionOperation.findById(operationKey).session(session).lean();
      if (priorOperation) {
        if (priorOperation.fingerprint !== fingerprint) throw failure(409, 'OPERATION_REUSED', '操作编号已被其他内容使用');
        response = priorOperation.response; return;
      }
      const id = positionId(userId, bookId);
      const current = await ReadingPosition.findById(id).session(session).lean();
      if ((current?.revision || 0) !== input.baseRevision) {
        throw failure(409, 'PROGRESS_CONFLICT', '另一设备已更新阅读进度', {current: positionJson(current)});
      }
      const now = new Date();
      const next = {_id: id, userId, bookId, revision: input.baseRevision + 1, position,
        furthest: remove ? null : isFurther(position, current?.furthest) ? position : current.furthest,
        deleted: remove, deviceId: input.deviceId, updatedAt: now};
      if (current) {
        const {_id, ...fields} = next;
        const result = await ReadingPosition.updateOne({_id: id, revision: input.baseRevision}, {$set: fields}, {session});
        if (!result.modifiedCount) throw failure(409, 'PROGRESS_CONFLICT', '阅读进度已变化，请重新读取');
      } else await ReadingPosition.create([next], {session});
      if (remove) await ReadingHistory.deleteOne({userId, bookId}, {session});
      else await ReadingHistory.updateOne({userId, bookId}, {$set: {chapterId: position.chapterId,
        lastVisitedAt: now, lastReadAt: now}}, {upsert: true, session});
      response = positionJson(next);
      await ReadingPositionOperation.create([{_id: operationKey, userId, fingerprint, response,
        expiresAt: new Date(+now + 30 * 86400000)}], {session});
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
    const saved = await ReadingPositionOperation.findById(operationKey).lean();
    if (saved?.fingerprint === fingerprint) return saved.response;
    const current = await ReadingPosition.findById(positionId(userId, bookId)).lean();
    throw failure(409, saved ? 'OPERATION_REUSED' : 'PROGRESS_CONFLICT', '同步状态已变化', {current: positionJson(current)});
  }
  return response;
}

// Legacy clients remain chapter-accurate and advance the same CAS revision. Repeated
// visits to the current chapter do not erase the newer paragraph-level location.
export async function recordLegacyReading(userId, bookId, chapterId) {
  await mongoose.connection.transaction(async session => {
    const now = new Date();
    await ReadingHistory.updateOne({userId, bookId}, {$set: {chapterId,
      lastReadAt: now, lastVisitedAt: now}}, {upsert: true, session});
    const id = positionId(userId, bookId);
    const current = await ReadingPosition.findById(id).session(session).lean();
    if (current && !current.deleted && String(current.position?.chapterId) === String(chapterId)) return;
    const chapter = await Chapter.findOne({_id: chapterId, bookId, deletedAt: null}).session(session).lean();
    if (!chapter) return;
    const position = {chapterId: chapter._id, chapterNumber: chapter.chapter_number,
      contentVersion: null, paragraphKey: null, paragraphIndex: 0, charOffset: 0};
    const fields = {userId, bookId, position, furthest: isFurther(position, current?.furthest) ? position : current.furthest,
      deleted: false, deviceId: 'legacy-web', updatedAt: new Date()};
    await ReadingPosition.updateOne({_id: id}, {$set: fields, $inc: {revision: 1}}, {upsert: true, session});
  });
}

export async function removeLegacyReading(userId, bookId) {
  await mongoose.connection.transaction(async session => {
    await ReadingHistory.deleteOne({userId, bookId}, {session});
    await ReadingPosition.updateOne({_id: positionId(userId, bookId)}, {$set: {userId, bookId,
      deleted: true, position: null, furthest: null, deviceId: 'legacy-web', updatedAt: new Date()},
      $inc: {revision: 1}}, {upsert: true, session});
  });
}
