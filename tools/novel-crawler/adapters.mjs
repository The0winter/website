import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {load} from 'cheerio';
import {decode, httpUrl} from './http.mjs';
import {atomicWrite} from './storage.mjs';
import {checkIdentity, normalizedTitle} from './quality.mjs';

export function selectValue($, rule) {
  if (!rule) throw Error('缺少提取规则');
  const config = typeof rule === 'string' ? {selector: rule} : rule;
  const el = $(config.selector);
  if (el.length !== 1) throw Error(`应唯一匹配 ${config.selector}，实际 ${el.length} 个`);
  let value = (config.attribute ? el.attr(config.attribute) : el.text())?.trim() || '';
  if (config.pattern) {
    const match = new RegExp(config.pattern, 'u').exec(value);
    if (!match?.[1]) throw Error(`提取规则不匹配：${config.selector}`);
    value = match[1].trim();
  }
  return value;
}

export function cleanHtml($, selector, remove = []) {
  const source = $(selector);
  if (source.length !== 1) throw Error(`正文容器 ${selector} 应唯一，实际 ${source.length} 个`);
  const fragment = source.clone();
  fragment.find(['script', 'style', 'noscript', 'iframe', ...remove].join(',')).remove();
  // Preserve paragraph/BR boundaries without deleting keyword matches in prose.
  fragment.find('br').replaceWith('\n');
  fragment.find('p,div,li,section,blockquote,h1,h2,h3').prepend('\n').append('\n');
  return fragment.text().replace(/\r\n?/g, '\n').split('\n').map(s => s.trim()).filter(Boolean).join('\n');
}

function nextPage($, selector, base, client) {
  if (!selector) return null;
  const links = $(selector).filter((_, el) => !$(el).is('[disabled],.disabled,[aria-disabled="true"]'));
  if (!links.length) return null;
  if (links.length !== 1) throw Error(`下一页选择器匹配了 ${links.length} 个元素`);
  const href = links.attr('href');
  if (!href || href === '#') return null;
  return client.assertUrl(httpUrl(href, base));
}

export async function getCatalog(spec, client) {
  const first = await client.get(spec.sourceUrl, {fresh: true, render: spec.transport === 'browser', readySelector: spec.metadata.readySelector});
  const $ = load(decode(first.body, first.contentType, spec.encoding));
  const actual = {title: selectValue($, spec.metadata.title), author: selectValue($, spec.metadata.author)};
  checkIdentity(spec, actual);
  const catalog = [], seenPages = new Set(), seenLinks = new Set();
  let url = spec.catalog?.url ? client.assertUrl(httpUrl(spec.catalog.url, spec.sourceUrl)) : first.url;
  const config = spec.catalog;
  if (config?.json) {
    const page = await client.get(url, {fresh: true, request: config.request});
    const parsed = JSON.parse(decode(page.body, page.contentType, spec.encoding));
    const field = (item, key) => key.split('.').reduce((result, part) => result?.[part], item);
    const items = field(parsed, config.json.items);
    if (!Array.isArray(items) || !items.length || items.length > 20000) throw Error('JSON目录条目为空或超过限制');
    const result = [];
    for (const item of items) {
      if (config.json.skip && String(field(item, config.json.skip.field)) === String(config.json.skip.equals)) continue;
      const title = field(item, config.json.title);
      const link = config.json.linkTemplate.replace(/\{([\w.]+)\}/g, (_, key) => {
        const value = field(item, key);
        if (value === undefined || value === null) throw Error('JSON目录链接字段缺失');
        return encodeURIComponent(value);
      });
      const absolute = client.assertUrl(httpUrl(link, spec.sourceUrl));
      if (typeof title !== 'string' || !title.trim() || seenLinks.has(absolute)) throw Error('JSON目录标题缺失或链接重复');
      seenLinks.add(absolute);
      const sourceOrder = config.json.order ? Number(field(item, config.json.order)) : result.length + 1;
      if (!Number.isSafeInteger(sourceOrder) || sourceOrder < 1) throw Error('JSON目录顺序字段无效');
      result.push({title: title.trim(), link: absolute, sourceOrder});
    }
    if (!result.length || new Set(result.map(c => c.sourceOrder)).size !== result.length) throw Error('JSON目录为空或顺序重复');
    if (config.json.order) result.sort((a, b) => a.sourceOrder - b.sourceOrder);
    if (config.expectedCount !== undefined && result.length !== config.expectedCount) throw Error('JSON目录数量与核实值不同');
    return {actual, catalog: result.map((c, i) => ({...c, chapter_number: i + 1})), evidence: {url: page.url, hash: page.hash, fetchedAt: page.fetchedAt}, pages: 1};
  }
  if (!config?.links) throw Error('HTML 来源缺少目录选择器');
  while (url) {
    if (seenPages.has(url)) throw Error('目录翻页形成循环，未使用不完整目录');
    if (seenPages.size >= (config.maxPages || 100)) throw Error('目录页数超过配置上限');
    seenPages.add(url);
    const page = url === first.url ? first : await client.get(url, {fresh: true, render: (config.transport || spec.transport) === 'browser', readySelector: config.readySelector});
    if (page.url !== url) throw Error('目录页面跳转，需核实来源配置');
    const doc = load(decode(page.body, page.contentType, spec.encoding));
    const links = doc(config.links);
    if (!links.length) throw Error(`目录页未匹配章节：${url}`);
    for (const el of links.toArray()) {
      const a = doc(el), href = a.attr('href');
      if (!href) throw Error('目录项缺少链接');
      const link = client.assertUrl(httpUrl(href, page.url));
      if (seenLinks.has(link)) throw Error(`目录链接重复：${link}`);
      seenLinks.add(link);
      const title = (config.titleAttribute ? a.attr(config.titleAttribute) : a.text())?.trim();
      if (!title || title.length > 200) throw Error('目录标题缺失或异常');
      const orderNode = config.orderAncestor ? a.closest(config.orderAncestor) : a;
      const sourceOrder = config.orderAttribute ? Number(orderNode.attr(config.orderAttribute)) : catalog.length + 1;
      if (!Number.isSafeInteger(sourceOrder) || sourceOrder < 1) throw Error('来源目录序号缺失或无效');
      catalog.push({title, link, sourceOrder});
      if (catalog.length > 20000) throw Error('目录超过20000项上限');
    }
    url = nextPage(doc, config.next, page.url, client);
  }
  if (config.orderAttribute) {
    if (new Set(catalog.map(c => c.sourceOrder)).size !== catalog.length) throw Error('来源目录序号重复');
    catalog.sort((a, b) => a.sourceOrder - b.sourceOrder);
  } else if (config.reverse) catalog.reverse();
  if (config.expectedCount !== undefined && config.expectedCount !== catalog.length) throw Error(`目录数量 ${catalog.length} 与已核实的 ${config.expectedCount} 不同`);
  return {actual, catalog: catalog.map((c, i) => ({...c, chapter_number: i + 1})), evidence: {url: first.url, hash: first.hash, fetchedAt: first.fetchedAt}, pages: seenPages.size};
}

