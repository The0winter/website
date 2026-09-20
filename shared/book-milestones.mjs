const largeSteps = Array.from({length: 8}, (_, index) => [1, 2, 5].map(n => n * 10 ** (index + 6))).flat();
export const milestoneThresholds = Object.freeze({
  favorites: Object.freeze([300, 500, 1000, 3000, 5000, 10000, 20000, 30000, 50000, 100000, 200000, 300000, 500000, ...largeSteps]),
  views: Object.freeze([10000, 50000, 100000, 200000, 500000, ...largeSteps]),
});

export function milestoneNumber(value) {
  if (value >= 100000000) return `${milestoneNumber(value / 100000000)}亿`;
  if (value >= 10000) return `${milestoneNumber(value / 10000)}万`;
  const digits = '零一二三四五六七八九';
  for (const [unit, label] of [[1000, '千'], [100, '百'], [10, '十']]) {
    if (value >= unit) {
      const whole = Math.floor(value / unit), rest = value % unit;
      return `${unit === 10 && whole === 1 ? '' : digits[whole]}${label}${rest ? `${rest < unit / 10 ? '零' : ''}${milestoneNumber(rest)}` : ''}`;
    }
  }
  return digits[value] || String(value);
}

export function reachedMilestones(counts, achievedAt = null) {
  return Object.entries(milestoneThresholds).flatMap(([kind, steps]) => steps
    .filter(threshold => threshold <= (counts[kind] || 0))
    .map(threshold => ({kind, threshold, achievedAt})));
}
