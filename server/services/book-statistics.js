// Editorial initialization is kept separate from reader-owned records.
export function favoriteTotal(book, actual = 0) {
  return Math.max(0, actual) + Math.max(0, book.statisticsSeed?.favorites || 0);
}

export function combinedRating(book, average = 0, count = 0) {
  const seed = book.statisticsSeed;
  const weight = seed?.ratingWeight || 0;
  return weight + count ? ((seed?.rating || 0) * weight + average * count) / (weight + count) : 0;
}
