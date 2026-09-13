import fs from 'node:fs';
import path from 'node:path';
import {atomicWrite, readJson, hash} from './storage.mjs';
import {normalizedIdentity} from './identity.mjs';
import {qualityReport} from './quality.mjs';
import {getCatalog, getChapter} from './adapters.mjs';
import {makeClient} from './http.mjs';
import {browserProfile} from './browser-session.mjs';
import {formatChapterForExport} from './titles.mjs';
import {prepareImport} from '../../infra/import-plan.mjs';

const normalize = value => normalizedIdentity(value, 'chinese-simplified');
const sameBook = (a, b) => ['title', 'author'].every(key => a[key] && b[key] && normalize(a[key]) === normalize(b[key]));
export const continuationKey = spec => hash([normalize(spec.title), normalize(spec.author)]).slice(0, 24);
const directory = (stateDir, spec) => path.join(stateDir, 'continuations', continuationKey(spec));
const bytes = value => JSON.stringify(value, null, 2) + '\n';
const sealed = value => ({hash: hash(value), value});
function checked(file) {
  const data = readJson(file);
  if (!data?.value || data.hash !== hash(data.value)) throw Error('换源记录缺失或损坏，原书已保留');
  return data.value;
}
function targetPath(outputDir, file) {
  if (typeof file !== 'string' || !file.endsWith('.json') || /[<>:"/\\|?*\x00-\x1f]/u.test(file) || /[. ]$/u.test(file)) throw Error('续更文件名无效');
  const result = path.resolve(outputDir, file);
  if (fs.existsSync(result) && (!fs.lstatSync(result).isFile() || fs.lstatSync(result).isSymbolicLink())) throw Error('续更文件必须是下载目录中的普通文件');
  return result;
}
function validateBinding(binding, spec, outputDir) {
  if (binding.version !== 1 || !sameBook(binding, spec) || binding.outputPath !== targetPath(outputDir, binding.file) || !Array.isArray(binding.catalog) || !binding.catalog.length || !binding.source?.url || !binding.exportHash) throw Error('换源绑定或输出目录不匹配，原书已保留');
}
export function hasContinuation(spec, stateDir) {
  const dir = directory(stateDir, spec);
  return fs.existsSync(path.join(dir, 'binding.json')) || fs.existsSync(path.join(dir, 'pending.json'));
}

// The file and binding are a single logical update. Recover either rename order
// only while the output is exactly the before/after version in the journal.
export function recoverContinuation(spec, {stateDir, outputDir}) {
  const dir = directory(stateDir, spec), journal = path.join(dir, 'pending.json'), bindingFile = path.join(dir, 'binding.json');
  if (fs.existsSync(journal)) {
    const pending = checked(journal), next = pending.next;
    validateBinding(next, spec, outputDir);
    const current = fs.existsSync(bindingFile) ? checked(bindingFile) : null;
    if (![pending.previousBindingHash, hash(next)].includes(hash(current))) throw Error('换源更新记录与当前绑定冲突');
    if (!sameBook(next, pending.book) || pending.book.sourceUrl !== next.originalSourceUrl || hash(bytes(pending.book)) !== next.exportHash) throw Error('换源更新快照损坏');
    prepareImport(pending.book);
    const file = targetPath(outputDir, next.file);
    if (!fs.existsSync(file) || ![pending.previousExportHash, next.exportHash].includes(hash(fs.readFileSync(file)))) throw Error('换源更新期间原文件被修改或移走，拒绝覆盖');
    if (hash(fs.readFileSync(file)) !== next.exportHash) atomicWrite(file, pending.book);
    atomicWrite(bindingFile, sealed(next));
    fs.unlinkSync(journal);
  }
  if (!fs.existsSync(bindingFile)) return null;
  const binding = checked(bindingFile);
  validateBinding(binding, spec, outputDir);
  return binding;
}

const inventoryCache = new Map();
function inventory(outputDir) {
  const books = [];
  for (const entry of fs.existsSync(outputDir) ? fs.readdirSync(outputDir, {withFileTypes: true}) : []) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const file = path.join(outputDir, entry.name), stat = fs.statSync(file), stamp = `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
    let cached = inventoryCache.get(file);
    if (cached?.stamp !== stamp) {
      let book;
      try {
        const raw = fs.readFileSync(file), data = JSON.parse(raw);
        if (data.title && data.author && data.sourceUrl && data.chapters?.length) book = {file: entry.name, hash: hash(raw), title: data.title, author: data.author, sourceUrl: data.sourceUrl, count: data.chapters.length};
      } catch { /* Other JSON files are not book exports. */ }
      cached = {stamp, book}; inventoryCache.set(file, cached);
    }
    if (cached.book) books.push(cached.book);
  }
  return books;
}

export function continuationState(spec, {stateDir, outputDir}) {
  const dir = directory(stateDir, spec), file = path.join(dir, 'binding.json');
  if (hasContinuation(spec, stateDir)) {
    const pending = fs.existsSync(path.join(dir, 'pending.json')) ? checked(path.join(dir, 'pending.json')) : null;
    const binding = fs.existsSync(file) ? checked(file) : pending.next;
    validateBinding(binding, spec, outputDir);
    const output = targetPath(outputDir, binding.file);
    if (!fs.existsSync(output)) throw Error('已绑定的续更文件被移走，请恢复原文件后继续');
    const exportHash = hash(fs.readFileSync(output));
    if (!(pending ? [pending.previousExportHash, pending.next.exportHash] : [binding.exportHash]).includes(exportHash)) throw Error('续更文件已被其他程序修改，拒绝覆盖');
    const switching = binding.source.url !== spec.sourceUrl;
    return {state: switching ? 'switch' : 'complete', saved: binding.count, total: binding.count, continuation: {file: binding.file, hash: exportHash},
      message: `已关联本地文件「${binding.file}」· ${binding.count} 项；${switching ? '换源续更会先核对衔接，只追加后续章节。' : '检查更新会沿用当前来源，只追加后续章节。'}`};
  }
  let candidates = inventory(outputDir).filter(book => sameBook(spec, book));
  if (!candidates.some(book => book.sourceUrl !== spec.sourceUrl)) return null;
  // Prefer an explicitly bound reading edition over its raw export.
  const jobs = path.join(stateDir, 'jobs'), reviewed = new Set();
  for (const name of fs.existsSync(jobs) ? fs.readdirSync(jobs) : []) {
    const readingFile = path.join(jobs, name, 'reading-edition.json');
    if (!/^[a-f0-9]{20}$/u.test(name) || !fs.existsSync(readingFile)) continue;
    const previousSpec = readJson(path.join(jobs, name, 'spec.json'));
    if (previousSpec && !sameBook(spec, previousSpec)) continue;
    const reading = checked(readingFile);
    if (sameBook(spec, reading.identity)) reviewed.add(reading.outputPath);
  }
  if (candidates.some(book => reviewed.has(path.resolve(outputDir, book.file)))) candidates = candidates.filter(book => reviewed.has(path.resolve(outputDir, book.file)));
  if (candidates.length !== 1) throw Error(`找到多个同名同作者的本地版本，无法确定续更目标：${candidates.map(book => book.file).join('、')}。请将不使用的版本移到下载目录之外后重新查找。`);
  const book = candidates[0];
  if (book.sourceUrl === spec.sourceUrl) return null;
  return {state: 'switch', saved: book.count, total: book.count, continuation: {file: book.file, hash: book.hash}, message: `本地已有「${book.file}」· ${book.count} 项（${new URL(book.sourceUrl).hostname}）；换源续更会先核对衔接，只追加后续章节。`};
}

function chineseNumber(text) {
  if (/^[0-9]+$/u.test(text)) return Number(text);
  const digits = '零一二三四五六七八九', units = {十: 10, 百: 100, 千: 1000, 万: 10000};
  let total = 0, section = 0, digit = 0;
  for (const char of text.replaceAll('〇', '零').replaceAll('两', '二')) {
    if (digits.includes(char)) digit = digits.indexOf(char);
    else if (units[char] === 10000) { total += (section + digit) * 10000; section = digit = 0; }
    else if (units[char]) { section += (digit || 1) * units[char]; digit = 0; }
    else return NaN;
  }
  return total + section + digit;
}
export function chapterIdentity(title) {
  const text = String(title).normalize('NFKC').trim(), match = /^第([0-9零〇一二三四五六七八九十百千万两]+)[章节回]\s*(.*)$/u.exec(text);
  return match ? {number: chineseNumber(match[1]), name: normalize(match[2])} : null;
}
const notice = title => /^(?:番外|IF番外|总结|请假|公告|通知|活动|感言|后记|月票|[0-9零〇一二三四五六七八九十年月日份\s:：-]*(?:月票|抽奖|总结|活动|请假|公告|通知))|求(?:双倍)?月票|月票冲刺|年终总结/iu.test(String(title).normalize('NFKC').trim());
const compatibleNames = (a, b) => a === b || (Math.min(a.length, b.length) >= 6 && (a.startsWith(b) || b.startsWith(a)));
function bodyKey(content, title) {
  let text = String(content).trim();
  const firstBreak = text.indexOf('\n');
  if (firstBreak >= 0) {
    const firstLine = text.slice(0, firstBreak).trim(), first = chapterIdentity(firstLine), heading = chapterIdentity(title);
    if (normalize(firstLine) === normalize(title) || (first && heading && first.number === heading.number && compatibleNames(first.name, heading.name))) text = text.slice(firstBreak + 1);
  }
  return normalize(text.replace(/\s*[（(]?本章(?:完|结束)[）)]?\s*$/u, ''));
}
function numbered(chapters) {
  const result = [];
  for (const [index, chapter] of chapters.entries()) {
    const identity = chapterIdentity(chapter.title);
    if (!identity) continue;
    if (!Number.isSafeInteger(identity.number) || identity.number < 1) throw Error(`无法确定正文章号「${chapter.title}」`);
    result.push({index, ...identity});
  }
  return result;
}

export async function acquireContinuation(spec, options) {
  const {stateDir, outputDir, mode, extraction, id} = options;
  if (spec.kind !== 'html' || spec.catalog?.walk) throw Error('换源续更目前需要可读取完整目录的 HTML 来源；此来源须先补齐目录适配');
  if (options.refresh) throw Error('换源续更不能强制刷新旧正文');
  const dir = directory(stateDir, spec);
  const binding = recoverContinuation(spec, options);
  const selected = options.continuation || continuationState(spec, options)?.continuation;
  if (!selected) throw Error('没有可接续的本地书籍');
  const file = targetPath(outputDir, selected.file), original = fs.readFileSync(file), originalHash = hash(original), book = JSON.parse(original);
  if (originalHash !== (binding?.exportHash || selected.hash) || (binding && binding.file !== selected.file)) throw Error('续更目标已变化，请重新查找后再开始');
  if (!sameBook(spec, book)) throw Error('续更目标书名或作者不匹配');
  prepareImport(book);
  if (book.chapters.some((chapter, index) => index && chapter.chapter_number <= book.chapters[index - 1].chapter_number)) throw Error('原书顺序号未严格递增，请先核对');
  const lastOrdinal = book.chapters.at(-1).chapter_number;
  const switching = !binding || binding.source.url !== spec.sourceUrl;
  if (!switching && binding.source.extraction !== extraction) throw Error('当前续更来源的提取规则已变化，请先核对适配，旧文件已保留');
  const sourceDir = path.join(dir, 'sources', hash([spec.sourceUrl, extraction]).slice(0, 24));
  const stopped = () => options.signal?.aborted || options.shouldStop?.();
  const client = options.client || makeClient({cacheDir: path.join(stateDir, 'cache'), profileDir: browserProfile(stateDir, spec.sourceUrl), allowedHosts: spec.allowedHosts, delayMs: spec.delayMs, retries: spec.retries, timeoutMs: spec.timeoutMs, browser: spec.browser, signal: options.signal, shouldStop: stopped, onStatus: options.onStatus});
  const initialStats = {...client.stats}, started = Date.now();
  const failures = [], anchors = [], tail = [], skipped = [];
  let catalog = [], evidence, added = 0, paused = false, exportFile = null, reusedExport = false, quality = {issues: []}, nextBook = book, fetched = 0;
  async function chapter(entry, links) {
    if (stopped()) throw Error('采集已暂停');
    const checkpoint = path.join(sourceDir, 'chapters', hash(entry.link) + '.json'), saved = readJson(checkpoint);
    if (saved && (saved.hash !== hash(saved.chapter) || saved.chapter.link !== entry.link || saved.chapter.chapter_number !== entry.chapter_number || saved.catalogTitle !== entry.title)) throw Error(`新来源检查点与目录不匹配：${entry.title}`);
    if (!saved && options.maxNew !== undefined && fetched >= options.maxNew) { paused = true; throw Error('本次采集数量已达上限'); }
    const value = saved?.chapter || await getChapter(spec, entry, links, client);
    const report = qualityReport([entry], [value], [], 'probe');
    if (report.issues.some(issue => issue.level !== 'info' && issue.code !== 'short-outlier')) throw Error(`新来源章节需核对「${entry.title}」：${report.issues.map(issue => issue.code).join('、')}`);
    if (!saved) { fetched++; atomicWrite(checkpoint, {hash: hash(value), chapter: value, catalogTitle: entry.title}); }
    return value;
  }
  try {
    options.onStatus?.({kind: 'continuation', message: switching ? '正在对齐新旧目录并核对末尾正文…' : '正在检查当前续更来源的新增目录…'});
    const source = await getCatalog(spec, client);
    catalog = source.catalog; evidence = source.evidence;
    const links = new Set(catalog.map(entry => entry.link)), oldNumbers = numbered(book.chapters), newNumbers = numbered(catalog);
    const last = oldNumbers.at(-1);
    if (!last || oldNumbers.length < 3) throw Error('本地书籍不足三个可核对的正文章节，无法自动确定换源衔接点');
    let boundary;
    if (switching) {
      const ending = oldNumbers.slice(-3);
      for (const [index, old] of ending.entries()) {
        if (index && old.number !== ending[index - 1].number + 1) throw Error('原书末尾正文章号不连续，需先核对缺章');
        const matches = newNumbers.filter(item => item.number === old.number);
        const name = matches[0]?.name || '';
        const compatibleName = compatibleNames(name, old.name);
        const match = matches.length === 1 && compatibleName ? matches[0] : null;
        if (!match || (boundary !== undefined && match.index <= boundary)) throw Error(`新来源无法对齐「${book.chapters[old.index].title}」，可能缺章、改名或拆合章`);
        const actual = await chapter(catalog[match.index], links), previous = book.chapters[old.index];
        const oldBody = bodyKey(previous.content, previous.title), newBody = bodyKey(actual.content, actual.title);
        if (oldBody.length < 100 || oldBody !== newBody) throw Error(`衔接正文不一致「${previous.title}」，旧书已保留，请核对是否删文或拆合章`);
        anchors.push({oldPosition: old.index + 1, sourcePosition: match.index + 1, oldLink: previous.link, newLink: actual.link, oldHash: hash(previous.content), newHash: hash(actual.content)});
        boundary = match.index;
      }
    } else {
      if (binding.catalog.some((entry, index) => !catalog[index] || entry.link !== catalog[index].link || entry.title !== catalog[index].title)) throw Error('已接续的新来源目录发生删除、插入或改名，暂停更新以保护旧章节');
      boundary = binding.catalog.length - 1;
    }
    const pending = catalog.slice(boundary + 1);
    const targets = mode === 'probe' ? pending.slice(0, 3) : pending;
    let number = last.number;
    for (const entry of targets) {
      const identity = chapterIdentity(entry.title);
      if (identity) {
        if (identity.number !== number + 1) throw Error(`新来源衔接后章号跳转：应为第 ${number + 1} 章，实际为「${entry.title}」`);
        number = identity.number;
      } else if (!notice(entry.title)) throw Error(`无法确定新增条目是否为公告或番外：「${entry.title}」，需核对后接续`);
    }
    options.onProgress?.({jobId: id, mode, downloaded: 0, total: targets.length, failed: 0});
    for (const entry of targets) {
      const value = await chapter(entry, links);
      if (!chapterIdentity(entry.title)) {
        const same = book.chapters.filter(old => !chapterIdentity(old.title) && normalize(old.title) === normalize(entry.title));
        if (same.length) {
          if (same.length !== 1 || bodyKey(same[0].content, same[0].title) !== bodyKey(value.content, value.title)) throw Error(`同名公告或番外内容冲突：「${entry.title}」`);
          skipped.push({title: entry.title, link: entry.link, reason: '原书已包含同名且正文一致的条目'});
          continue;
        }
      }
      tail.push({...formatChapterForExport(value), chapter_number: lastOrdinal + tail.length + 1, sourceChapterNumber: value.chapter_number, sourceChapterUrl: value.link, sourceBookUrl: spec.sourceUrl});
      options.onProgress?.({jobId: id, mode, downloaded: tail.length + skipped.length, total: targets.length, failed: 0});
    }
    nextBook = {...book, chapters: [...book.chapters, ...tail]};
    // Preserve stable import identity, author mapping, cover and all old chapters.
    if (source.actual?.description) nextBook.description = source.actual.description;
    if (source.actual?.status && book.status !== '完结') nextBook.status = source.actual.status;
    quality = qualityReport(nextBook.chapters, nextBook.chapters, [], mode);
    const newIssues = quality.issues.filter(issue => issue.chapter > lastOrdinal);
    if (newIssues.some(issue => issue.level !== 'info' && issue.code !== 'short-outlier')) throw Error(`新增内容检查未通过：${newIssues.map(issue => `第 ${issue.chapter} 项 ${issue.code}`).join('；')}`);
    prepareImport(nextBook);
    if (stopped()) { paused = true; throw Error('采集已暂停'); }
    if (mode === 'download') {
      if (hash(fs.readFileSync(file)) !== originalHash) throw Error('采集期间原书被其他程序修改，拒绝覆盖');
      const nextHash = hash(bytes(nextBook));
      const next = {version: 1, revision: (binding?.revision || 0) + 1, title: book.title, author: book.author, file: selected.file, outputPath: file, originalSourceUrl: book.sourceUrl,
        source: {url: spec.sourceUrl, title: spec.title, author: spec.author, variant: spec.variant || '', extraction}, count: nextBook.chapters.length, exportHash: nextHash, catalog: catalog.map(({title, link}) => ({title, link})),
        anchors: switching ? anchors : binding.anchors, skipped, previousSourceUrl: switching ? binding?.source.url || book.sourceUrl : binding.previousSourceUrl, updatedAt: new Date().toISOString()};
      reusedExport = originalHash === nextHash;
      if (switching || !reusedExport || hash(next.catalog) !== hash(binding.catalog)) {
        if (!fs.existsSync(path.join(dir, 'original.json'))) atomicWrite(path.join(dir, 'original.json'), original);
        if (!reusedExport) atomicWrite(path.join(dir, 'previous.json'), original);
        atomicWrite(path.join(dir, 'pending.json'), sealed({previousBindingHash: hash(binding), previousExportHash: originalHash, next, book: nextBook}));
        recoverContinuation(spec, options);
      }
      added = tail.length; exportFile = file;
    }
  } catch (error) {
    paused ||= !!stopped();
    if (!paused) failures.push({error: error.message, nextStep: '原文件和已取得的新来源检查点均保留；核对衔接目录、正文或文件变更后重新查找续更。'});
  } finally { if (!options.client) await client.close(); }
  const issues = quality.issues.filter(issue => issue.chapter > lastOrdinal);
  const errors = failures.length + issues.filter(issue => issue.level === 'error').length;
  const result = {title: book.title, author: book.author, sourceUrl: spec.sourceUrl, originalSourceUrl: book.sourceUrl, mode, jobId: id, continuation: true, switching,
    expected: exportFile ? nextBook.chapters.length : book.chapters.length + tail.length, downloaded: exportFile ? nextBook.chapters.length : book.chapters.length,
    originalCount: book.chapters.length, sourceExpected: catalog.length, continuationAdded: added, checkedNew: tail.length, anchors, skipped, evidence, issues, failures,
    errors, warnings: issues.filter(issue => issue.level === 'warning').length, information: issues.filter(issue => issue.level === 'info').length,
    structuralPass: !errors && !paused, completeAgainstSource: !!exportFile, paused, exportFile, reusedExport, description: nextBook.description, status: nextBook.status,
    checkedAt: new Date().toISOString(), elapsedMs: Date.now() - started, requests: Object.fromEntries(Object.entries(client.stats).map(([key, value]) => [key, value - initialStats[key]])),
    limitation: '保留原书全部条目及稳定导入来源；换源核对末尾三个连续正文章节，只追加衔接点之后的内容。目录改名、拆合章、编号重置或正文不一致会停止。未重采或核对新站全部旧正文。'};
  result.reportFile = path.join(sourceDir, `${mode}-report.json`);
  result.summaryFile = path.join(sourceDir, `${mode}-report.md`);
  atomicWrite(result.reportFile, result);
  atomicWrite(result.summaryFile, `# 换源续更报告\n\n原有 ${result.originalCount} 项；本次追加 ${added} 项；衔接核对 ${anchors.length} 章。\n\n${result.limitation}\n\n${failures.map(item => item.error).join('\n\n')}\n`);
  return result;
}
