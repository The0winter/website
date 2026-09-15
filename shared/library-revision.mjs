import {createHash} from 'node:crypto';

// All chapter writers advance writeVersion in their transaction. Include
// identity, ownership and editable metadata so those changes also invalidate
// desktop checkpoints, without invalidating them for view-count updates.
export const libraryBookFields = '_id title author sourceUrl description category status importManaged author_id author_profile_id deletedAt createdAt writeVersion';
export function libraryRevision(book) {
  if (!book) return null;
  const values = libraryBookFields.split(' ').map(key => key === 'importManaged' ? !!book[key] : key === 'writeVersion' ? book[key] ?? 0 : book[key] ?? null);
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}
