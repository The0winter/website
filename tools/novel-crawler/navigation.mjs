// A partial catalog is a known prefix, never a complete book. Extend it only
// through actual next-chapter links or an overlapping, ordered recent list.
export function mergeRecent(catalog, recent, expected) {
  const start = catalog.findIndex(entry => entry.link === recent[0].link);
  if (start < 0) {
    if (recent.some(entry => catalog.some(known => known.link === entry.link))) throw Error('最新章节与已保存目录的交集不连续，已停止');
    return false;
  }
  for (let i = 0; i < recent.length && start + i < catalog.length; i++) {
    if (catalog[start + i].link !== recent[i].link || catalog[start + i].title !== recent[i].title) throw Error('最新章节有删除、插入或改名，暂停续传以保护旧章节位置');
  }
  // The recent list must end at the declared end of this source, not in its middle.
  if (start + recent.length !== expected) throw Error('最新章节位置与详情页总数不一致，已停止');
  for (let i = catalog.length - start; i < recent.length; i++) catalog.push({...recent[i], sourceOrder: catalog.length + 1, chapter_number: catalog.length + 1});
  return true;
}

export function navigationCatalog(source, previous) {
  const prefix = source.catalog, expected = source.expectedCount;
  if (previous && (previous.length > expected || previous.some((entry, i) => entry.chapter_number !== i + 1 || (prefix[i] && (entry.link !== prefix[i].link || entry.title !== prefix[i].title))))) throw Error('首屏目录或总数与已保存目录不一致，暂停续传以保护旧章节');
  const catalog = (previous?.length > prefix.length ? previous : prefix).map(entry => ({...entry}));
  if (new Set(catalog.map(entry => entry.link)).size !== catalog.length) throw Error('已保存目录链接重复');
  mergeRecent(catalog, source.recent, expected);
  return catalog;
}

export function navigationReport(report, source, catalog) {
  if (!source?.recent) return report;
  return {...report, expected: source.expectedCount, knownCatalog: catalog.length, undiscovered: source.expectedCount - catalog.length,
    catalogComplete: catalog.length === source.expectedCount,
    completeAgainstSource: report.completeAgainstSource && catalog.length === source.expectedCount,
    sampleScope: report.mode === 'probe' ? 'opening-chapters' : undefined,
    limitation: report.limitation + (report.mode === 'probe' ? ' 本来源试采仅检查开头连续章节；缺失的中间目录会在下载时沿下一章逐步建立。' : ' 目录来自首屏、实际下一章链接和衔接核对后的最新章节列表。')};
}
