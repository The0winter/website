import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {atomicWrite, readJson, hash, safeName, withLock} from './storage.mjs';
import {makeClient, httpUrl} from './http.mjs';
import {getCatalog, getChapter, getResource} from './adapters.mjs';
import {chapterQuality, qualityReport, sampleCatalog, normalizedTitle} from './quality.mjs';
import {formatChapterForExport} from './titles.mjs';
import {prepareImport} from '../../infra/import-plan.mjs';
import {failureDetails} from './diagnostics.mjs';
import {browserProfile} from './browser-session.mjs';

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
  if (spec.kind === 'html' && (!(spec.catalog?.links || spec.catalog?.json) || !spec.chapter?.content || !spec.chapter?.title)) throw Error('HTML 来源需配置目录及章节选择器');
  if (spec.kind !== 'html' && !(spec.resource?.url || spec.resource?.link)) throw Error('文件来源需配置下载地址或链接选择器');
  spec.allowedHosts = [...new Set([new URL(spec.sourceUrl).hostname, ...(spec.allowedHosts || [])])];
  for (const host of spec.allowedHosts) if (typeof host !== 'string' || !host || /[\s/@?#]/.test(host)) throw Error('allowedHosts 只能包含域名');
  for (const [field, lower, upper] of [['delayMs', 200, 60000], ['retries', 0, 5], ['timeoutMs', 1000, 60000]]) if (spec[field] !== undefined && (!Number.isInteger(spec[field]) || spec[field] < lower || spec[field] > upper)) throw Error(`${field} 超出范围`);
  return spec;
}

export function jobId(spec) {
  return hash({title: normalizedTitle(spec.title), author: normalizedTitle(spec.author), sourceUrl: spec.sourceUrl, ...(spec.variant ? {variant: spec.variant} : {})}).slice(0, 20);
}

function extractionHash(spec) {
  const {delayMs, retries, timeoutMs, searchUrl, description, status, statusDetection, statusEvidence, ...extraction} = spec;
  // Book metadata changes do not affect chapter identity, order or extraction.
  if (extraction.metadata) {
    const {description: descriptionRule, status: statusRule, ...metadata} = extraction.metadata;
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

export function localBookState(spec, {stateDir = defaultStateDir, outputDir} = {}) {
  spec = validateSpec(spec);
  const id = jobId(spec), dir = path.join(stateDir, 'jobs', id);
  try {
    const previous = readJson(path.join(dir, 'spec.json'));
    if (!previous) return {state: 'new', saved: 0, total: 0, message: '尚未采集'};
    if (extractionHash(previous) !== extractionHash(spec)) return {state: 'incompatible', saved: 0, total: 0, message: '来源规则已有变化，旧进度保留，需先核对适配规则。'};
    const catalog = readJson(path.join(dir, 'catalog.json'), []), chaptersDir = path.join(dir, 'chapters');
    const files = new Set(fs.existsSync(chaptersDir) ? fs.readdirSync(chaptersDir) : []);
    const saved = catalog.filter(entry => files.has(hash(entry.link) + '.json')).length;
    const exported = readJson(path.join(dir, 'export.json')), file = exportPath(spec, id, outputDir);
    const fileExists = fs.existsSync(file), fileValid = fileExists && exported?.path === file && hash(fs.readFileSync(file)) === exported.hash;
    const total = catalog.length;
    if (fileExists && !fileValid) return {state: 'modified', saved, total, message: `已保存 ${saved} / ${total} 章；导出文件存在或已被修改，程序会保护它，拒绝覆盖。`};
    if (saved && saved === total && fileValid) return {state: 'complete', saved, total, message: `已下载完成 · ${saved} 章。再次采集会检查更新，已有正文不会重复下载。`};
    return {state: saved ? 'partial' : 'new', saved, total, message: saved ? `已保存 ${saved} / ${total} 章；继续时自动补齐缺少的章节。` : '尚未保存章节'};
  } catch { return {state: 'unknown', saved: 0, total: 0, message: '本地记录需要核对；旧文件会保留。'}; }
}

function bookData(spec, chapters) {
  return {
    title: spec.title, author: spec.author, sourceUrl: spec.sourceUrl,
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
    `| 来源目录项 | ${report.expected} |`, `| 已采集 | ${report.downloaded} |`,
    `| 相对来源目录完整 | ${report.completeAgainstSource ? '是' : '否'} |`,
    `| 严重问题 | ${report.errors} |`, `| 待核对警告 | ${report.warnings} |`,
    `| 编号等信息提示 | ${report.information} |`, '',
    `简介：${report.description ? `${report.description.length} 字符${report.descriptionStatus === 'truncated' ? '（来源简介超过 5000 字符，已截取）' : report.descriptionStatus === 'retained' ? '（沿用已保存简介）' : ''}` : '未获取，导出时省略该字段'}。`, '',
    `作品状态：${report.status === '完结' ? '已完结' : report.status === '连载' ? '连载中' : '未识别，导出时省略该字段'}${report.statusDetection === 'conflict-retained' ? '（来源仍标连载，保留已确认的完结状态）' : report.statusDetection === 'retained' ? '（未取得有效新状态，沿用已保存状态）' : ''}。`, '',
    ...(report.paused ? ['任务已主动暂停；缺失项表示尚未继续采集，不能据此判定来源缺章。', ''] : []),
    report.limitation, '',
    '## 问题分类', '',
    ...(counts.size ? [...counts].map(([code, count]) => `- ${code}：${count}`) : ['未发现已检测类别的问题。']), '',
    '编号差异保留目录标题和正文原标题；短章不删除，相似正文不自动合并。警告不等于已经确认有错误。', '',
    ...(report.failures.length ? ['## 失败与处理方法', '', ...report.failures.slice(0, 20).flatMap(item => [`- ${item.chapter ? `第 ${item.chapter} 项 ${literal(item.title || '')}：` : ''}${literal(item.error)}`, ...(item.url || item.link ? [`  来源：${literal(item.url || item.link)}`] : []), `  下一步：${literal(item.nextStep || failureDetails(item).nextStep)}`]), ''] : []),
    report.exportFile ? `输出文件：[${literal(path.basename(report.exportFile))}](<${report.exportFile.replaceAll('\\', '/')}>)` : '本次没有生成完整导出文件，已取得的内容保留在任务检查点中。', '',
    '完整问题清单、来源响应哈希及缺失项见同目录的 JSON 报告。', '',
  ].join('\n');
}

async function recordSource(stateDir, spec, report, id) {
  await withLock(path.join(stateDir, 'registry.lock'), async () => {
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
  });
}

export async function acquire(input, options = {}) {
  const spec = validateSpec(input), mode = options.mode || 'probe';
  if (!['probe', 'download'].includes(mode)) throw Error('未知采集模式');
  const stateDir = path.resolve(options.stateDir || defaultStateDir), id = jobId(spec);
  const dir = path.join(stateDir, 'jobs', id), chaptersDir = path.join(dir, 'chapters');
  return withLock(path.join(dir, 'job.lock'), async () => {
    const specFile = path.join(dir, 'spec.json'), previousSpec = readJson(specFile);
    if (previousSpec && extractionHash(previousSpec) !== extractionHash(spec) && fs.existsSync(chaptersDir) && fs.readdirSync(chaptersDir).length) throw Error(`提取规则发生变化，请使用新的 --state-dir 重新试采，避免混用旧正文：${dir}`);
    if (!spec.description && previousSpec?.description) spec.description = previousSpec.description;
    if (previousSpec?.status && (!spec.status || (previousSpec.status === '完结' && spec.status !== '完结'))) {
      spec.status = previousSpec.status;
      spec.statusEvidence = previousSpec.statusEvidence;
      spec.statusDetection = 'retained';
    }
    atomicWrite(specFile, spec);
    const shouldStop = () => options.signal?.aborted || options.shouldStop?.();
    const client = options.client || makeClient({cacheDir: path.join(stateDir, 'cache'), profileDir: browserProfile(stateDir, spec.sourceUrl), allowedHosts: spec.allowedHosts, delayMs: spec.delayMs, retries: spec.retries, timeoutMs: spec.timeoutMs, refresh: options.refresh, browser: spec.browser, onStatus: options.onStatus, shouldStop, signal: options.signal});
    const initialStats = {...client.stats};
    const started = Date.now(), chapters = [], failures = [];
    let catalog = [], evidence, report, exportFile, descriptionStatus, paused = false, reusedExport = false;
    try {
      const source = spec.kind === 'html' ? await getCatalog(spec, client) : await getResource(spec, client, dir);
      catalog = source.catalog;
      evidence = source.evidence;
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
      const oldCatalog = readJson(path.join(dir, 'catalog.json'));
      if (oldCatalog && oldCatalog.some((c, i) => !catalog[i] || catalog[i].link !== c.link || catalog[i].title !== c.title)) throw Error('完整目录有删除、插入或改名，暂停续传以保护旧章节位置；需在新状态目录重新采集核对');
      if (spec.kind !== 'html') {
        const previousResource = readJson(path.join(dir, 'accepted-resource.json'));
        const currentResource = readJson(path.join(dir, 'resource-metadata.json'));
        if (previousResource && previousResource.hash !== currentResource.hash) throw Error('整本资源文件发生变化，暂停续传避免混用版本');
        atomicWrite(path.join(dir, 'accepted-resource.json'), currentResource);
      }
      atomicWrite(path.join(dir, 'catalog.json'), catalog);
      const targets = mode === 'probe' ? sampleCatalog(catalog, options.samples || 9) : catalog;
      const links = new Set(catalog.map(c => c.link));
      let fetched = 0, consecutiveFailures = 0;
      options.onProgress?.({jobId: id, mode, downloaded: 0, total: targets.length, failed: 0});
      for (const entry of targets) {
        if (shouldStop()) { paused = true; break; }
        const chapterFile = path.join(chaptersDir, hash(entry.link) + '.json');
        const saved = readJson(chapterFile);
        if (saved && !options.refresh) {
          if (saved.chapter.link !== entry.link || saved.chapter.chapter_number !== entry.chapter_number || saved.hash !== hash(saved.chapter)) throw Error('章节检查点损坏或与目录不匹配');
          chapters.push(saved.chapter);
          consecutiveFailures = 0;
          options.onProgress?.({jobId: id, mode, downloaded: chapters.length, total: targets.length, failed: failures.length});
          continue;
        }
        if (options.maxNew !== undefined && fetched >= options.maxNew) break;
        fetched++;
        try {
          const chapter = source.chapters?.[entry.chapter_number - 1] || (spec.chapter ? await getChapter(spec, entry, links, client) : null);
          if (!chapter) throw Error('文件缺少该目录项，且未配置同一来源的补采规则');
          const invalid = chapterQuality(chapter).filter(i => i.level === 'error');
          if (invalid.length) {
            atomicWrite(path.join(dir, 'rejected', hash(entry.link) + '.json'), {chapter, issues: invalid});
            throw Error(invalid.map(i => i.code).join(', '));
          }
          atomicWrite(chapterFile, {hash: hash(chapter), chapter});
          chapters.push(chapter);
          consecutiveFailures = 0;
        } catch (error) {
          if (shouldStop()) { paused = true; break; }
          failures.push(failureDetails(error, {chapter: entry.chapter_number, title: entry.title, link: entry.link}));
          // Three consecutive failing pages usually mean the source has stopped serving us.
          if (error.stopSource || ++consecutiveFailures >= 3) break;
        }
        options.onProgress?.({jobId: id, mode, downloaded: chapters.length, total: targets.length, failed: failures.length});
      }
      report = qualityReport(catalog, chapters, failures, mode);
      if (mode === 'download') {
        // Load previously downloaded chapters outside a bounded continuation run too.
        for (const entry of catalog) {
          if (chapters.some(c => c.link === entry.link)) continue;
          const saved = readJson(path.join(chaptersDir, hash(entry.link) + '.json'));
          if (!options.refresh && saved && saved.hash === hash(saved.chapter) && saved.chapter.link === entry.link && saved.chapter.chapter_number === entry.chapter_number) chapters.push(saved.chapter);
        }
        report = qualityReport(catalog, chapters, failures, mode);
        atomicWrite(path.join(dir, 'partial.json'), bookData(spec, chapters));
        if (report.completeAgainstSource && report.structuralPass) {
          const book = bookData(spec, chapters);
          prepareImport(book);
          exportFile = exportPath(spec, id, options.outputDir);
          const exported = readJson(path.join(dir, 'export.json'));
          if (fs.existsSync(exportFile) && (!exported || exported.path !== exportFile || hash(fs.readFileSync(exportFile)) !== exported.hash)) throw Error(`输出文件已存在或被其他程序修改，拒绝覆盖：${exportFile}`);
          reusedExport = fs.existsSync(exportFile) && hash(fs.readFileSync(exportFile)) === hash(JSON.stringify(book, null, 2) + '\n');
          if (!reusedExport) atomicWrite(exportFile, book);
          atomicWrite(path.join(dir, 'export.json'), {path: exportFile, hash: hash(fs.readFileSync(exportFile))});
        }
      }
    } catch (error) {
      exportFile = null;
      if (shouldStop()) paused = true;
      else failures.push(failureDetails(error));
      report = qualityReport(catalog, chapters, failures, mode);
      report.structuralPass = false;
      report.completeAgainstSource = false;
    } finally {
      if (!options.client) await client.close();
    }
    const details = {...report, paused, reusedExport, description: spec.description, descriptionStatus, status: spec.status, statusDetection: spec.statusDetection, statusEvidence: spec.statusEvidence, title: spec.title, author: spec.author, sourceUrl: spec.sourceUrl, jobId: id, checkedAt: new Date().toISOString(), elapsedMs: Date.now() - started, requests: Object.fromEntries(Object.entries(client.stats).map(([key, value]) => [key, value - initialStats[key]])), evidence, exportFile: exportFile || null};
    atomicWrite(path.join(dir, `${mode}-report.json`), details);
    atomicWrite(path.join(dir, `${mode}-report.md`), reportMarkdown(details));
    atomicWrite(path.join(dir, 'history', `${Date.now()}-${mode}.json`), details);
    if (!paused) await recordSource(stateDir, spec, details, id);
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
