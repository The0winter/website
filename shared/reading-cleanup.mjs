import {createHash} from 'node:crypto';

export const readingCleanupVersion = 1;
const digest = value => createHash('sha256').update(value).digest('hex');
const key = value => String(value || '').normalize('NFKC').replace(/^\d+[.、]\s*(?=第)/u, '').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
const colonHosts = new Set(['www.shudugu.org', 'shudugu.org', 'www.deqixs.org', 'deqixs.org', 'xszj.tw']);
// Whole, observed signatures. Ordinary mentions of advertising, websites, or
// punctuation in prose are never a reason to remove a paragraph.
const advertisements = [
  /^[（(]请记住[^\r\n]{1,120}网站[，,]观看最快的章节更新[）)]$/u,
  /^【记住本站域名[^【】\r\n]{1,150}[?？][^【】\r\n]{0,100}】$/u,
  /^记住首发网站域名[?？A-Za-z0-9.。]{3,100}$/u,
  /^请记住本书首发域名：[^\r\n]{0,100}。手机版阅读网址：[^\r\n]{0,100}$/u,
  /^记住我们的域名：[^\r\n]{0,100}，精彩随时可读。$/u,
  /^记住这个名字：(?:可乐小说)?。记住这个域名：。好(?:书)?不迷路。$/u,
  /^纯文字在线阅读本站域名手机同步阅读请访问m\.$/u,
  /^请记住：[^\r\n]{1,120}首发只有这一个站，其它点网站随时断更哦！$/u,
  /^写到这里，请记住我们网址：速\*读\*谷（w\*w\*w\.s\*u\*d\*u\*g\*u\.o\*r\*g）免费看最新章节！$/u,
  /^更新不易、请记住我们新域名 速 读 谷 www\.shudugu\.org 看书神器，超好用$/u,
  /^写到这里，请记住我们的域名，速 读 谷 ，w w w \. s u d u g u \.  o r g 看无错最新章节！$/u,
  /^写到这里，请收藏我们的域名，sūdūgū\.ōrg看最新小说章节！$/u,
  /^写到这里请记住我们的域名：w w w s u d u g u o r g$/u,
  /^求书、催更、报错 \+ 官方纸飞机（电报群）：https:\/\/t\.me\/deqixs$/u,
  /^本章节来源于(?=[?？ .。…·°A-Za-z0-9]*[?？])[?？ .。…·°A-Za-z0-9]{1,40}$/u,
  /^(?:解闷好[，,]\s*)?(?=[?？.。A-Za-z0-9]*[?？])[?？.。A-Za-z0-9]{3,100}(?:随时看\s*)?全手打无错站$/u,
];
const navigation = /^(?:[（(]本章完[）)]|上一章|下一章|上一页|下一页|返回目录|章节目录|加入书签|书签)$/u;
const numberedHeading = /^第[0-9零〇一二三四五六七八九十百千万两]+[章回节卷]/u;

