// Formatting belongs at export, after source matching and checkpoint validation.
export function formatChapterTitle(title) {
  if (typeof title !== 'string') return title;
  const match = /^(第[0-9０-９零〇一二三四五六七八九十百千万萬亿億两兩壹贰貳叁參肆伍陆陸柒捌玖拾佰仟]+[章節节回卷])([\s\S]*)$/u.exec(title);
  if (!match) return title;
  const name = match[2].replace(/^[\s\u200b\ufeff]+/u, '');
  // A number alone or an existing punctuation separator needs no inserted gap.
  if (!name || /^[：:、.．—–-]/u.test(name)) return title;
  return `${match[1]} ${name}`;
}

export function formatChapterForExport(chapter) {
  const formatted = {...chapter};
  for (const [field, originalField] of [['title', 'sourceTitle'], ['catalogTitle', 'sourceCatalogTitle']]) {
    const title = formatChapterTitle(chapter[field]);
    if (title !== chapter[field]) {
      formatted[originalField] ??= chapter[field];
      formatted[field] = title;
    }
  }
  return formatted;
}
