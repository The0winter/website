import crypto from 'node:crypto';
import mongoose from 'mongoose';
import Book from '../models/Book.js';
import Bookmark from '../models/Bookmark.js';
import ShelfState from '../models/ShelfState.js';
import ShelfOperation from '../models/ShelfOperation.js';
import {recordBookMilestones} from './book-milestones.js';

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const key = (userId, bookId) => `${userId}:${bookId}`.toLowerCase();
const fail = (status, code, message, details = {}) => {throw Object.assign(new Error(message), {status, code, details});};
const json = (row, added = false) => ({revision: row?.revision || 0, added: row ? row.added : added,
  updatedAt: row?.updatedAt || null, deviceId: row?.deviceId || null});

export async function readShelfState(userId, bookId) {
  const row = await ShelfState.findById(key(userId, bookId)).lean();
  return json(row, !row && !!await Bookmark.exists({user_id: userId, bookId}));
}

// Shared with the old website endpoints so statistics and milestones stay identical.
async function changeBookmark(userId, bookId, added, session) {
  const book = await Book.findOneAndUpdate({_id: bookId, ...(added ? {deletedAt: null, visibility: {$ne: 'private'}} : {})},
    {$inc: {milestoneVersion: 1}}, {session, timestamps: false});
  if (added && !book) fail(404, 'BOOK_UNAVAILABLE', '作品不可用');
  const filter = {user_id: userId, bookId};
  const favorites = book ? await Bookmark.countDocuments({bookId}).session(session) : 0;
  let bookmark = await Bookmark.findOne(filter).session(session);
  const inserted = added && !bookmark;
  if (inserted) [bookmark] = await Bookmark.create([filter], {session});
  if (book) await recordBookMilestones(book, {favorites}, added ? {favorites: favorites + Number(inserted)} : {}, session);
  if (!added) await Bookmark.deleteOne(filter, {session});
  return bookmark;
}

export async function legacyShelfChange(userId, bookId, added) {
  let bookmark;
  await mongoose.connection.transaction(async session => {
    bookmark = await changeBookmark(userId, bookId, added, session);
    await ShelfState.updateOne({_id: key(userId, bookId)}, {$set: {userId, bookId, added,
      deviceId: 'legacy-web', updatedAt: new Date()}, $inc: {revision: 1}}, {upsert: true, session});
  });
  return bookmark;
}

export async function saveShelfState(userId, bookId, input) {
  bookId = String(bookId).toLowerCase();
  if (!Number.isSafeInteger(input.baseRevision) || input.baseRevision < 0 || typeof input.added !== 'boolean' ||
      !/^[A-Za-z0-9_-]{16,100}$/.test(input.operationId || '') || !/^[A-Za-z0-9_-]{8,100}$/.test(input.deviceId || '')) {
    fail(400, 'INVALID_OPERATION', '书架同步参数无效');
  }
  const operationId = digest(`${userId}\0${input.operationId}`);
  const fingerprint = digest(JSON.stringify([bookId, input.baseRevision, input.deviceId, input.added]));
  let response;
  try {
    await mongoose.connection.transaction(async session => {
      const receipt = await ShelfOperation.findById(operationId).session(session).lean();
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) fail(409, 'OPERATION_REUSED', '操作编号已被其他内容使用');
        response = receipt.response; return;
      }
      const id = key(userId, bookId), current = await ShelfState.findById(id).session(session).lean();
      if ((current?.revision || 0) !== input.baseRevision) fail(409, 'SHELF_CONFLICT', '其他设备已修改书架', {current: json(current)});
      await changeBookmark(userId, bookId, input.added, session);
      const fields = {userId, bookId, added: input.added, revision: input.baseRevision + 1, deviceId: input.deviceId, updatedAt: new Date()};
      if (current) {
        const result = await ShelfState.updateOne({_id: id, revision: input.baseRevision}, {$set: fields}, {session});
        if (!result.modifiedCount) fail(409, 'SHELF_CONFLICT', '书架已变化，请重试');
      } else await ShelfState.create([{_id: id, ...fields}], {session});
      response = json(fields);
      await ShelfOperation.create([{_id: operationId, fingerprint, response, expiresAt: new Date(Date.now() + 30 * 86400000)}], {session});
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
    const receipt = await ShelfOperation.findById(operationId).lean();
    if (receipt?.fingerprint === fingerprint) return receipt.response;
    fail(409, receipt ? 'OPERATION_REUSED' : 'SHELF_CONFLICT', '书架状态已变化', {current: await readShelfState(userId, bookId)});
  }
  return response;
}
