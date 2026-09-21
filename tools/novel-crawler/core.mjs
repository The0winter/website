import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {atomicWrite, atomicWriteIfChanged, readJson, hash, safeName, withLock} from './storage.mjs';
import {makeClient, httpUrl} from './http.mjs';
import {getCatalog, getChapter, getResource, refreshNextChapter} from './adapters.mjs';
import {navigationCatalog, mergeRecent, navigationReport} from './navigation.mjs';
import {chapterQuality, qualityReport, sampleCatalog, normalizedTitle} from './quality.mjs';
import {formatChapterForExport, preserveCatalogLabels} from './titles.mjs';
import {prepareImport} from '../../infra/import-plan.mjs';
import {failureDetails} from './diagnostics.mjs';
import {browserProfile} from './browser-session.mjs';
import {loadReadingEdition, adoptReadingEdition, updateReadingEdition, recordReadingNoticeReview, recordReadingNumberingReview, recordReadingCatalogCorrection, preserveReviewedCatalogLabels} from './reading-edition.mjs';
import {continuationKey, continuationState, hasContinuation, acquireContinuation} from './continuation.mjs';
import {applyVerifiedBookCategory, categoryFields, hasBookCategory, mergeBookCategory} from './categories.mjs';
import {lookupPublisherCategory} from './publisher-category.mjs';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const defaultStateDir = path.join(projectRoot, '.novel-crawler');

