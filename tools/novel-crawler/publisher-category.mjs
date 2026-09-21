import path from 'node:path';
import {load} from 'cheerio';
import {atomicWrite, hash, readJson} from './storage.mjs';
import {checkIdentity, normalizedTitle} from './quality.mjs';
import {normalizeBookCategory} from './categories.mjs';

const origin = 'https://www.qidian.com';
const bookLink = value => {
  try { const u = new URL(value, origin); return ['www.qidian.com', 'book.qidian.com'].includes(u.hostname) && /^\/(?:book|info)\/\d+\/?$/.test(u.pathname) ? u.href : null; } catch { return null; }
};
export function parsePublisherSearch(html, book) {
  const $ = load(html), urls = new Set();
  $('.book-img-text li, .book-img-text .book-mid-info').each((_, el) => {
    const card = $(el), title = card.find('h2 a').first().text().trim(), author = card.find('.author .name').first().text().trim();
    try { checkIdentity(book, {title, author}); } catch { return; }
    const url = bookLink(card.find('h2 a').first().attr('href'));
    if (url) urls.add(url);
  });
  return [...urls];
}
export function parsePublisherCategory(html, book, page) {
  const $ = load(html), read = (selector, attribute) => $(selector).length === 1 ? (attribute ? $(selector).attr(attribute) : $(selector).text())?.trim() : undefined;
  let title = read('meta[property="og:novel:book_name"]', 'content') || read('.book-info h1 em');
  let author = read('meta[property="og:novel:author"]', 'content') || read('.book-info h1 .writer');
  const labels = [];
  const raw = read('meta[property="og:novel:category"]', 'content');
  if (raw) labels.push(raw);
  $('.book-info .tag a').each((_, el) => {
    if (/\/(?:all|[a-z]+)\/?(?:\?|$)/.test($(el).attr('href') || '') && normalizeBookCategory($(el).text())) labels.push($(el).text().trim());
  });
  // Some publisher pages expose the same primary book identity as JSON-LD.
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).text());
      for (const record of Array.isArray(parsed) ? parsed : [parsed]) {
        if (record['@type'] !== 'Book') continue;
        const name = record.name, by = typeof record.author === 'string' ? record.author : record.author?.name;
        try { checkIdentity(book, {title: name, author: by}); } catch { continue; }
        title = name; author = by;
        labels.push(...(Array.isArray(record.genre) ? record.genre : [record.genre]).filter(v => typeof v === 'string'));
      }
    } catch { /* Invalid structured data is not classification evidence. */ }
  });
  checkIdentity(book, {title, author});
  const categories = new Set(labels.map(normalizeBookCategory).filter(Boolean));
  if (categories.size !== 1) return {categoryDetection: categories.size ? 'publisher-conflict' : 'publisher-missing'};
  return {category: [...categories][0], categoryDetection: 'publisher', categoryEvidence: {kind: 'publisher', url: page.url, hash: page.hash, checkedAt: page.checkedAt, title, author, labels}};
}

// Bounded, public metadata only. A verification page opens a six-hour circuit;
// no login, visible browser, repeated captcha attempts, or chapter requests.
export async function lookupPublisherCategory(book, stateDir, {fetchPage = fetch, now = Date.now()} = {}) {
  const dir = path.join(stateDir, 'category-publishers'), file = path.join(dir, hash({title: normalizedTitle(book.title), author: normalizedTitle(book.author)}) + '.json');
  const saved = readJson(file), unavailable = readJson(path.join(dir, 'qidian-unavailable.json'));
  if (saved?.expiresAt > now) return saved.result;
  if (unavailable?.retryAt > now) return {categoryDetection: 'publisher-unavailable', publisherAttempt: unavailable};
  const read = async url => {
    const response = await fetchPage(url, {signal: AbortSignal.timeout(12000)}), html = await response.text();
    const page = {url, hash: hash(html), checkedAt: new Date(now).toISOString()};
    atomicWrite(path.join(dir, page.hash + '.json'), {...page, status: response.status, html});
    if (response.status !== 200 || html.length < 1000 || /<title>[^<]*(?:验证|驗證|访问受限|Just a moment)/i.test(html)) throw Error(`起点返回验证或不可用页面（HTTP ${response.status}）`);
    return {html, page};
  };
  try {
    const search = await read(origin + '/search?kw=' + encodeURIComponent(book.title));
    const urls = parsePublisherSearch(search.html, book);
    let result = {categoryDetection: urls.length > 1 ? 'publisher-ambiguous' : 'publisher-not-found', publisherAttempt: search.page};
    if (urls.length === 1) {
      const detail = await read(urls[0]);
      result = {...parsePublisherCategory(detail.html, book, detail.page), publisherAttempt: search.page};
    }
    atomicWrite(file, {result, expiresAt: now + (result.category ? 30 : 7) * 86400000});
    return result;
  } catch (error) {
    const attempt = {url: origin + '/search?kw=' + encodeURIComponent(book.title), checkedAt: new Date(now).toISOString(), error: error.message, retryAt: now + 6 * 3600000};
    atomicWrite(path.join(dir, 'qidian-unavailable.json'), attempt);
    return {categoryDetection: 'publisher-unavailable', publisherAttempt: attempt};
  }
}
