import mongoose from 'mongoose';

// Scope entries to the actual database handle (also changes on reconnect).
// No timer expiry: writers advance Book.writeVersion in the same transaction.
// Bound retained memory and share in-flight work between concurrent readers.
export function versionedBookCache(load, sizeOf, {maxEntries = 128, maxBytes = 16 * 1024 * 1024} = {}) {
  const databases = new WeakMap();
  return (bookId, version) => {
    const db = mongoose.connection.db;
    let cache = databases.get(db);
    if (!cache) {cache = new Map(); databases.set(db, cache);}
    const key = String(bookId), revision = String(version ?? 0);
    const found = cache.get(key);
    if (found?.version === revision) {
      cache.delete(key); cache.set(key, found); return found.promise;
    }
    const entry = {version: revision, bytes: 0, promise: null};
    entry.promise = Promise.resolve().then(() => load(bookId, revision)).then(value => {
      entry.bytes = sizeOf(value);
      if (entry.bytes > maxBytes) {
        if (cache.get(key) === entry) cache.delete(key);
        return value;
      }
      let bytes = [...cache.values()].reduce((sum, item) => sum + item.bytes, 0);
      while (cache.size > maxEntries || bytes > maxBytes) {
        const oldest = cache.keys().next().value;
        bytes -= cache.get(oldest).bytes; cache.delete(oldest);
      }
      return value;
    }).catch(error => {if (cache.get(key) === entry) cache.delete(key); throw error;});
    cache.delete(key); cache.set(key, entry);
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
    return entry.promise;
  };
}
