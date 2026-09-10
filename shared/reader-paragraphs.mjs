// Stable text identities keep annotations attached when unrelated paragraphs move.
export function readerParagraphs(content, title = '', chapterNumber = 0) {
  const heading = value => value.replace(/[\s()（）]/gu, '');
  const titles = new Set([heading(title), heading(`第${chapterNumber}章 ${title}`)]);
  const occurrences = new Map();
  return String(content || '').split(/\r\n|\n|\r/u).map(line => line.trim()).filter(Boolean)
    .filter((text, index) => !(index < 3 && titles.has(heading(text))))
    .map(text => {
      let a = 2166136261, b = 5381;
      for (let i = 0; i < text.length; i++) {
        a = Math.imul(a ^ text.charCodeAt(i), 16777619);
        b = Math.imul(b, 33) ^ text.charCodeAt(i);
      }
      const hash = (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
      const occurrence = (occurrences.get(hash) || 0) + 1;
      occurrences.set(hash, occurrence);
      return {key: `${hash}-${occurrence}`, text};
    });
}
