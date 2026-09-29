import crypto from 'node:crypto';
import Author from '../models/Author.js';

export const normalizeAuthorName = value => String(value || '').normalize('NFKC').trim().replace(/\s+/gu, ' ');
const anonymous = new Set(['', '未知', '未知作者', '佚名', '匿名', '无名氏', 'unknown', 'anonymous']);

export function authorIdentityKey({name, sourceKey}) {
  const normalized = normalizeAuthorName(name);
  // Anonymous attribution does not identify one person across different books.
  return crypto.createHash('sha256').update(anonymous.has(normalized.toLowerCase())
    ? `source\0${sourceKey}` : `name\0${normalized}`).digest('hex');
}

export function sameImportedAuthor(profile, incoming) {
  return Boolean(profile && authorIdentityKey(profile) === authorIdentityKey(incoming));
}

export async function importedAuthor(author, session) {
  const identityKey = authorIdentityKey(author);
  let profile = await Author.findOne({identityKey}).session(session);
  if (profile) return profile;
  // Accept an unmigrated source record without changing its public ID.
  profile = await Author.findOne({sourceKey:author.sourceKey}).session(session);
  if (profile?.mergedInto) profile = await Author.findById(profile.mergedInto).session(session);
  if(profile&&!sameImportedAuthor(profile,author))throw Object.assign(new Error('作者来源与姓名不一致'),{status:409});
  if (profile) return Author.findByIdAndUpdate(profile._id, {$set:{identityKey}}, {new:true,session});
  return Author.findOneAndUpdate({identityKey}, {$setOnInsert:{...author,identityKey}}, {upsert:true,new:true,session});
}

export async function authorProfile(id) {
  const profile = await Author.findById(id).lean();
  return profile?.mergedInto ? Author.findById(profile.mergedInto).lean() : profile;
}
