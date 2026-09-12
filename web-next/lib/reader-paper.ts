// One seamless, static texture is sampled at a different origin for each page.
// Stable offsets keep a page identical when turning back or restoring progress.
export function readerPaperPosition(page: number) {
  const index = Number.isSafeInteger(page) && page > 0 ? page : 0;
  return `${-(index * 137 % 768)}px ${-(index * 211 % 1024)}px`;
}

export const mobileReaderCream = {bg: '#ddc7a2', text: '#382b19'};
