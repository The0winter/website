// Four rounds of 3 + 3 + 8 books, following the separate three-book banner.
export const discoverySections = [
  '为你推荐', '值得一读', '好书拾遗',
  '换个故事', '慢慢读下去', '书海漫游',
  '翻开新一页', '故事正精彩', '偶遇好书',
  '留点时间读书', '下一本读什么', '再发现一些',
].map((title, index) => ({title, layout: index % 3 === 2 ? 'shelf' : 'rows', size: index % 3 === 2 ? 8 : 3,
  offset: Math.floor(index / 3) * 14 + (index % 3) * 3} as const));
