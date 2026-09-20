export const SECTION_TURN_DURATION = 400;
export const SECTION_TURN_EASING = 'cubic-bezier(.25,.5,.35,1)';

// A short, deliberate horizontal swipe should work for outer sections and inner tabs.
export function sectionSwipeThreshold(width: number) {
  return Math.max(32, Math.min(48, width * .12));
}
