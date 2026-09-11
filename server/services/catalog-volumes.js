import Chapter from '../models/Chapter.js';
import {buildCatalogVolumes} from '../../shared/catalog-volumes.mjs';

// Cache only the compact volume boundaries, never chapter bodies or the full
// title list. A publication revision invalidates both windows and boundaries.
const cache = new Map();
export function catalogVolumes(bookId, version, total) {
  const key = `${bookId}:${version}:${total}`;
  const found = cache.get(key);
  if (found && found.expires > Date.now()) return found.promise;
  const promise = Chapter.find({bookId, deletedAt: null}).select('_id title')
    .sort({chapter_number: 1}).maxTimeMS(3000).lean().then(buildCatalogVolumes);
  const entry = {promise, expires: Date.now() + 60000};
  cache.delete(key); cache.set(key, entry);
  while (cache.size > 64) cache.delete(cache.keys().next().value);
  promise.catch(() => {if (cache.get(key) === entry) cache.delete(key);});
  return promise;
}