export function cleanReadingContent(content, {title = '', author = '', link = '', sourceUrl = ''} = {}) {
  if (typeof content !== 'string') throw Error('清理正文必须为字符串');
  let host = ''; try { host = new URL(link || sourceUrl).hostname; } catch { /* Legacy local editions may have no link. */ }
  const lines = content.split(/\r\n|\n|\r/u), removed = [], warnings = [];
  const titleKey = key(title);
  const metadata = line => {
    const match = line.trim().match(/^(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?\s*)?作者\s*[:：]\s*(.{1,80})$/u);
    return !!match && (author && author !== '未知' && key(match[1]) === key(author) || /^\d{4}[-/]\d{1,2}[-/]\d{1,2}\s/u.test(line.trim()) && !/[，。！？“”]/u.test(match[1]));
  };
  const keep = lines.map((text, index) => ({text, index})).filter(row => {
    const text = row.text.trim();
    const reason = advertisements.some(rule => rule.test(text)) ? 'site-advertisement'
      : colonHosts.has(host) && /^[:：]+$/u.test(text) ? 'site-colon' : null;
    if (reason) removed.push({line: row.index + 1, reason, text: row.text});
    return !reason;
  });
  let start = 0, end = keep.length, headers = 0;
  while (start < end && headers < 8) {
    const row = keep[start], text = row.text.trim();
    let reason;
    if (!text) reason = 'edge-blank';
    else if (titleKey && text.length <= 200 && key(text) === titleKey) reason = 'opening-title';
    else if (metadata(text)) reason = 'author-date';
    else if (numberedHeading.test(text) && text.length <= 100 && keep[start + 1] && metadata(keep[start + 1].text)) {
      reason = 'verified-page-heading';
      if (key(text) !== titleKey) warnings.push('目录标题与页头不同，保留原章节标题');
    } else break;
    removed.push({line: row.index + 1, reason, text: row.text});
    if (text) headers++;
    start++;
  }
  while (end > start) {
    const row = keep[end - 1], text = row.text.trim();
    const reason = !text ? 'edge-blank' : navigation.test(text) ? 'footer-navigation' : null;
    if (!reason) break;
    removed.push({line: row.index + 1, reason, text: row.text}); end--;
  }
  // Keep every surviving paragraph byte-for-byte, including internal whitespace.
  const result = keep.slice(start, end).map(row => row.text).join('\n');
  if (!removed.some(row => row.reason !== 'edge-blank')) return {content, removed: [], warnings};
  if (!result.trim() && content.trim()) return {content, removed: [], warnings: [...warnings, '清理后为空，已保留原文']};
  const removedChars = removed.filter(r => r.reason !== 'edge-blank').reduce((n, r) => n + r.text.length, 0);
  if (removedChars > 300 && removedChars > content.length * 0.12) return {content, removed: [], warnings: [...warnings, '删除比例异常，已保留原文等待核对']};
  return {content: result, removed, warnings};
}

// Raw-source reviews keep referring to the original source bytes. The enclosing
// export/binding checksum authenticates this mapping; modified bodies fail here.
export function sourceContentHash(chapter) {
  const current = digest(String(chapter.content || ''));
  if (!chapter.readingCleanup) return current;
  const record = chapter.readingCleanup;
  if (record.version !== readingCleanupVersion || record.contentHash !== current || !/^[a-f0-9]{64}$/u.test(record.sourceHash)) throw Error('阅读版清理记录与正文不一致');
  return record.sourceHash;
}

export function cleanChapterForReading(chapter, book = {}) {
  if (typeof chapter.content !== 'string') return {...chapter};
  const sourceHash = sourceContentHash(chapter);
  const cleaned = cleanReadingContent(chapter.content, {...book, ...chapter});
  const next = {...chapter};
  if (cleaned.content !== chapter.content) {
    next.content = cleaned.content;
    next.readingCleanup = {version: readingCleanupVersion, sourceHash, contentHash: digest(cleaned.content),
      changes: [...(chapter.readingCleanup?.changes || []), ...cleaned.removed.map(({line, reason, text}) => ({line, reason, hash: digest(text), characters: text.length}))]};
  }
  if (cleaned.warnings.length) next.readingCleanupWarnings = [...new Set([...(next.readingCleanupWarnings || []), ...cleaned.warnings])];
  if (chapter.sourceSection && !chapter.volume_title) next.volume_title = chapter.sourceSection;
  if (Number.isSafeInteger(chapter.sourceSectionNumber) && !chapter.volume_number) next.volume_number = chapter.sourceSectionNumber;
  return next;
}

export function cleanBookForReading(book) {
  let section = '', sectionNumber = 0, sourceNumber;
  return {...book, chapters: book.chapters.map(chapter => {
    const next = cleanChapterForReading(chapter, book);
    if (chapter.sourceSection) {
      if (chapter.sourceSection !== section || chapter.sourceSectionNumber !== sourceNumber) { section = chapter.sourceSection; sectionNumber++; }
      sourceNumber = chapter.sourceSectionNumber;
      next.volume_title = chapter.volume_title || section;
      next.volume_number = chapter.volume_number || sectionNumber;
    }
    return next;
  })};
}

export function chapterVolumeFields(chapter) {
  const fields = {};
  if (chapter.volume_title !== undefined) {
    if (typeof chapter.volume_title !== 'string' || !chapter.volume_title.trim() || chapter.volume_title.length > 100) throw Error('卷标题无效');
    fields.volume_title = chapter.volume_title.trim();
  }
  if (chapter.volume_number !== undefined) {
    if (!fields.volume_title || !Number.isSafeInteger(chapter.volume_number) || chapter.volume_number < 1) throw Error('卷序号无效');
    fields.volume_number = chapter.volume_number;
  }
  return fields;
}
