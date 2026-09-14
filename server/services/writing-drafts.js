import {diffChars} from 'diff';
import mongoose from 'mongoose';
import WriterDraft from '../models/WriterDraft.js';
import WriterBlob from '../models/WriterBlob.js';
import User from '../models/User.js';
import Chapter from '../models/Chapter.js';
import WriterDiscard from '../models/WriterDiscard.js';
import {moveDraftToTrash} from './writing-trash.js';
import {bodyHash} from './r2.js';
import {contentHash, dayKey, fail} from './content.js';

export const draftKey = (actor, work, id) => `${actor.id}:${work}:${id}`;
export function draftData(body) {
  if (!body || typeof body.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(body.id) ||
      typeof body.title !== 'string' || body.title.length > 100 || typeof body.content !== 'string' || body.content.length > 60000 ||
      !Number.isSafeInteger(body.number) || body.number < 1 || !Number.isSafeInteger(body.revision) || body.revision < 0 ||
      (body.targetChapterId && !/^[a-f0-9]{24}$/.test(body.targetChapterId)) ||
      (body.baseUpdatedAt !== undefined && (typeof body.baseUpdatedAt !== 'string' || body.baseUpdatedAt.length > 40)) ||
      (body.legacyBaseHash !== undefined && !/^[a-f0-9]{64}$/.test(body.legacyBaseHash)) ||
      (body.deleted !== undefined && typeof body.deleted !== 'boolean')) fail(400, '草稿参数无效');
  return {id: body.id, title: body.title, content: body.deleted ? '' : body.content, number: body.number,
    targetChapterId: body.targetChapterId || undefined, baseUpdatedAt: body.baseUpdatedAt,
    legacyBaseHash: body.legacyBaseHash, deleted: Boolean(body.deleted)};
}
export function insertedCharacters(before, after) {
  if (before === after || !after) return 0;
  if (!before) return Array.from(after).length;
  const changes = diffChars(before, after, {timeout: 250});
  if (!changes) fail(422, '本次修改跨度过大，请分段保存；当前文字仍保留');
  return changes.reduce((sum, change) => sum + (change.added ? change.count : 0), 0);
}
export function draftJson(row, content) {
  return {id: row.draftId, title: row.title, number: row.number, words: row.words, cloudRevision: row.revision,
    content: content ?? '', contentLoaded: content !== undefined, updatedAt: row.updatedAt,
    targetChapterId: row.targetChapterId ? String(row.targetChapterId) : undefined,
    baseUpdatedAt: row.baseUpdatedAt, legacyBaseHash: row.legacyBaseHash, deleted: row.deleted, published: row.published,
    deletedAt: row.deletedAt, trashUntil: row.trashUntil};
}
export async function chargeDraftQuota(actor, words, session) {
  if (!words) return;
  const user = await User.findById(actor.id).session(session);
  if (!user || user.isBanned) fail(403, '账户不可用');
  const today = dayKey(), used = user.uploadDay === today ? user.daily_upload_words || 0 : 0;
  if (used + words > 100000) fail(429, `今日还可新增 ${Math.max(0, 100000 - used)} 字，本次新增 ${words} 字；删除不会返还额度`);
  user.uploadDay = today; user.daily_upload_words = used + words; user.last_upload_date = new Date();
  await user.save({session});
}

