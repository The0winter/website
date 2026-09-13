// A short, deliberate horizontal swipe should work for outer sections and inner tabs.
export function sectionSwipeThreshold(width: number) {
  return Math.max(32, Math.min(48, width * .12));
}
