// Shared checks for collected reviews. These checks never rewrite author prose.
export function decodeReviewEntities(value) {
  const named = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',ensp:' ',emsp:' ',hellip:'…'};
  return String(value || '').replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (all, key) => {
    if (key[0] !== '#') return named[key.toLowerCase()] ?? all;
    const code = key[1]?.toLowerCase() === 'x' ? parseInt(key.slice(2),16) : Number(key.slice(1));
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : all;
  });
}

export function reviewText(html) {
  return decodeReviewEntities(String(html || '').replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/(?:p|div|h[1-6]|li|blockquote)>/gi,'\n').replace(/<[^>]*>/g,'')).trim();
}

export const reviewContentKey = html => reviewText(html).normalize('NFC').replace(/\s/g, '');

export function reviewContentProblems(html) {
  const text = reviewText(html), problems = [];
  if (!text.trim()) problems.push('empty');
  if (/^正文已核验[:：]|^合辑已核读|^核验记录[:：]/.test(text)) problems.push('verification-note');
  if (/很抱歉，你需要登录才能继续浏览|\(ERROR:15\)|Checking your browser|Access Denied|查看所需的权限\/条件/i.test(text)) problems.push('blocked-page');
  if (/(?:^|\n)\s*<\/?(?:div|p|span)\s*$/m.test(text) || /<br\s*\/?\s*>/i.test(text)) problems.push('html-fragment');
  if (/data\.(?:videolive|groupusers|recommend)|zbhtml\s*\+=/.test(text)) problems.push('script-text');
  if (/返回搜狐[，,]?\s*查看更多|(?:^|\n)\s*❤️\s*\d+\s*$|(?:^|\n)\s*(?:推|噓|→)\s*[A-Za-z0-9_]+\s*:/m.test(text)) problems.push('page-controls');
  if (/用户名：密码：\s*验证码|\[QQ阅读小说网|(?:^|\n)\s*加入日期[:：]/.test(text)) problems.push('whole-page');
  if (/&(?:#160|nbsp|amp|lt|gt|quot);/.test(text)) problems.push('escaped-entity');
  if (/!\[[^\]]*\]\([^\n)]+\)|\[[^\]\n]+\]\(https?:\/\/[^)\n]+\)|(?:^|\n)\s*#{1,6}\s/.test(text)) problems.push('raw-markdown');
  return problems;
}

export function assertCollectedReviewQuality(article) {
  if (!['original','excerpt','guide'].includes(article.source?.kind)) throw Error('采集书评须标明 original、excerpt 或 guide 内容类型');
  const problems = reviewContentProblems(article.content);
  if (problems.length) throw Error('书评正文未通过内容检查：' + problems.join(', '));
  if (article.source.kind === 'original' && (article.evidence?.isExcerpt || article.evidence?.truncated)) throw Error('核验片段不能作为完整原文导入');
  const text = reviewText(article.content);
  if (article.source.kind === 'original' && [500,750,800,1000,1200,1500,2000,3000,5000,10000].includes(text.length) && !/[。！？.!?…」』”’）)]$/.test(text) && article.evidence?.complete !== true) throw Error('疑似定长截断：请核对原文完整性，或标明节选');
  if (article.source.kind !== 'guide' && article.evidence?.summaryType === 'editorial_reading_guide') throw Error('整理者导读不能归为原作者正文');
}
