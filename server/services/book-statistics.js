// Editorial initialization is kept separate from reader-owned records.
export function favoriteTotal(book, actual = 0) {
  return Math.max(0, actual) + Math.max(0, book.statisticsSeed?.favorites || 0);
}

export function combinedRating(book, average = 0, count = 0) {
  return ratingSummary(book, average, count).rating;
}

export function ratingSummary(book, average = 0, count = 0) {
  const seed = book.statisticsSeed;
  const votes = seed?.ratingSample?.votes;
  const validVotes = Array.isArray(votes) && votes.length > 0 && votes.length <= 50 && votes.every(value => Number.isInteger(value) && value >= 1 && value <= 5);
  const legacy = Number.isSafeInteger(seed?.ratingWeight) && seed.ratingWeight > 0 && Number.isFinite(seed?.rating) && seed.rating >= 1 && seed.rating <= 5;
  const baselineCount = validVotes ? votes.length : legacy ? seed.ratingWeight : 0;
  const baselineSum = validVotes ? votes.reduce((sum, value) => sum + value, 0) : baselineCount ? baselineCount * seed.rating : 0;
  const readerCount = Number.isSafeInteger(count) && count > 0 && Number.isFinite(average) && average >= 1 && average <= 5 ? count : 0;
  const readerSum = readerCount ? average * readerCount : 0;
  const total = baselineCount + readerCount;
  return {rating: total ? (baselineSum + readerSum) / total : 0, count: total, readerCount, readerSum, baselineCount, baselineSum};
}