export async function getChapter(spec, chapter, catalogLinks, client) {
  const seen = new Set(), parts = [], pageHashes = [], warnings = [];
  const config = spec.chapter;
  let url = chapter.link, title;
  while (url) {
    if (seen.has(url)) throw Error('章节分页形成循环');
    if (seen.size >= (config.maxPages || 20)) throw Error('章节分页超过上限');
    if (url !== chapter.link && catalogLinks.has(url)) throw Error('章节下一页指向另一章，拒绝拼接');
    seen.add(url);
    const response = await client.get(url, {render: (config.transport || spec.transport) === 'browser', readySelector: config.content});
    if (response.url !== url) throw Error('章节页面发生跳转，拒绝错配正文');
    const $ = load(decode(response.body, response.contentType, spec.encoding));
    if (config.rejectSelectors && $(config.rejectSelectors.join(',')).length) throw Error('页面含需额外适配的混淆、订阅或验证标记');
    const heading = selectValue($, config.title);
    if (!title) title = heading;
    else if (normalizedTitle(heading) !== normalizedTitle(title)) throw Error('同章分页标题不一致，需要调整分页标题规则');
    let text = cleanHtml($, config.content, config.remove);
    const lines = text.split('\n');
    if (normalizedTitle(lines[0]) === normalizedTitle(heading)) lines.shift();
    while (/^(?:[（(]本章完[）)]|上一章|下一章|返回目录|加入书签)$/u.test(lines.at(-1) || '')) lines.pop();
    text = lines.join('\n').trim();
    if (!text) throw Error('章节正文为空');
    if (parts.includes(text)) throw Error('同章分页正文重复');
    if (parts.length && parts.at(-1).slice(-100) === text.slice(0, 100) && text.length >= 100) warnings.push('分页之间存在重复段落，未自动删文');
    parts.push(text);
    pageHashes.push({url, hash: response.hash, fetchedAt: response.fetchedAt});
    url = nextPage($, config.next, response.url, client);
  }
  return {...chapter, catalogTitle: chapter.title, title, content: parts.join('\n'), contentFetchedAt: new Date().toISOString(), provenance: pageHashes, extractionWarnings: warnings};
}

export function splitText(text, spec) {
  const config = spec.resource || {};
  if (config.startAfter) {
    const index = text.indexOf(config.startAfter);
    if (index < 0) throw Error('TXT 未找到配置的正文起始边界');
    text = text.slice(index + config.startAfter.length);
  }
  if (config.endBefore) {
    const index = text.lastIndexOf(config.endBefore);
    if (index < 0) throw Error('TXT 未找到配置的正文结束边界');
    text = text.slice(0, index);
  }
  const expression = new RegExp(config.headingPattern || '^\\s*(第[0-9零〇一二三四五六七八九十百千万两]+[章节回][^\\n]{0,90})\\s*$', 'gmu');
  const matches = [...text.matchAll(expression)];
  if (!matches.length) throw Error('TXT 未识别章节标题，需要明确分章规则；不会把整书当作一章');
  const chapters = [];
  const preamble = text.slice(0, matches[0].index).trim();
  if (preamble && config.preamble !== 'metadata') chapters.push({title: '前言', content: preamble});
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    if (!match[0].length) throw Error('分章规则不能匹配空字符串');
    const catalogTitle = (match[1] || match[0]).trim();
    let content = text.slice(match.index + match[0].length, matches[i + 1]?.index ?? text.length).trim();
    let title = catalogTitle;
    if (config.innerHeadingPattern) {
      const lines = content.split(/\r?\n/);
      const inner = new RegExp(config.innerHeadingPattern, 'u').exec(lines[0]);
      if (inner) { title = (inner[1] || inner[0]).trim(); lines.shift(); content = lines.join('\n').trim(); }
    }
    chapters.push({title, catalogTitle, content});
  }
  chapters.preamble = preamble;
  return chapters;
}

