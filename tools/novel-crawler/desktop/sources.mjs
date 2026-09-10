import fs from 'node:fs';
import path from 'node:path';
import {load} from 'cheerio';
import {projectRoot, defaultStateDir, validateSpec} from '../core.mjs';
import {readJson, atomicWrite} from '../storage.mjs';
import {makeClient, httpUrl, decode} from '../http.mjs';
import {selectValue} from '../adapters.mjs';
import {checkIdentity, normalizedTitle} from '../quality.mjs';
import {normalizedIdentity} from '../identity.mjs';

export const sitesDir = path.join(projectRoot, 'tools/novel-crawler/sites');

export function normalizeWebsite(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000) throw Error('请输入有效的网站地址');
  const url = new URL(httpUrl(/^[a-z][\w+.-]*:/i.test(value.trim()) ? value.trim() : `https://${value.trim()}`));
  if (url.port || url.hostname === 'localhost' || /^[\d.]+$/.test(url.hostname) || url.hostname.includes(':')) throw Error('网站栏需要填写公开网站的域名或书籍详情页');
  return url.href;
}

export function loadSites(directory = sitesDir) {
  const sites = [], errors = [];
  for (const file of fs.readdirSync(directory).filter(f => f.endsWith('.json')).sort()) {
    try {
      const site = readJson(path.join(directory, file));
      if (site.version !== 1 || !/^[a-z0-9-]+$/.test(site.id) || !site.name || !Array.isArray(site.hosts) || !site.hosts.length || !site.book?.metadata || !site.spec) throw Error('站点配置缺少必要字段');
      for (const host of site.hosts) if (new URL(normalizeWebsite(host)).hostname !== host || host.includes('/')) throw Error('hosts 必须是小写域名');
      if (!site.hosts.includes(new URL(normalizeWebsite(site.home)).hostname)) throw Error('home 不在 hosts 内');
      new RegExp(site.book.urlPattern, 'u');
      if (sites.some(s => s.id === site.id || s.hosts.some(h => site.hosts.includes(h)))) throw Error('站点 ID 或域名重复');
      sites.push(site);
    } catch (error) { errors.push(`${file}：${error.message}`); }
  }
  return {sites, errors};
}

export function rememberWebsite(stateDir, website) {
  const normalized = normalizeWebsite(website);
  const origin = new URL(normalized).origin + '/';
  const file = path.join(stateDir, 'desktop-settings.json');
  const previous = readJson(file, {});
  // Remember sites, not individual book URLs, so the next title searches the whole site.
  const recentWebsites = [...new Set([origin, ...(previous.recentWebsites || [])])];
  const next = {version: 1, lastWebsite: origin, recentWebsites};
  atomicWrite(file, next);
  return next;
}

export function readSettings(stateDir) {
  return readJson(path.join(stateDir, 'desktop-settings.json'), {version: 1, lastWebsite: '', recentWebsites: []});
}

export function fillTemplate(value, context) {
  if (typeof value === 'string') return value.replace(/\$\{(\w+)\}/g, (_, key) => {
    if (!Object.hasOwn(context, key)) throw Error(`配置引用了未知变量：${key}`);
    return context[key];
  });
  if (Array.isArray(value)) return value.map(v => fillTemplate(v, context));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillTemplate(v, context)]));
  return value;
}

function makeSiteClient(site, stateDir) {
  return makeClient({cacheDir: path.join(stateDir, 'cache'), allowedHosts: [...new Set([...site.hosts, ...(site.spec.allowedHosts || [])])], delayMs: site.spec.delayMs, timeoutMs: site.spec.timeoutMs, browser: site.spec.browser});
}

function siteFor(website, sites) {
  const site = sites.find(s => s.hosts.includes(new URL(website).hostname));
  if (!site) throw Error('这个网站还没有适配。把网址发给 Codex，并说“用 novel-source-adapter 适配这个网站”。');
  return site;
}

function bookUrl(url, site) {
  const parsed = new URL(url);
  const match = new RegExp(site.book.urlPattern, 'u').exec(parsed.pathname);
  if (!site.hosts.includes(parsed.hostname) || !match) throw Error('请填写网站首页或书籍详情页，不是章节阅读页');
  return match;
}

