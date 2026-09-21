import path from 'node:path';
import {readJson} from './storage.mjs';
import {checkIdentity} from './quality.mjs';
import {normalizedIdentity} from './identity.mjs';

// Exact labels only. Themes such as 重生/系统/穿越 are not primary categories.
const groups = {
  '玄幻': ['东方玄幻', '异世大陆', '高武世界', '王朝争霸', '玄幻小说', '玄幻魔法', '玄幻奇幻', '奇幻玄幻'],
  '奇幻': ['西方奇幻', '史诗奇幻', '剑与魔法', '现代魔法', '历史神话', '黑暗幻想', '奇幻小说'],
  '武侠': ['传统武侠', '武侠幻想', '国术无双', '武侠小说'],
  '仙侠': ['修真', '修仙', '仙侠修真', '武侠修真', '武侠仙侠', '古典仙侠', '幻想修仙', '现代修真', '神话修真', '修真文明', '仙侠小说'],
  '都市': ['都市生活', '现代都市', '都市异能', '都市小说', '都市青春', '都市言情', '青春校园', '娱乐明星', '商战职场', '异术超能', '恩怨情仇'],
  '现实': ['人间百态', '社会乡土', '行业人生', '家庭伦理', '现实小说'],
  '历史': ['架空历史', '两晋隋唐', '秦汉三国', '上古先秦', '五代十国', '两宋元明', '清史民国', '外国历史', '民间传说', '历史军事', '穿越历史', '历史小说'],
  '军事': ['战争幻想', '谍战特工', '军旅生涯', '军事战争', '抗战烽火', '军事小说'],
  '游戏': ['游戏异界', '虚拟网游', '电子竞技', '游戏系统', '游戏主播', '网游竞技', '游戏竞技', '游戏小说'],
  '体育': ['篮球运动', '足球运动', '体育赛事', '体育竞技', '体育小说'],
  '科幻': ['星际文明', '未来世界', '超级科技', '古武机甲', '进化变异', '末世危机', '时空穿梭', '科幻未来', '科幻小说'],
  '诸天无限': ['诸天', '无限', '无限流', '诸天无限小说'],
  '悬疑': ['诡秘悬疑', '奇妙世界', '探险生存', '侦探推理', '悬疑侦探', '灵异', '恐怖灵异', '悬疑灵异', '科幻灵异', '悬疑小说'],
  '轻小说': ['原生幻想', '衍生同人', '恋爱日常', '同人', '同人小说', '二次元', '动漫同人', '轻小说小说'],
  '言情': ['现代言情', '古代言情', '浪漫青春', '玄幻言情', '仙侠奇缘', '古言', '现言', '言情小说', '都市情缘'],
  '文学': ['文学小说', '经典文学', '外国文学', '中国文学'],
};
export const bookCategories = Object.freeze(Object.keys(groups));
const aliases = new Map(Object.entries(groups).flatMap(([category, values]) => [category, ...values].map(value => [value, category])));
export function normalizeBookCategory(value) {
  if (typeof value !== 'string' || value.length > 200) return undefined;
  const text = value.normalize('NFKC').trim().replace(/^(?:作品|小说|小說)?(?:分类|分類|类别|類別|类型|類型)\s*[:：]\s*/u, '').replace(/\s+/gu, '');
  return aliases.get(text) || aliases.get(normalizedIdentity(text, 'chinese-simplified'));
}
export function hasBookCategory(value) {
  return typeof value === 'string' && !!value.trim() && !/^(?:未分类|未分類|暂无分类|未知|其他|其它|综合|全部|小说|小說)$/u.test(value.trim());
}
export function categoryFields(book = {}) {
  return Object.fromEntries(['category', 'categoryDetection', 'categoryEvidence'].filter(key => book[key] !== undefined).map(key => [key, book[key]]));
}

// Existing unannotated values are treated as manual. Publisher evidence may
// upgrade a mirror-derived value; neither blanks nor a new mirror may replace it.
export function mergeBookCategory(saved = {}, incoming = {}) {
  const current = hasBookCategory(saved.category), next = normalizeBookCategory(incoming.category);
  const upgrade = next && (incoming.categoryDetection === 'verified' || (incoming.categoryEvidence?.kind === 'publisher' && saved.categoryEvidence?.kind === 'source'));
  if (current && !upgrade) return categoryFields(saved);
  if (next) return {...categoryFields(incoming), category: next};
  return {};
}

// Registry is local data, never a per-title rule hard-coded in the extractor.
export function applyVerifiedBookCategory(book, stateDir, identityNormalization) {
  const registry = readJson(path.join(stateDir, 'book-categories.json'), {books: []});
  const item = (Array.isArray(registry.books) ? registry.books : []).find(item => {
    if (!normalizeBookCategory(item.category) || !item.evidence?.url || !item.evidence?.checkedAt) return false;
    if (![item.sourceUrl, ...(item.sourceUrls || [])].includes(book.sourceUrl || book.url)) return false;
    try { checkIdentity({...book, identityNormalization}, item); return true; } catch { return false; }
  });
  return item ? {...book, category: normalizeBookCategory(item.category), categoryDetection: 'verified', categoryEvidence: item.evidence} : book;
}