export async function getResource(spec, client, jobDir) {
  const evidence = await client.get(spec.sourceUrl, {fresh: true});
  const $ = load(decode(evidence.body, evidence.contentType, spec.encoding));
  const actual = {title: selectValue($, spec.metadata.title), author: selectValue($, spec.metadata.author)};
  checkIdentity(spec, actual);
  const config = spec.resource;
  if (!config.url && ($(config.link).length !== 1 || !$(config.link).attr('href'))) throw Error('文件下载链接必须唯一且含 href');
  const resourceUrl = config.url || httpUrl($(config.link).attr('href'), evidence.url);
  const response = await client.get(resourceUrl);
  let chapters;
  if (spec.kind === 'txt') {
    let bytes = response.body;
    if (config.compression === 'zip') {
      const file = path.join(jobDir, 'source.zip');
      atomicWrite(file, bytes);
      const args = [fileURLToPath(new URL('./epub.py', import.meta.url)), file, '--txt', ...(config.entry ? [config.entry] : [])];
      const result = spawnSync(process.env.NOVEL_CRAWLER_PYTHON || 'python', args, {maxBuffer: 128 * 1024 * 1024, timeout: 60000, windowsHide: true});
      if (result.error || result.status !== 0) throw Error(`TXT ZIP 解析失败：${result.error?.message || result.stderr.toString().slice(0, 500)}`);
      bytes = result.stdout;
    }
    const text = decode(bytes, config.compression ? '' : response.contentType, config.encoding);
    if (/^\s*(?:<!doctype html|<html)/i.test(text)) throw Error('TXT 下载返回了网页');
    chapters = splitText(text, spec);
  } else {
    const file = path.join(jobDir, 'source.epub');
    atomicWrite(file, response.body);
    const result = spawnSync(process.env.NOVEL_CRAWLER_PYTHON || 'python', [fileURLToPath(new URL('./epub.py', import.meta.url)), file], {encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, timeout: 60000, windowsHide: true});
    if (result.error || result.status !== 0) throw Error(`EPUB 解析失败：${result.error?.message || result.stderr.trim().slice(0, 500)}`);
    const parsed = JSON.parse(result.stdout);
    checkIdentity(spec, parsed.metadata);
    chapters = parsed.chapters;
  }
  if (config.expectedCount !== undefined && chapters.length !== config.expectedCount) throw Error(`分章数量 ${chapters.length} 与已核实的 ${config.expectedCount} 不同`);
  if (!chapters.length || chapters.length > 20000) throw Error('资源章节数量无效');
  if (chapters.preamble) atomicWrite(path.join(jobDir, 'source-preamble.txt'), chapters.preamble);
  let complete = chapters.map((c, i) => ({...c, catalogTitle: c.catalogTitle || c.title, chapter_number: i + 1, sourceOrder: i + 1, link: `${response.url}#chapter-${i + 1}`, contentFetchedAt: response.fetchedAt, provenance: [{url: response.url, hash: response.hash, fetchedAt: response.fetchedAt}]}));
  let catalog = complete.map(({content, ...c}) => c);
  if (spec.catalog) {
    const reference = await getCatalog(spec, client);
    catalog = reference.catalog;
    if (complete.length > catalog.length) throw Error('文件分章数量超过在线目录，拒绝猜测章节对应');
    for (let i = 0; i < complete.length; i++) {
      if (normalizedTitle(complete[i].catalogTitle) !== normalizedTitle(catalog[i].title)) throw Error(`文件与在线目录第${i + 1}项标题不同，拒绝按近似标题合并`);
      complete[i] = {...complete[i], link: catalog[i].link, chapter_number: catalog[i].chapter_number, sourceOrder: catalog[i].sourceOrder};
    }
    atomicWrite(path.join(jobDir, 'resource-catalog-check.json'), {resourceChapters: complete.length, onlineChapters: catalog.length, matchedPrefix: complete.length, missing: catalog.slice(complete.length), evidence: reference.evidence});
  }
  atomicWrite(path.join(jobDir, 'resource-metadata.json'), {url: response.url, hash: response.hash, bytes: response.bytes});
  return {actual, catalog, chapters: complete, evidence: {url: evidence.url, hash: evidence.hash, fetchedAt: evidence.fetchedAt}};
}