export function parseSearch(html, baseUrl, site) {
  const $ = load(html), results = [];
  for (const element of $(site.search.items).toArray()) {
    const row = load($.html(element));
    const title = selectValue(row, site.search.title), author = selectValue(row, site.search.author);
    const url = httpUrl(selectValue(row, {selector: site.search.link, attribute: 'href'}), baseUrl);
    bookUrl(url, site);
    results.push({title, author, url, site: site.name});
  }
  const next = site.search.next ? $(site.search.next) : null;
  if (next?.length > 1) throw Error('搜索下一页规则不唯一，需要更新适配');
  return {results, next: next?.attr('href') ? httpUrl(next.attr('href'), baseUrl) : null};
}

export async function searchBooks({website, title, author = '', stateDir = defaultStateDir, sites = loadSites().sites}) {
  website = normalizeWebsite(website);
  if (typeof title !== 'string' || !title.trim() || title.length > 200 || typeof author !== 'string' || author.length > 200) throw Error('请输入书名，书名和作者各不超过 200 字');
  const site = siteFor(website, sites), client = makeSiteClient(site, stateDir);
  try {
    if (new URL(website).pathname !== '/') {
      bookUrl(website, site);
      const response = await client.get(website, {fresh: true, render: (site.book.transport || site.spec.transport) === 'browser', readySelector: site.book.readySelector});
      const $ = load(decode(response.body, response.contentType, site.spec.encoding));
      const book = {title: selectValue($, site.book.metadata.title), author: selectValue($, site.book.metadata.author), url: response.url, site: site.name};
      checkIdentity({title, author: author || book.author, identityNormalization: site.spec.identityNormalization}, book);
      bookUrl(book.url, site);
      return [book];
    }
    if (!site.search) throw Error('该网站暂时只支持书籍详情页，请把网站栏换成书籍详情页地址');
    let url = fillTemplate(site.search.url, {query: encodeURIComponent(title.trim())});
    const seen = new Set();
    for (let page = 0; url && page < Math.min(site.search.maxPages || 3, 20); page++) {
      if (seen.has(url)) throw Error('搜索翻页循环，需要更新适配');
      seen.add(url);
      const response = await client.get(url, {fresh: true, render: (site.search.transport || site.spec.transport) === 'browser', readySelector: site.search.readySelector});
      const parsed = parseSearch(decode(response.body, response.contentType, site.spec.encoding), response.url, site);
      const normalize = value => normalizedIdentity(value, site.spec.identityNormalization);
      const matches = parsed.results.filter(b => normalize(b.title) === normalize(title) && (!author.trim() || normalize(b.author) === normalize(author)));
      if (matches.length) return [...new Map(matches.map(b => [b.url, b])).values()];
      url = parsed.next;
    }
    return [];
  } finally { await client.close(); }
}

export async function resolveBook({url, title, author, stateDir = defaultStateDir, sites = loadSites().sites, reuseSaved = false}) {
  url = normalizeWebsite(url);
  const site = siteFor(url, sites), match = bookUrl(url, site), client = makeSiteClient(site, stateDir);
  try {
    const response = await client.get(url, {fresh: true, render: (site.book.transport || site.spec.transport) === 'browser', readySelector: site.book.readySelector});
    if (response.url !== url) throw Error('书籍详情页地址发生跳转，需要核实适配');
    const $ = load(decode(response.body, response.contentType, site.spec.encoding));
    const actual = {title: selectValue($, site.book.metadata.title), author: selectValue($, site.book.metadata.author)};
    checkIdentity({title, author, identityNormalization: site.spec.identityNormalization}, actual);
    if (reuseSaved) {
      const registry = readJson(path.join(stateDir, 'sources.json'), {sites: {}});
      const saved = Object.values(registry.sites[new URL(url).hostname]?.books || {}).filter(b => b.sourceUrl === url && b.verified && normalizedTitle(b.title) === normalizedTitle(title) && normalizedTitle(b.author) === normalizedTitle(author)).sort((a, b) => b.lastChecked.localeCompare(a.lastChecked))[0];
      if (saved && /^[a-f0-9]{20}$/.test(saved.jobId)) {
        const spec = readJson(path.join(stateDir, 'jobs', saved.jobId, 'spec.json'));
        if (spec && spec.sourceUrl === url && normalizedTitle(spec.title) === normalizedTitle(title) && normalizedTitle(spec.author) === normalizedTitle(author)) return validateSpec(spec);
      }
    }
    return validateSpec(fillTemplate(site.spec, {...match.groups, title: actual.title, author: actual.author, sourceUrl: url}));
  } finally { await client.close(); }
}
