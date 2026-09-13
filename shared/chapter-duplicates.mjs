// Shared by collection QA and whole-file import preflight. These findings stop
// automatic publication; they never choose a copy to keep or delete chapters.
const titleKey = value => String(value ?? '').normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
const bodyKey = value => String(value ?? '').normalize('NFKC').replace(/\s+/gu, '');

function shingles(text) {
  const parts = new Set();
  // Every position matters: sparse fixed offsets miss duplicates as soon as
  // punctuation or a short insertion shifts the remaining text by one character.
  for (let i = 0; i + 16 <= text.length; i++) parts.add(text.slice(i, i + 16));
  return parts;
}

export function chapterDuplicateIssues(chapters) {
  const issues = [], exact = new Map(), titles = new Map(), links = new Map();
  for (const chapter of chapters) {
    const number = chapter.chapter_number ?? chapter.chapterNumber;
    const link = chapter.link ?? chapter.sourceUrl;
    if (link) {
      if (links.has(link)) issues.push({level: 'error', code: 'duplicate-link', chapter: number, otherChapter: links.get(link), detail: '不同目录项使用相同来源链接，须核对后导入'});
      else links.set(link, number);
    }
    const text = bodyKey(chapter.content);
    if (text.length < 100) continue;
    if (exact.has(text)) {
      issues.push({level: 'error', code: 'duplicate-body', chapter: number, otherChapter: exact.get(text), detail: '不同目录项正文完全重复，保留原文等待核对'});
      continue;
    }
    exact.set(text, number);
    const title = titleKey(chapter.title);
    if (!title) continue;
    const previous = titles.get(title) || [];
    let signature;
    for (const other of previous) {
      if (text === other.text || Math.min(text.length, other.text.length) / Math.max(text.length, other.text.length) < 0.8) continue;
      signature ??= shingles(text);
      other.signature ??= shingles(other.text);
      let overlap = 0;
      for (const part of signature) if (other.signature.has(part)) overlap++;
      const similarity = overlap / (signature.size + other.signature.size - overlap);
      if (similarity >= 0.8) issues.push({level: 'error', code: 'duplicate-title-body', chapter: number, otherChapter: other.number, similarity, detail: '同标题章节正文高度相似，可能是来源重复或错章；保留原文并暂停导出/导入，须核对'});
    }
    previous.push({number, text, signature}); titles.set(title, previous);
  }
  return issues;
}
