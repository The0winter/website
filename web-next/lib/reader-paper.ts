// One seamless, static texture is sampled at a different origin for each page.
// Stable offsets keep a page identical when turning back or restoring progress.
export function readerPaperPosition(page: number) {
  const index = Number.isSafeInteger(page) && page > 0 ? page : 0;
  return `${-(index * 137 % 768)}px ${-(index * 211 % 1024)}px`;
}

export const readerPaperImage = '/textures/reader-paper-v2.webp';
export const mobileReaderCream = {bg: '#dbc49e', text: '#382b19'};

let paperDecoded: Promise<void> | undefined;
export function prepareReaderPaper() {
  // Decode once during entry, never as part of a tap or a page-turn animation.
  if (!paperDecoded) {
    const image = new Image();
    image.src = readerPaperImage;
    paperDecoded = new Promise<void>(resolve => {
      // Decoration must not hold readable chapter text behind a stalled fetch.
      const timeout = window.setTimeout(resolve, 1500);
      void image.decode().catch(() => {}).finally(() => {window.clearTimeout(timeout); resolve();});
    });
  }
  return paperDecoded;
}
