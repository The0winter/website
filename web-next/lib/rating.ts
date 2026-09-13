// Reviews and book averages retain their existing 1–5 star storage scale.
// Every public numeric score uses the same 2–10 point presentation.
export function formatRating(stars?: number | null): string {
  if (typeof stars !== 'number' || !Number.isFinite(stars) || stars < 1 || stars > 5) return '暂无评分';
  return (stars * 2).toFixed(1);
}

export function ratingLabel(stars?: number | null): string {
  const score = formatRating(stars);
  return score === '暂无评分' ? score : `${score} 分`;
}
