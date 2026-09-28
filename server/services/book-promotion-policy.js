import collection from '../data/douban-chinese-top100.json' with {type: 'json'};

// Match both title and author: unrelated works sharing a title stay eligible.
// The registry includes the verified publication titles and traditional aliases.
const identities = collection.books.map(book => ({title: {$in: book.titles}, author: {$in: book.authors}}));
export const homeRecommendationFilter = {$nor: identities};

export function isDoubanChineseTop100(book) {
  return collection.books.some(row => row.titles.includes(book.title) && row.authors.includes(book.author));
}

const DAY = 86400000;
export function promotionWindow(book) {
  if (!isDoubanChineseTop100(book)) return null;
  // Imported works are created on first publication. An old initialization
  // timestamp is only a fallback; late repairs must not renew the window.
  // Never use updatedAt: uploads, covers and restoring a book do not restart it.
  const start = new Date(book.createdAt || book.statisticsSeed?.initializedAt).getTime();
  if (!Number.isFinite(start)) return {expiresAt: 0, lastDay: ''};
  const firstDay = new Date(start + 8 * 3600000).toISOString().slice(0, 10);
  return {expiresAt: start + 3 * DAY,
    lastDay: new Date(Date.parse(firstDay + 'T00:00:00Z') + 2 * DAY).toISOString().slice(0, 10)};
}

export function allowsAutomaticStatistics(book, now = new Date()) {
  const window = promotionWindow(book);
  return !window || +now < window.expiresAt;
}