export function validateSpec(input) {
  const spec = structuredClone(input);
  if (spec.version !== 1) throw Error('来源配置 version 必须为1');
  for (const field of ['title', 'author']) if (typeof spec[field] !== 'string' || !spec[field].trim() || spec[field].length > 200) throw Error(`缺少有效 ${field}`);
  spec.sourceUrl = httpUrl(spec.sourceUrl);
  if (!['html', 'txt', 'epub'].includes(spec.kind)) throw Error('kind 只支持 html、txt、epub');
  if (spec.transport !== undefined && !['http', 'browser'].includes(spec.transport)) throw Error('transport 只支持 http 或 browser');
  if (spec.identityNormalization !== undefined && spec.identityNormalization !== 'chinese-simplified') throw Error('未知的作品名称归一化方式');
  if (spec.browser) {
    for (const key of ['headless', 'minimized']) if (spec.browser[key] !== undefined && typeof spec.browser[key] !== 'boolean') throw Error(`browser.${key} 必须为布尔值`);
    if (spec.browser.responseMode !== undefined && !['dom', 'source'].includes(spec.browser.responseMode)) throw Error('browser.responseMode 只支持 dom 或 source');
    if (spec.browser.manualVerificationMs !== undefined && (!Number.isInteger(spec.browser.manualVerificationMs) || spec.browser.manualVerificationMs < 1000 || spec.browser.manualVerificationMs > 600000)) throw Error('browser.manualVerificationMs 必须在 1000–600000 毫秒之间');
    for (const key of ['manualLogin', 'manualCaptcha']) if (spec.browser[key]) {
      const action = spec.browser[key];
      if (typeof action.selector !== 'string' || !action.selector.trim() || (action.openSelector !== undefined && (typeof action.openSelector !== 'string' || !action.openSelector.trim()))) throw Error(`browser.${key} 需要有效的人工操作标记选择器`);
      if (!Number.isInteger(action.timeoutMs) || action.timeoutMs < 1000 || action.timeoutMs > 600000) throw Error(`browser.${key}.timeoutMs 必须在 1000–600000 毫秒之间`);
    }
    if (spec.browser.resourceHosts !== undefined && (!Array.isArray(spec.browser.resourceHosts) || spec.browser.resourceHosts.some(host => typeof host !== 'string' || !/^[a-z0-9.-]+$/.test(host) || host.startsWith('.') || host.endsWith('.')))) throw Error('browser.resourceHosts 只能包含明确的小写资源域名');
  }
  if (!spec.metadata?.title || !spec.metadata?.author) throw Error('必须配置来源页面书名和作者提取规则');
  if (spec.description !== undefined && (typeof spec.description !== 'string' || spec.description.length > 5000)) throw Error('简介须为不超过 5000 字符的文本');
  if (spec.status !== undefined && !['连载', '完结'].includes(spec.status)) throw Error('作品状态必须为连载或完结');
  if (spec.category !== undefined && (typeof spec.category !== 'string' || spec.category.length > 80)) throw Error('分类须为不超过 80 字符的文本');
  if (spec.kind === 'html' && (!(spec.catalog?.links || spec.catalog?.json) || !spec.chapter?.content || !spec.chapter?.title)) throw Error('HTML 来源需配置目录及章节选择器');
  if (spec.catalog?.link && (spec.catalog.url || spec.catalog.json || spec.catalog.selectPages || spec.catalog.walk)) throw Error('目录入口 link 不能与 url、JSON、下拉或顺序目录混用');
  if (spec.catalog?.titlePattern !== undefined) {
    const pattern = spec.catalog.titlePattern;
    if (spec.catalog.json || typeof pattern !== 'string' || !pattern || pattern.length > 2000) throw Error('catalog.titlePattern 需要有效的 HTML 目录标题正则表达式');
    if (new RegExp(pattern, 'u').test('')) throw Error('目录标题规则不能匹配空字符串');
  }
  for (const field of ['chapter', 'resource']) if (spec[field]?.removeText !== undefined) {
    if (field === 'resource' && spec.kind !== 'txt') throw Error('resource.removeText 只支持 TXT');
    const patterns = spec[field].removeText;
    if (!Array.isArray(patterns) || patterns.some(pattern => typeof pattern !== 'string' || !pattern || pattern.length > 2000)) throw Error(`${field}.removeText 必须为非空正则表达式数组`);
    for (const pattern of patterns) if (new RegExp(pattern, 'gu').test('')) throw Error('正文噪声规则不能匹配空字符串');
  }
  if (spec.catalog?.selectPages) {
    const config = spec.catalog.selectPages;
    if (!config.selector || !config.content || !Number.isInteger(config.maxPages) || config.maxPages < 1 || config.maxPages > 100 || spec.catalog.next || spec.catalog.json) throw Error('目录下拉分页需要 selector、content、maxPages（1–100），不能混用其他翻页方式');
  }
  if (spec.catalog?.walk) {
    const walk = spec.catalog.walk;
    if (spec.kind !== 'html' || !spec.catalog.count || spec.catalog.next || spec.catalog.selectPages || spec.catalog.json || !walk.next || !walk.bookLink || !walk.recentLinks || typeof walk.chapterPattern !== 'string' || !walk.chapterPattern.includes('(?<chapterId>')) throw Error('顺序采集需要目录总数、下一章、书籍链接、最新列表和本书章节路径规则，不能混用目录翻页');
    new RegExp(walk.chapterPattern, 'u');
  }
  if (spec.kind !== 'html' && !(spec.resource?.url || spec.resource?.link || spec.resource?.parts)) throw Error('文件来源需配置下载地址或链接选择器');
  if (spec.resource?.decodeTitleEntities !== undefined && (spec.kind !== 'txt' || typeof spec.resource.decodeTitleEntities !== 'boolean')) throw Error('decodeTitleEntities 只支持 TXT 布尔值');
  if (spec.resource?.decodeContentEntities !== undefined && (spec.kind !== 'txt' || typeof spec.resource.decodeContentEntities !== 'boolean')) throw Error('decodeContentEntities 只支持 TXT 布尔值');
  if (spec.resource?.catalogPrefix !== undefined) {
    const prefix = spec.resource.catalogPrefix;
    if (spec.kind !== 'txt' || !spec.catalog || !spec.chapter?.title || !spec.chapter?.content || !Number.isInteger(prefix?.count) || prefix.count < 1 || prefix.count > 20000 || typeof prefix.reason !== 'string' || !prefix.reason.trim() || prefix.reason.length > 2000) throw Error('catalogPrefix 需要 TXT、在线目录、正文规则、已核实的前缀数量和原因');
  }
  if (spec.resource?.parts !== undefined) {
    const {parts, url, link, compression} = spec.resource;
    if (spec.kind !== 'txt' || url || link || compression || !spec.catalog || !Array.isArray(parts) || !parts.length || parts.length > 40) throw Error('分段 TXT 需要在线目录和 1–40 个文件，不能混用单文件或压缩格式');
    const urls = new Set();
    let count = 0;
    for (const part of parts) {
      if (!part || typeof part.url !== 'string' || !Number.isInteger(part.expectedCount) || part.expectedCount < 1 || part.expectedCount > 20000) throw Error('每个 TXT 分段需要地址和已核实的章节数');
      part.url = httpUrl(part.url);
      if (urls.has(part.url)) throw Error('TXT 分段下载地址重复');
      urls.add(part.url); count += part.expectedCount;
    }
    if (count > 20000) throw Error('TXT 分段总章节数超限');
  }
  spec.allowedHosts = [...new Set([new URL(spec.sourceUrl).hostname, ...(spec.allowedHosts || [])])];
  for (const host of spec.allowedHosts) if (typeof host !== 'string' || !host || /[\s/@?#]/.test(host)) throw Error('allowedHosts 只能包含域名');
  for (const [field, lower, upper] of [['delayMs', 200, 60000], ['retries', 0, 5], ['timeoutMs', 1000, 60000]]) if (spec[field] !== undefined && (!Number.isInteger(spec[field]) || spec[field] < lower || spec[field] > upper)) throw Error(`${field} 超出范围`);
  if (spec.maxChapterPages !== undefined && (!spec.chapter || !Number.isInteger(spec.maxChapterPages) || spec.maxChapterPages < (spec.chapter.maxPages || 20) || spec.maxChapterPages > 100)) throw Error('maxChapterPages 必须不小于原分页上限且不超过100');
  return spec;
}

export function jobId(spec) {
  return hash({title: normalizedTitle(spec.title), author: normalizedTitle(spec.author), sourceUrl: spec.sourceUrl, ...(spec.variant ? {variant: spec.variant} : {})}).slice(0, 20);
}

export function extractionHash(spec) {
  const {delayMs, retries, timeoutMs, maxChapterPages, searchUrl, description, status, statusDetection, statusEvidence, category, categoryDetection, categoryEvidence, ...extraction} = spec;
  // A larger bounded request budget changes only where an incomplete fetch
  // stops. All page identity, navigation and text extraction rules stay pinned.
  // Book metadata changes do not affect chapter identity, order or extraction.
  if (extraction.metadata) {
    const {description: descriptionRule, status: statusRule, category: categoryRule, ...metadata} = extraction.metadata;
    extraction.metadata = metadata;
  }
  if (extraction.browser) {
    // Login waiting and subresource loading do not change source-text extraction.
    const {manualVerificationMs, manualLogin, manualCaptcha, resourceHosts, ...browser} = extraction.browser;
    extraction.browser = browser;
  }
  return hash(extraction);
}

function exportPath(spec, id, outputDir) {
  return path.join(path.resolve(outputDir || path.join(projectRoot, 'downloads')), `${safeName(spec.title)}--${safeName(spec.author)}--${id.slice(0, 8)}.json`);
}

export function localBookState(spec, {stateDir = defaultStateDir, outputDir, inspection} = {}) {
  spec = validateSpec(spec);
  try {
    const continuation = continuationState(spec, {stateDir: path.resolve(stateDir), outputDir: path.resolve(outputDir || path.join(projectRoot, 'downloads')), inspection});
    if (continuation) return continuation;
  } catch (error) { return {state: 'blocked', blocked: true, saved: 0, total: 0, message: error.message}; }
  const id = jobId(spec), dir = path.join(stateDir, 'jobs', id);
  try {
    const reading = loadReadingEdition(dir, spec, extractionHash(spec), outputDir || path.join(projectRoot, 'downloads'), {inspection});
    const previous = inspection?.jobs.find(job => job.dir === dir)?.spec || readJson(path.join(dir, 'spec.json'));
    if (!previous) return {state: 'new', saved: 0, total: 0, message: '尚未采集'};
    if (extractionHash(previous) !== extractionHash(spec)) return {state: 'incompatible', saved: 0, total: 0, message: '来源规则已有变化，旧进度保留，需先核对适配规则。'};
    const catalog = readJson(path.join(dir, 'catalog.json'), []), chaptersDir = path.join(dir, 'chapters');
    const files = new Set(fs.existsSync(chaptersDir) ? fs.readdirSync(chaptersDir) : []);
    const saved = catalog.filter(entry => files.has(hash(entry.link) + '.json')).length;
    const exported = readJson(path.join(dir, 'export.json')), file = exportPath(spec, id, outputDir);
    const fileExists = fs.existsSync(file), fileValid = fileExists && exported?.path === file && (inspection?.files.get(file)?.hash || hash(fs.readFileSync(file))) === exported.hash;
    const total = spec.catalog?.walk ? readJson(path.join(dir, 'navigation-state.json'), {}).expectedCount || catalog.length : catalog.length;
    if (reading) {
      const readingCount = reading.book.chapters.length;
      const complete = reading.sources.length === total && saved === total && fs.existsSync(reading.outputPath);
      return {state: complete ? 'complete' : 'partial', saved, total, readingEdition: true, readingCount, message: `已绑定网站阅读版 · ${readingCount} 项；${complete ? '检查更新' : '继续采集'}会自动沿用来源映射整理并导出。`};
    }
    if (fileExists && !fileValid) return {state: 'modified', saved, total, message: `已保存 ${saved} / ${total} 章；导出文件存在或已被修改，程序会保护它，拒绝覆盖。`};
    if (saved && saved === total && fileValid) return {state: 'complete', saved, total, message: `已下载完成 · ${saved} 章。再次采集会检查更新，已有正文不会重复下载。`};
    return {state: saved ? 'partial' : 'new', saved, total, message: saved ? `已保存 ${saved} / ${total} 章；继续时自动补齐缺少的章节。` : '尚未保存章节'};
  } catch (error) { return {state: 'unknown', saved: 0, total: 0, message: `本地记录需要核对；旧文件会保留。${error.message}`}; }
}

export async function bindReadingEdition(input, file, {stateDir = defaultStateDir, outputDir = path.join(projectRoot, 'downloads'), sourceOrderReview} = {}) {
  const spec = validateSpec(input), dir = path.join(path.resolve(stateDir), 'jobs', jobId(spec));
  return withLock(path.join(dir, 'job.lock'), async () => {
    const previous = readJson(path.join(dir, 'spec.json'));
    if (!previous || extractionHash(previous) !== extractionHash(spec)) throw Error('没有与当前规则匹配的原始采集记录');
    return adoptReadingEdition(dir, spec, extractionHash(spec), path.resolve(file), path.resolve(outputDir), sourceOrderReview);
  });
}

export async function reviewReadingNotice(input, review, {stateDir = defaultStateDir, outputDir = path.join(projectRoot, 'downloads')} = {}) {
  const spec = validateSpec(input), dir = path.join(path.resolve(stateDir), 'jobs', jobId(spec));
  return withLock(path.join(path.resolve(stateDir), 'book-locks', continuationKey(spec) + '.lock'), () =>
    withLock(path.join(dir, 'job.lock'), () => recordReadingNoticeReview(dir, spec, extractionHash(spec), path.resolve(outputDir), review)));
}

export async function reviewReadingNumbering(input, review, {stateDir = defaultStateDir, outputDir = path.join(projectRoot, 'downloads')} = {}) {
  const spec=validateSpec(input),dir=path.join(path.resolve(stateDir),'jobs',jobId(spec));
  return withLock(path.join(path.resolve(stateDir),'book-locks',continuationKey(spec)+'.lock'),()=>
    withLock(path.join(dir,'job.lock'),()=>recordReadingNumberingReview(dir,spec,extractionHash(spec),path.resolve(outputDir),review)));
}

export async function reviewReadingCatalogNumber(input, review, {stateDir = defaultStateDir, outputDir = path.join(projectRoot, 'downloads')} = {}) {
  const spec = validateSpec(input), dir = path.join(path.resolve(stateDir), 'jobs', jobId(spec));
  if (spec.catalog?.walk) throw Error('目录编号修正需要完整目录来源');
  return withLock(path.join(path.resolve(stateDir), 'book-locks', continuationKey(spec) + '.lock'), () => withLock(path.join(dir, 'job.lock'), async () => {
    const responses = [], client = makeClient({cacheDir:path.join(stateDir,'cache'),allowedHosts:spec.allowedHosts,delayMs:spec.delayMs,retries:spec.retries,timeoutMs:spec.timeoutMs,browser:spec.browser});
    const fresh = {assertUrl:client.assertUrl,get:async (url, options) => { const r = await client.get(url,{...options,fresh:true}); responses.push(r); return r; }};
    try {
      const source = await getCatalog(spec, fresh), entry = source.catalog.find(c=>c.link===review.link);
      if (!entry) throw Error('核对章节已不在来源目录');
      const chapter = await getChapter(spec, entry, new Set(source.catalog.map(c=>c.link)), fresh);
      return recordReadingCatalogCorrection(dir,spec,extractionHash(spec),path.resolve(outputDir),review,source,chapter,responses);
    } finally { await client.close(); }
  }));
}

function bookData(spec, chapters) {
  return {
    title: spec.title, author: spec.author, sourceUrl: spec.sourceUrl,
    ...(hasBookCategory(spec.category) ? categoryFields(spec) : {}),
    ...Object.fromEntries(['category', 'description', 'status', 'cover_image', 'authorSourceUrl'].filter(key => spec[key] !== undefined).map(key => [key, spec[key]])),
    chapters: [...chapters].sort((a, b) => a.chapter_number - b.chapter_number).map(formatChapterForExport),
  };
}

function reportMarkdown(report) {
  const literal = value => String(value).replace(/[\\`*_\[\]<>|]/g, '\\$&').replace(/[\r\n]/g, ' ');
  const counts = new Map();
  for (const issue of report.issues) counts.set(issue.code, (counts.get(issue.code) || 0) + 1);
  return [
    `# ${literal(report.title)} · ${report.mode === 'probe' ? '试采' : '下载'}报告`, '',
    `作者：${literal(report.author)}。检查时间：${report.checkedAt}。`, '',
    `来源：[${literal(new URL(report.sourceUrl).hostname)}](${report.sourceUrl})`, '',
    '| 项目 | 结果 |', '| --- | --- |',
    `| ${report.readingEdition ? '网站阅读版条目' : '来源目录项'} | ${report.expected} |`, `| 已采集 | ${report.downloaded} |`,
    ...(report.readingEdition ? [`| 本次追加阅读条目 | ${report.readingAdded} |`, `| 原始来源已采集 / 总数 | ${report.sourceDownloaded} / ${report.sourceExpected} |`, `| 原始来源错误 / 警告（单独保留） | ${report.sourceErrors} / ${report.sourceWarnings} |`] : []),
    `| 相对来源目录完整 | ${report.completeAgainstSource ? '是' : '否'} |`,
    ...(report.sourceGaps?.length ? [`| 已核实阅读范围通过验收 | ${report.completeSelectedScope ? '是' : '否'} |`, `| 已记录缺文（未计入阅读正文） | ${report.sourceGaps.length} |`] : []),
    `| 严重问题 | ${report.errors} |`, `| 待核对警告 | ${report.warnings} |`,
    `| 编号等信息提示 | ${report.information} |`, '',
    `简介：${report.description ? `${report.description.length} 字符${report.descriptionStatus === 'truncated' ? '（来源简介超过 5000 字符，已截取）' : report.descriptionStatus === 'retained' ? '（沿用已保存简介）' : ''}` : '未获取，导出时省略该字段'}。`, '',
    `作品状态：${report.status === '完结' ? '已完结' : report.status === '连载' ? '连载中' : '未识别，导出时省略该字段'}${report.statusDetection === 'conflict-retained' ? '（来源仍标连载，保留已确认的完结状态）' : report.statusDetection === 'retained' ? '（未取得有效新状态，沿用已保存状态）' : ''}。`, '',
    ...(report.paused ? ['任务已主动暂停；缺失项表示尚未继续采集，不能据此判定来源缺章。', ''] : []),
    report.limitation, '',
    '## 问题分类', '',
    ...(report.sourceGaps || []).map(gap => `- 来源第 ${gap.position} 项：${literal(gap.reason)}；[核对证据](${gap.evidence.url})`),
    ...(counts.size ? [...counts].map(([code, count]) => `- ${code}：${count}`) : ['未发现已检测类别的问题。']), '',
    '编号差异保留目录标题和正文原标题；短章不删除，相似正文不自动合并。警告不等于已经确认有错误。', '',
    ...(report.failures.length ? ['## 失败与处理方法', '', ...report.failures.slice(0, 20).flatMap(item => [`- ${item.chapter ? `第 ${item.chapter} 项 ${literal(item.title || '')}：` : ''}${literal(item.error)}`, ...(item.url || item.link ? [`  来源：${literal(item.url || item.link)}`] : []), `  下一步：${literal(item.nextStep || failureDetails(item).nextStep)}`]), ''] : []),
    report.exportFile ? `输出文件：[${literal(path.basename(report.exportFile))}](<${report.exportFile.replaceAll('\\', '/')}>)` : '本次没有生成完整导出文件，已取得的内容保留在任务检查点中。', '',
    '完整问题清单、来源响应哈希及缺失项见同目录的 JSON 报告。', '',
  ].join('\n');
}

const registryWrites = new Map();
async function recordSource(stateDir, spec, report, id) {
  const lock = path.join(stateDir, 'registry.lock');
  const work = (registryWrites.get(lock) || Promise.resolve()).catch(() => {}).then(() => withLock(lock, async () => {
    const file = path.join(stateDir, 'sources.json');
    const registry = readJson(file, {version: 1, sites: {}});
    const host = new URL(spec.sourceUrl).hostname;
    const site = registry.sites[host] || {host, books: {}};
    const key = jobId({...spec, variant: undefined});
    const previousVersions = Object.values(site.books).filter(b => b.sourceUrl === spec.sourceUrl && normalizedTitle(b.title) === normalizedTitle(spec.title) && normalizedTitle(b.author) === normalizedTitle(spec.author));
    const previous = previousVersions.sort((a, b) => b.lastChecked.localeCompare(a.lastChecked))[0] || {};
    const item = {...previous, title: spec.title, author: spec.author, sourceUrl: spec.sourceUrl, jobId: id, specFile: path.join(stateDir, 'jobs', id, 'spec.json'), lastChecked: report.checkedAt, lastMode: report.mode, score: report.score, errors: report.errors, warnings: report.warnings, downloaded: report.downloaded, expected: report.expected};
    item.verified = report.structuralPass && (report.completeAgainstSource || (report.mode === 'probe' && previous.verified && report.expected === previous.expected));
    item.samplePassed = report.mode === 'probe' && report.structuralPass;
    for (const [oldKey, book] of Object.entries(site.books)) if (previousVersions.includes(book)) delete site.books[oldKey];
    site.books[key] = item;
    site.lastChecked = report.checkedAt;
    if (spec.searchUrl) site.searchUrl = spec.searchUrl;
    const books = Object.values(site.books);
    site.verifiedBooks = books.filter(b => b.verified).length;
    site.sampledBooks = books.filter(b => b.samplePassed).length;
    site.score = Math.round(books.reduce((sum, b) => sum + b.score, 0) / books.length);
    registry.sites[host] = site;
    atomicWrite(file, registry);
  }));
  registryWrites.set(lock, work);
  try { await work; }
  finally { if (registryWrites.get(lock) === work) registryWrites.delete(lock); }
}

export async function acquire(input, options = {}) {
  const stateDir = path.resolve(options.stateDir || defaultStateDir), mode = options.mode || 'probe';
  const spec = applyVerifiedBookCategory(validateSpec(input), stateDir, input.identityNormalization);
  if (!['probe', 'download'].includes(mode)) throw Error('未知采集模式');
  return withLock(path.join(stateDir, 'book-locks', continuationKey(spec) + '.lock'), async () => {
    if (options.publisherCategories && spec.categoryDetection !== 'verified' && (!spec.category || spec.category === '未分类' || spec.categoryEvidence?.kind === 'source')) {
      const publisher = await lookupPublisherCategory(spec, stateDir);
      Object.assign(spec, mergeBookCategory(spec, publisher));
    }
    if (options.continuation || hasContinuation(spec, stateDir)) return acquireContinuation(spec, {...options, stateDir, mode, outputDir: path.resolve(options.outputDir || path.join(projectRoot, 'downloads')), extraction: extractionHash(spec), id: jobId(spec)});
    return acquireRaw(spec, options);
  });
}

async function acquireRaw(input, options = {}) {
  const spec = validateSpec(input), mode = options.mode || 'probe';
  if (!['probe', 'download'].includes(mode)) throw Error('未知采集模式');
  const stateDir = path.resolve(options.stateDir || defaultStateDir), id = jobId(spec);
  const dir = path.join(stateDir, 'jobs', id), chaptersDir = path.join(dir, 'chapters');
  return withLock(path.join(dir, 'job.lock'), async () => {
    const specFile = path.join(dir, 'spec.json'), previousSpec = readJson(specFile);
    if (previousSpec && extractionHash(previousSpec) !== extractionHash(spec) && fs.existsSync(chaptersDir) && fs.readdirSync(chaptersDir).length) throw Error(`提取规则发生变化，请使用新的 --state-dir 重新试采，避免混用旧正文：${dir}`);
    const outputDir = path.resolve(options.outputDir || path.join(projectRoot, 'downloads'));
    const reading = loadReadingEdition(dir, spec, extractionHash(spec), outputDir, {resume: true});
    if (reading && options.refresh) throw Error('已绑定阅读版不能强制刷新原始正文；请使用普通检查更新以保留已核对的映射');
    if (!spec.description && previousSpec?.description) spec.description = previousSpec.description;
    Object.assign(spec, mergeBookCategory(previousSpec, spec));
    if (previousSpec?.status && (!spec.status || (previousSpec.status === '完结' && spec.status !== '完结'))) {
      spec.status = previousSpec.status;
      spec.statusEvidence = previousSpec.statusEvidence;
      spec.statusDetection = 'retained';
    }
    atomicWrite(specFile, spec);
    const shouldStop = () => options.signal?.aborted || options.shouldStop?.();
    const client = options.client || makeClient({cacheDir: path.join(stateDir, 'cache'), profileDir: browserProfile(stateDir, spec.sourceUrl), allowedHosts: spec.allowedHosts, delayMs: spec.delayMs, retries: spec.retries, timeoutMs: spec.timeoutMs, refresh: options.refresh, browser: spec.browser, onStatus: options.onStatus, shouldStop, signal: options.signal});
    const initialStats = {...client.stats};
    const started = Date.now(), chapters = [], failures = [], signatureCache = reading ? new Map() : undefined;
    let catalog = [], source, evidence, report, exportFile, descriptionStatus, paused = false, reusedExport = false;
    try {
      const oldCatalog = readJson(path.join(dir, 'catalog.json'));
      const savedChapters = new Map();
      const checkpoint = entry => {
        if (!savedChapters.has(entry.link)) {
          const saved = readJson(path.join(chaptersDir, hash(entry.link) + '.json'));
          if (saved && (!saved.chapter || saved.chapter.link !== entry.link || saved.chapter.chapter_number !== entry.chapter_number || saved.hash !== hash(saved.chapter))) {
            throw Error(`第 ${entry.chapter_number} 项章节检查点损坏或与目录不匹配`);
          }
          savedChapters.set(entry.link, saved);
        }
        return savedChapters.get(entry.link);
      };
      // A completed TXT seed with a verified online catalog can continue through
      // the same site's chapter reader. Re-downloading a mutable book package
      // neither validates nor improves the already accepted local edition.
      let catalogUpdate = spec.kind === 'txt' && !options.refresh && !spec.catalog?.walk &&
        spec.catalog && spec.chapter?.title && spec.chapter?.content && oldCatalog?.length > 0 &&
        !!readJson(path.join(dir, 'accepted-resource.json'));
      if (catalogUpdate && !oldCatalog.every(entry => checkpoint(entry))) {
        // A paused update already saved today's longer catalog. Its uncollected
        // tail is not missing historical data: require every accepted chapter,
        // then resume missing new pages through the same site's chapter reader.
        let acceptedCount = reading?.sources.length;
        if (!reading) {
          const exported = readJson(path.join(dir, 'export.json'));
          const file = exportPath(spec, id, options.outputDir);
          if (exported?.path === file && fs.existsSync(file)) {
            const raw = fs.readFileSync(file);
            if (hash(raw) === exported.hash) {
              const book = JSON.parse(raw);
              if (book.title === spec.title && book.author === spec.author && book.chapters?.length &&
                  book.chapters.every((chapter, i) => chapter.link === oldCatalog[i]?.link && chapter.chapter_number === i + 1)) acceptedCount = book.chapters.length;
            }
          }
        }
        catalogUpdate = Number.isSafeInteger(acceptedCount) && acceptedCount > 0 && acceptedCount <= oldCatalog.length && oldCatalog.slice(0, acceptedCount).every(entry => checkpoint(entry));
      }
      source = spec.kind === 'html' || catalogUpdate ? await getCatalog(spec, client) : await getResource(spec, client, dir);
      catalog = preserveCatalogLabels(source.catalog, oldCatalog);
      catalog = preserveReviewedCatalogLabels(catalog, oldCatalog, dir, reading);
      evidence = source.evidence;
      Object.assign(spec, mergeBookCategory(spec, source.actual));
      const description = source.actual?.description || spec.description || previousSpec?.description;
      if (description) spec.description = description;
      descriptionStatus = source.actual?.description ? source.actual.descriptionStatus : description ? 'retained' : source.actual?.descriptionStatus || 'missing';
      if (spec.status === '完结' && source.actual?.status === '连载') {
        // Mirrors often keep stale serial labels after a verified ending.
        spec.statusDetection = 'conflict-retained';
        spec.statusEvidence = {...spec.statusEvidence, conflictingSource: source.actual.statusEvidence};
      } else if (source.actual?.status) {
        Object.assign(spec, {status: source.actual.status, statusDetection: 'collected', statusEvidence: source.actual.statusEvidence});
      } else {
        spec.statusDetection = spec.status ? 'retained' : source.actual?.statusDetection || 'missing';
        if (!spec.status) spec.statusEvidence = source.actual?.statusEvidence;
      }
      atomicWrite(specFile, spec);
      if (spec.catalog?.walk) catalog = navigationCatalog({...source, catalog}, oldCatalog);
      if (oldCatalog && oldCatalog.some((c, i) => !catalog[i] || catalog[i].link !== c.link || catalog[i].title !== c.title)) throw Error('完整目录有删除、插入或改名，暂停续传以保护旧章节位置；需在新状态目录重新采集核对');
      if (spec.kind !== 'html' && !catalogUpdate) {
        const previousResource = readJson(path.join(dir, 'accepted-resource.json'));
        const currentResource = readJson(path.join(dir, 'resource-metadata.json'));
        if (previousResource && previousResource.hash !== currentResource.hash) throw Error('整本资源文件发生变化，暂停续传避免混用版本');
        atomicWrite(path.join(dir, 'accepted-resource.json'), currentResource);
      }
      atomicWrite(path.join(dir, 'catalog.json'), catalog);
      const walk = !!spec.catalog?.walk;
      const saveNavigation = () => {
        atomicWrite(path.join(dir, 'catalog.json'), catalog);
        atomicWrite(path.join(dir, 'navigation-state.json'), {expectedCount: source.expectedCount, knownCatalog: catalog.length, complete: catalog.length === source.expectedCount, evidence});
      };
      const saveNextChapter = (chapter, link, nextChapterEvidence) => {
        Object.assign(chapter, {nextChapterUrl: link, nextChapterEvidence});
        atomicWrite(path.join(chaptersDir, hash(chapter.link) + '.json'), {hash: hash(chapter), chapter});
      };
      if (walk) saveNavigation();
      const targets = mode === 'probe' ? (walk ? catalog.slice(0, options.samples || 9) : sampleCatalog(catalog, options.samples || 9)) : catalog;
      const links = new Set(catalog.map(c => c.link));
      let fetched = 0, consecutiveFailures = 0;
      const total = mode === 'download' && walk ? source.expectedCount : targets.length;
      options.onProgress?.({jobId: id, mode, downloaded: 0, total, failed: 0});
      for (let index = 0; index < total; index++) {
        if (shouldStop()) { paused = true; break; }
        let entry = targets[index];
        try {
          if (!entry) {
            if (options.maxNew !== undefined && fetched >= options.maxNew) break;
            const previous = chapters.at(-1);
            if (!walk || !previous) throw Error('顺序采集缺少上一章检查点');
            const refreshed = previous.nextChapterUrl ? null : await refreshNextChapter(spec, previous, client);
            const next = previous.nextChapterUrl || refreshed.link;
            if (!next) throw Error('下一章链接提前结束，与详情页总数不一致');
            if (links.has(next)) throw Error('下一章形成循环或回到已采章节，已停止');
            if (refreshed) saveNextChapter(previous, next, refreshed.evidence);
            entry = {link: next, chapter_number: index + 1, sourceOrder: index + 1};
          }
          const chapterFile = path.join(chaptersDir, hash(entry.link) + '.json');
          const saved = options.refresh ? null : checkpoint(entry);
          if (!saved && options.maxNew !== undefined && fetched >= options.maxNew) break;
          if (!saved) fetched++;
          const chapter = saved?.chapter || source.chapters?.[entry.chapter_number - 1] || (spec.chapter ? await getChapter(spec, entry, links, client) : null);
          if (!chapter) throw Error('文件缺少该目录项，且未配置同一来源的补采规则');
          const invalid = chapterQuality(chapter).filter(i => i.level === 'error');
          // A file may contain a real, empty directory entry. Preserve its
          // provenance for an explicit gap review; qualityReport still blocks
          // export. Other extraction/access errors remain failed requests.
          const emptyFileEntry = spec.kind !== 'html' && invalid.length === 1 && invalid[0].code === 'empty';
          if (invalid.length && !emptyFileEntry) {
            atomicWrite(path.join(dir, 'rejected', hash(entry.link) + '.json'), {chapter, issues: invalid});
            throw Error(invalid.map(i => i.code).join(', '));
          }
          if (walk) {
            if (!Object.hasOwn(chapter, 'nextChapterUrl')) throw Error('章节检查点缺少下一章来源记录');
            if (!entry.title) {
              catalog.push({...entry, title: chapter.title});
              links.add(entry.link);
              mergeRecent(catalog, source.recent, source.expectedCount);
              for (const item of catalog) links.add(item.link);
            }
            const nextKnown = catalog[index + 1];
            // A preceding probe or pause may already have saved the extended
            // catalog. The checked recent-list overlap proves the new successor.
            const updatedEnding = saved && !chapter.nextChapterUrl && source.recent.some(item => item.link === nextKnown?.link);
            if (nextKnown && chapter.nextChapterUrl !== nextKnown.link && !updatedEnding) throw Error('下一章链接与已知目录顺序不一致，已停止');
            if (updatedEnding) saveNextChapter(chapter, nextKnown.link, {kind: 'recent-catalog', ...evidence});
            if (!nextKnown && chapter.nextChapterUrl && links.has(chapter.nextChapterUrl)) throw Error('下一章形成循环，已停止');
            if (index + 1 === source.expectedCount && chapter.nextChapterUrl) throw Error('正文仍有下一章但已达到详情页总数，请重新检查来源更新');
          }
          if (!saved) {
            const record = {hash: hash(chapter), chapter};
            atomicWrite(chapterFile, record);
            savedChapters.set(entry.link, record);
          }
          if (walk) saveNavigation();
          chapters.push(chapter);
          consecutiveFailures = 0;
        } catch (error) {
          if (shouldStop()) { paused = true; break; }
          failures.push(failureDetails(error, {chapter: entry?.chapter_number || index + 1, title: entry?.title, link: entry?.link}));
          // Three consecutive failing pages usually mean the source has stopped serving us.
          if (options.stopOnFailure || walk || error.stopSource || ++consecutiveFailures >= 3) break;
        }
        options.onProgress?.({jobId: id, mode, downloaded: chapters.length, total, failed: failures.length});
      }
      if (mode === 'download') {
        // Load previously downloaded chapters outside a bounded continuation run too.
        const loadedLinks = new Set(chapters.map(chapter => chapter.link));
        for (const entry of catalog) {
          if (options.refresh || loadedLinks.has(entry.link)) continue;
          const saved = checkpoint(entry);
          if (saved) { chapters.push(saved.chapter); loadedLinks.add(entry.link); }
        }
        report = navigationReport(qualityReport(catalog, chapters, failures, mode, {signatureCache}), source, catalog);
        atomicWriteIfChanged(path.join(dir, 'partial.json'), bookData(spec, chapters));
        if (!reading && report.completeAgainstSource && report.structuralPass) {
          const book = bookData(spec, chapters);
          prepareImport(book);
          exportFile = exportPath(spec, id, options.outputDir);
          const exported = readJson(path.join(dir, 'export.json'));
          if (fs.existsSync(exportFile) && (!exported || exported.path !== exportFile || hash(fs.readFileSync(exportFile)) !== exported.hash)) throw Error(`输出文件已存在或被其他程序修改，拒绝覆盖：${exportFile}`);
          // After verifying the recorded byte hash, compare data rather than
          // indentation or key order. Trusted metadata tools may format JSON
          // differently; identical books must keep their bytes and timestamp.
          reusedExport = fs.existsSync(exportFile) && isDeepStrictEqual(readJson(exportFile), book);
          if (!reusedExport) atomicWrite(exportFile, book);
          atomicWrite(path.join(dir, 'export.json'), {path: exportFile, hash: hash(fs.readFileSync(exportFile))});
        }
      } else report = navigationReport(qualityReport(catalog, chapters, failures, mode, {signatureCache}), source, catalog);
    } catch (error) {
      exportFile = null;
      if (shouldStop()) paused = true;
      else failures.push(failureDetails(error));
      report = navigationReport(qualityReport(catalog, chapters, failures, mode, {signatureCache}), source, catalog);
      report.structuralPass = false;
      report.completeAgainstSource = false;
    } finally {
      if (!options.client) await client.close();
    }
    const details = {...report, paused, reusedExport, ...categoryFields(spec), description: spec.description, descriptionStatus, status: spec.status, statusDetection: spec.statusDetection, statusEvidence: spec.statusEvidence, title: spec.title, author: spec.author, sourceUrl: spec.sourceUrl, jobId: id, checkedAt: new Date().toISOString(), elapsedMs: Date.now() - started, requests: Object.fromEntries(Object.entries(client.stats).map(([key, value]) => [key, value - initialStats[key]])), evidence, exportFile: exportFile || null};
    atomicWrite(path.join(dir, `${mode}-report.json`), details);
    atomicWrite(path.join(dir, `${mode}-report.md`), reportMarkdown(details));
    atomicWrite(path.join(dir, 'history', `${Date.now()}-${mode}.json`), details);
    if (!paused) await recordSource(stateDir, spec, details, id);
    if (reading) {
      options.onStatus?.({kind: 'reading-edition', message: '正在核对来源映射并整理网站阅读版…'});
      const result = updateReadingEdition({dir, state: reading, spec, extraction: extractionHash(spec), outputDir, catalog, rawReport: details, signatureCache});
      result.rawReportFile = path.join(dir, `${mode}-report.json`);
      result.reportFile = path.join(dir, `reading-${mode}-report.json`);
      result.summaryFile = path.join(dir, `reading-${mode}-report.md`);
      atomicWrite(result.reportFile, result);
      atomicWrite(result.summaryFile, reportMarkdown(result));
      return result;
    }
    return {...details, reportFile: path.join(dir, `${mode}-report.json`), summaryFile: path.join(dir, `${mode}-report.md`)};
  });
}

export function sourcePlan(title, author = '', stateDir = defaultStateDir) {
  const registry = readJson(path.join(stateDir, 'sources.json'), {sites: {}});
  const sources = Object.values(registry.sites).map(site => {
    const ageDays = Math.max(0, (Date.now() - Date.parse(site.lastChecked)) / 86400000);
    return {...site, priority: Math.max(0, site.score - Math.floor(ageDays / 7) * 5) + Math.min(20, site.verifiedBooks * 5), needsRecheck: ageDays > 14};
  }).sort((a, b) => b.priority - a.priority);
  const term = `"${title.replace(/"/g, '')}"${author ? ` "${author.replace(/"/g, '')}"` : ''}`;
  return {
    title, author,
    preferred: sources.slice(0, 8).map(s => ({host: s.host, priority: s.priority, verifiedBooks: s.verifiedBooks, sampledBooks: s.sampledBooks, lastChecked: s.lastChecked, needsRecheck: s.needsRecheck, query: `${term} site:${s.host}`, searchUrl: s.searchUrl?.replace('{query}', encodeURIComponent(`${title} ${author}`)), previousSpecs: Object.values(s.books).map(b => b.specFile)})),
    fallbackQueries: [`${term} 目录`, `${term} TXT EPUB 下载`],
    instruction: '先实际查询优先站点；没有合适结果再执行全网搜索。搜索由 Codex 的可用工具或浏览器完成，本命令只生成检索计划。每本新书重新试采。',
  };
}
