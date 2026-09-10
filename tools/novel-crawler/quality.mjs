import {hash} from './storage.mjs';
import {normalizedIdentity} from './identity.mjs';

export const normalizedTitle = value => String(value ?? '').normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
export const normalizedText = value => String(value).normalize('NFKC').replace(/\s+/gu, '');
const withoutChapterNumber = value => String(value).normalize('NFKC').replace(/^第[0-9零〇一二三四五六七八九十百千万两]+[章节回]/u, '');

export function checkIdentity(spec, actual) {
  for (const field of ['title', 'author']) {
    const normalize = value => normalizedIdentity(value, spec.identityNormalization);
    const permitted = [spec[field], ...(spec[`${field}Aliases`] || [])].map(normalize);
    if (!actual[field] || !permitted.includes(normalize(actual[field]))) {
      throw Error(`作品身份不匹配：${field}，实际 ${JSON.stringify(actual[field] || '')}，预期 ${JSON.stringify(spec[field])}`);
    }
  }
}

export function chapterQuality(chapter) {
  const issues = [];
  const add = (level, code, detail) => issues.push({level, code, detail, chapter: chapter.chapter_number});
  const text = chapter.content || '';
  if (!text.trim()) add('error', 'empty', '正文为空');
  if (text.length > 60000) add('error', 'too-long', '正文超过导入接口的60000字符限制，未截断');
  if (!chapter.title?.trim() || chapter.title.length > 100) add('error', 'heading', '章节标题为空或超过100字符');
  if (/\uFFFD/.test(text)) add('error', 'decode', '正文含编码替换字符，需要核实编码');
  if (/[\uE000-\uF8FF]/u.test(text)) add('warning', 'private-use-characters', '可能使用自定义字体，正文尚未确认可读');
  if (text.length < 1500 && /^(?:\s)*(?:access denied|forbidden|just a moment|验证您的浏览器|请完成验证|请登录后阅读|订阅本章|本章需要订阅)/iu.test(text)) add('error', 'access-page', '疑似验证、登录或订阅页面');
  if (chapter.catalogTitle && normalizedTitle(chapter.title) !== normalizedTitle(chapter.catalogTitle)) {
    if (normalizedTitle(withoutChapterNumber(chapter.title)) === normalizedTitle(withoutChapterNumber(chapter.catalogTitle))) add('info', 'numbering-difference', '目录与正文标题的章号不同，按目录位置排序，保留双方标题');
    else add('warning', 'title-mismatch', '目录标题与正文页标题不同，未自动重命名或交换正文');
  }
  for (const message of chapter.extractionWarnings || []) add('warning', 'extraction', message);
  const lines = text.split('\n').filter(s => s.trim());
  if (lines.some(line => /^(?:上一章|下一章|返回目录|加入书签|最新网址[:：].{1,100})$/u.test(line.trim()))) add('warning', 'navigation', '正文含独立导航或站点提示行');
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(text)) add('warning', 'control-characters', '正文含非排版控制字符，保留原文等待核对');
  return issues;
}

function shingles(text) {
  const result = new Set();
  // A bounded signature is enough to flag suspected duplication, never to delete.
  const step = Math.max(8, Math.floor(text.length / 128));
  for (let i = 0; i + 16 <= text.length; i += step) result.add(hash(text.slice(i, i + 16)).slice(0, 12));
  return result;
}

export function qualityReport(catalog, chapters, failures = [], mode = 'download') {
  const issues = chapters.flatMap(chapterQuality);
  const exact = new Map(), inverted = new Map();
  const lengths = chapters.map(c => c.content.trim().length).sort((a, b) => a - b);
  const medianLength = lengths[Math.floor(lengths.length / 2)] || 0;
  for (const chapter of chapters) {
    const text = normalizedText(chapter.content);
    if (text.length >= 100) {
      const key = hash(text);
      if (exact.has(key)) issues.push({level: 'error', code: 'duplicate-body', chapter: chapter.chapter_number, otherChapter: exact.get(key), detail: '不同目录项正文完全重复，保留原文等待核对'});
      else exact.set(key, chapter.chapter_number);
      const signature = shingles(text), candidates = new Map();
      for (const part of signature) for (const item of inverted.get(part) || []) candidates.set(item, (candidates.get(item) || 0) + 1);
      for (const [item, overlap] of candidates) {
        if (item.hash !== key && overlap / (signature.size + item.size - overlap) >= 0.75) issues.push({level: 'warning', code: 'similar-body', chapter: chapter.chapter_number, otherChapter: item.number, detail: '正文高度相似，仅标记，不删章'});
      }
      const item = {number: chapter.chapter_number, size: signature.size, hash: key};
      for (const part of signature) {
        const bucket = inverted.get(part) || [];
        if (bucket.length < 20) bucket.push(item);
        inverted.set(part, bucket);
      }
    }
    if (medianLength > 500 && text.length < medianLength * 0.15 && !/通知|请假|感言|后记|序言|公告/u.test(chapter.title)) issues.push({level: 'warning', code: 'short-outlier', chapter: chapter.chapter_number, detail: '相对本书多数章节明显偏短，保留全文'});
  }
  const downloaded = new Set(chapters.map(c => c.link));
  const missing = catalog.filter(c => !downloaded.has(c.link)).map(c => ({chapter: c.chapter_number, title: c.title, link: c.link}));
  const errors = issues.filter(i => i.level === 'error').length + failures.length;
  const warnings = issues.filter(i => i.level === 'warning').length;
  return {
    mode, expected: catalog.length, downloaded: chapters.length,
    completeAgainstSource: mode === 'download' && missing.length === 0 && !failures.length,
    structuralPass: errors === 0, errors, warnings,
    information: issues.filter(i => i.level === 'info').length,
    score: !catalog.length || !chapters.length ? 0 : Math.max(0, 100 - errors * 25 - Math.min(50, warnings * 5)),
    medianLength, issues, failures, missing,
    limitation: '只检查采集结构和可检测异常；不能保证来源无删文、段落错序或内容错配。试采通过不代表整本验证通过。',
  };
}

export function sampleCatalog(catalog, count = 9) {
  if (catalog.length <= count) return catalog;
  const positions = new Set([0, 1, catalog.length - 1, catalog.length - 2]);
  for (let i = 0; i < count; i++) positions.add(Math.round(i * (catalog.length - 1) / (count - 1)));
  // Include volume boundaries and repeated first-chapter headings without sorting by them.
  for (let i = 1; i < catalog.length && positions.size < count + 6; i++) if (/第[一1]章|卷|番外/u.test(catalog[i].title)) { positions.add(i - 1); positions.add(i); }
  return [...positions].sort((a, b) => a - b).map(i => catalog[i]);
}