export async function saveCloudDraft({actor, reference, body, resolve, storage}) {
  const data = draftData(body), hash = contentHash(data);
  let result, uploaded, baselineCache;
  await mongoose.connection.transaction(async session => {
    // Serialize every work/device against the same account and daily quota.
    await User.updateOne({_id: actor.id}, {$inc: {contentVersion: 1}}, {session});
    const {work, book} = await resolve(reference, actor, session);
    const key = draftKey(actor, work, data.id);
    if (await WriterDiscard.exists({_id: key}).session(session)) fail(410, '此草稿已过期清除，不能从旧设备重新同步');
    let draft = await WriterDraft.findById(key).session(session);
    if (draft?.published) fail(409, '此草稿已经发布，请重新打开已发布章节后修改');
    if (draft?.deleted && data.deleted) {result = draft; return;}
    if (draft?.savedHash === hash) {result = draft; return;}
    if ((draft?.revision || 0) !== body.revision) fail(409, '此草稿已在另一页面更新或删除。你的文字仍保留，请下载备份后重新打开核对。');
    if (data.deleted) {
      if (!draft) fail(409, '请先保存草稿再删除，以便在回收站保留正文');
      result = await moveDraftToTrash(draft, session); return;
    }
    if (draft?.deleted && !data.deleted) fail(409, '此草稿已经删除，请新建草稿后恢复文字');
    let baseline = '';
    if (draft) {
      if (String(draft.targetChapterId || '') !== (data.targetChapterId || '') || draft.baseUpdatedAt !== data.baseUpdatedAt) fail(409, '草稿对应的原章节不能更换');
      if (baselineCache?.key === draft.contentKey) baseline = baselineCache.content;
      else {baseline = await storage.read(draft); baselineCache = {key: draft.contentKey, content: baseline};}
    } else if (data.targetChapterId) {
      const chapter = book && await Chapter.findOne({_id: data.targetChapterId, bookId: book._id, deletedAt: null}).session(session);
      if (!chapter || chapter.chapter_number !== data.number || chapter.updatedAt.toISOString() !== data.baseUpdatedAt) fail(409, '原章节已更新或不存在，请重新打开；当前文字仍保留');
      baseline = typeof chapter.content === 'string' ? chapter.content : await storage.readChapter(chapter);
    }
    await chargeDraftQuota(actor, insertedCharacters(baseline, data.content), session);
    const sameBody = draft && draft.contentSha256 === bodyHash(data.content);
    let blob = sameBody ? {contentKey: draft.contentKey, contentSha256: draft.contentSha256} : {};
    if (!sameBody && data.content) {
      if (!uploaded) {
        const contentKey = storage.key(actor.id);
        // Keep the cleanup receipt outside the transaction so a crash/rollback cannot orphan the upload.
        await WriterBlob.create({_id: contentKey, retireAt: new Date(Date.now() + 3600000)});
        const contentSha256 = await storage.write(contentKey, data.content);
        uploaded = {contentKey, contentSha256};
      }
      blob = uploaded;
      await WriterBlob.updateOne({_id: blob.contentKey}, {$set: {retireAt: null}}, {session});
    }
    if (draft?.contentKey && draft.contentKey !== blob.contentKey)
      await WriterBlob.updateOne({_id: draft.contentKey}, {$set: {retireAt: new Date(Date.now() + 300000)}}, {session});
    draft ||= new WriterDraft({_id: key, owner: actor.id, work, draftId: data.id});
    Object.assign(draft, data, {contentKey: blob.contentKey, contentSha256: blob.contentSha256,
      words: Array.from(data.content).length, revision: draft.revision + 1, savedHash: hash});
    result = await draft.save({session});
  });
  return draftJson(result, data.deleted ? undefined : data.content);
}

export async function retireWorkspaceDrafts(owner, work, session) {
  const drafts = await WriterDraft.find({owner, work, deleted: false}).session(session);
  await WriterBlob.updateMany({_id: {$in: drafts.map(d => d.contentKey).filter(Boolean)}}, {$set: {retireAt: new Date(Date.now() + 300000)}}, {session});
  await WriterDraft.updateMany({owner, work}, {$set: {deleted: true, words: 0}, $unset: {contentKey: 1, contentSha256: 1, savedHash: 1}, $inc: {revision: 1}}, {session});
}

export async function cleanupDraftObjects(storage, now = new Date()) {
  let cleaned = 0;
  for (let i = 0; i < 200; i++) {
    const blob = await WriterBlob.findOneAndUpdate({retireAt: {$ne: null, $lte: now}}, {$set: {retireAt: new Date(now.getTime() + 900000)}});
    if (!blob) break;
    if (await WriterDraft.exists({contentKey: blob._id})) {
      await WriterBlob.updateOne({_id: blob._id}, {$set: {retireAt: null}}); continue;
    }
    await storage.remove(blob._id);
    await WriterBlob.deleteOne({_id: blob._id}); cleaned++;
  }
  return cleaned;
}
