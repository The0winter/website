import fs from 'node:fs';
import {mergeBookCategory} from './categories.mjs';
import path from 'node:path';
import {load} from 'cheerio';
import {atomicWrite, readJson, hash} from './storage.mjs';
import {normalizedIdentity} from './identity.mjs';
import {qualityReport} from './quality.mjs';
import {getCatalog, getChapter} from './adapters.mjs';
import {makeClient, decode, httpUrl} from './http.mjs';
import {browserProfile} from './browser-session.mjs';
import {failureDetails} from './diagnostics.mjs';
import {formatChapterForExport, preserveCatalogLabels} from './titles.mjs';
import {prepareImport} from '../../infra/import-plan.mjs';
import {preservedReadingGap} from './continuation-reading-gaps.mjs';

const normalize = value => normalizedIdentity(value, 'chinese-simplified');
const sameBook = (a, b) => ['title', 'author'].every(key => a[key] && b[key] && normalize(a[key]) === normalize(b[key]));
export const continuationKey = spec => hash([normalize(spec.title), normalize(spec.author)]).slice(0, 24);
const directory = (stateDir, spec) => path.join(stateDir, 'continuations', continuationKey(spec));
const sourceDirectory = (stateDir, spec, extraction) => path.join(directory(stateDir, spec), 'sources', hash([spec.sourceUrl, extraction]).slice(0, 24));
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

export function continuationState(spec, {stateDir, outputDir, inspection}) {
  const dir = directory(stateDir, spec), file = path.join(dir, 'binding.json');
  if (hasContinuation(spec, stateDir)) {
    const pending = fs.existsSync(path.join(dir, 'pending.json')) ? checked(path.join(dir, 'pending.json')) : null;
    const binding = fs.existsSync(file) ? checked(file) : pending.next;
    validateBinding(binding, spec, outputDir);
    const output = targetPath(outputDir, binding.file);
    if (!fs.existsSync(output)) throw Error('已绑定的续更文件被移走，请恢复原文件后继续');
    const exportHash = inspection?.files.get(output)?.hash || hash(fs.readFileSync(output));
    if (!(pending ? [pending.previousExportHash, pending.next.exportHash] : [binding.exportHash]).includes(exportHash)) throw Error('续更文件已被其他程序修改，拒绝覆盖');
    const switching = binding.source.url !== spec.sourceUrl;
    return {state: switching ? 'switch' : 'complete', saved: binding.count, total: binding.count, continuation: {file: binding.file, hash: exportHash},
      message: `已关联本地文件「${binding.file}」· ${binding.count} 项；${switching ? '换源续更会先核对衔接，只追加后续章节。' : '检查更新会沿用当前来源，只追加后续章节。'}`};
  }
  let candidates = (inspection?.books || inventory(outputDir)).filter(book => sameBook(spec, book));
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
// Only explicit suffixes are parts: words such as “下克上” are ordinary titles.
export function chapterPartIdentity(title) {
  const text = String(title).normalize('NFKC').trim();
  const match = /(?:\s+([上下])|\(([上下]|[12](?:\/2)?)\)|【([上下])】|\[([上下])\])$/u.exec(text);
  if (!match) return null;
  const baseTitle = text.slice(0, match.index).trim(), identity = chapterIdentity(baseTitle);
  if (!identity?.name) return null;
  const label = match[1] || match[2] || match[3] || match[4];
  return {...identity, baseTitle, part: /^(?:上|1)/u.test(label) ? 1 : 2,
    family: /[上下]/u.test(label) ? 'upper-lower' : label.includes('/') ? 'fraction' : 'numeric'};
}
const samePart = (a, b) => !a && !b || !!a && !!b && a.number === b.number && a.name === b.name && a.family === b.family && a.part === b.part;
const followsPart = (a, b) => a?.part === 1 && b?.part === 2 && a.number === b.number && a.name === b.name && a.family === b.family;
const completePair = pair => {
  const [a, b] = pair.map(chapter => chapterPartIdentity(chapter.title));
  return pair.length === 2 && followsPart(a, b);
};
function policyPart(title, policy) {
  const part = chapterPartIdentity(title);
  return part && (!policy?.families || policy.families.includes(part.family)) ? part : null;
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

const reviewFingerprint = chapter => ({link: chapter.link, title: normalize(chapter.title), contentHash: hash(chapter.content)});
const reviewPairKey = pair => hash(pair.map(reviewFingerprint).sort((a, b) => a.link.localeCompare(b.link)));
function loadReviews(spec, {stateDir, extraction}) {
  const file = path.join(sourceDirectory(stateDir, spec, extraction), 'reviews.json');
  if (!fs.existsSync(file)) return {version: 1, title: spec.title, author: spec.author, sourceUrl: spec.sourceUrl, extraction, decisions: []};
  const value = checked(file);
  if (value.version !== 1 || !sameBook(value, spec) || value.sourceUrl !== spec.sourceUrl || value.extraction !== extraction || !Array.isArray(value.decisions)) throw Error('版本核对记录与书籍或来源规则不匹配');
  return value;
}

// Called under the same book lock as acquisition. A review is specific to both
// complete, checksummed source bodies; similarity alone never selects a version.
export function recordContinuationReview(spec, options, {firstLink, secondLink, keepLink, reason}) {
  if (firstLink === secondLink || ![firstLink, secondLink].includes(keepLink) || typeof reason !== 'string' || !reason.trim()) throw Error('需要两个不同的来源链接、保留版本及核对理由');
  const sourceDir = sourceDirectory(options.stateDir, spec, options.extraction);
  const pair = [firstLink, secondLink].map(link => {
    const saved = readJson(path.join(sourceDir, 'chapters', hash(link) + '.json'));
    if (!saved?.chapter || saved.hash !== hash(saved.chapter) || saved.chapter.link !== link) throw Error('待核对版本的完整检查点缺失或损坏');
    return saved.chapter;
  });
  const state = loadReviews(spec, options), [a, b] = pair.map(chapter => chapterIdentity(chapter.title));
  const reviewedNotices = pair.every(chapter => state.noticeDecisions?.some(item => item.key === hash(reviewFingerprint(chapter))));
  if (a ? !b || a.number !== b.number || !compatibleNames(a.name, b.name) : b || !notice(pair[0].title) && !reviewedNotices || normalize(pair[0].title) !== normalize(pair[1].title)) throw Error('只能核对同章号同标题的版本或同名公告，不能跨章删改');
  const key = reviewPairKey(pair);
  const decision = {key, versions: pair.map(reviewFingerprint), keepLink, reason: reason.trim(), reviewedAt: new Date().toISOString()};
  state.decisions = [...state.decisions.filter(item => item.key !== key), decision];
  atomicWrite(path.join(sourceDir, 'reviews.json'), sealed(state));
  return decision;
}

const anchorReviewKey = (book, file, previous, incoming) => hash({sourceUrl: book.sourceUrl, file,
  oldPosition: previous.chapter_number, old: reviewFingerprint(previous), incoming: Array.isArray(incoming) ? incoming.map(reviewFingerprint) : reviewFingerprint(incoming)});

export function recordContinuationPartPolicy(spec, options, {reason, families}) {
  if (typeof reason !== 'string' || !reason.trim()) throw Error('接受拆章需要明确的核对理由');
  if (families !== undefined && (!Array.isArray(families) || !families.length || new Set(families).size !== families.length || families.some(f => !['upper-lower', 'fraction', 'numeric'].includes(f)))) throw Error('拆章类型只能选择 upper-lower、fraction 或 numeric');
  const state = loadReviews(spec, options);
  state.partPolicy = {kind: 'paired', ...(families ? {families} : {}), reason: reason.trim(), reviewedAt: new Date().toISOString()};
  atomicWrite(path.join(sourceDirectory(options.stateDir, spec, options.extraction), 'reviews.json'), sealed(state));
  return state.partPolicy;
}

// Explicit review records a verified correspondence, never a replacement for the
// old prose. Both complete bodies must still match the hashes the reviewer saw.
export function recordContinuationAnchorReview(spec, options, {file, oldNumber, newLink, newLinks, oldHash, newHash, newHashes, reason}) {
  const links = newLinks || [newLink], hashes = newHashes || [newHash];
  if (!Number.isSafeInteger(oldNumber) || !oldHash || !Array.isArray(links) || ![1, 2].includes(links.length) || newLinks && links.length !== 2 || !Array.isArray(hashes) || hashes.length !== links.length || hashes.some(h => !h) || typeof reason !== 'string' || !reason.trim()) throw Error('衔接核对需要旧顺序号、双方正文哈希及具体核对理由');
  const book = readJson(targetPath(options.outputDir, file));
  if (!book || !sameBook(book, spec)) throw Error('衔接核对的本地作品身份不匹配');
  const ending = numbered(book.chapters).slice(-3), previous = book.chapters.find(chapter => chapter.chapter_number === oldNumber);
  if (!previous || !ending.some(item => book.chapters[item.index] === previous)) throw Error('只能核对原书末尾三个正文章节');
  const sourceDir = sourceDirectory(options.stateDir, spec, options.extraction);
  const parts = links.map(link => {
    const saved = readJson(path.join(sourceDir, 'chapters', hash(link) + '.json'));
    if (!saved?.chapter || saved.hash !== hash(saved.chapter) || saved.chapter.link !== link) throw Error('新来源衔接章完整检查点缺失或损坏');
    return saved.chapter;
  });
  const state = loadReviews(spec, options), paired = parts.length === 2;
  if (paired && (state.partPolicy?.kind !== 'paired' || !completePair(parts) || parts[1].chapter_number !== parts[0].chapter_number + 1 || chapterPartIdentity(previous.title))) throw Error('拆章衔接需要已确认的完整相邻上下篇，不能缺篇或跨章');
  const incoming = paired ? parts : parts[0], a = chapterIdentity(previous.title), b = paired ? chapterPartIdentity(parts[0].title) : chapterIdentity(parts[0].title);
  if (!b || a.number !== b.number || !compatibleNames(a.name, b.name) || !paired && !samePart(chapterPartIdentity(previous.title), chapterPartIdentity(parts[0].title))) throw Error('衔接核对要求同章号且标题对应，不能接受未配对拆章或缺章');
  if (hash(previous.content) !== oldHash || parts.some((part, index) => hash(part.content) !== hashes[index])) throw Error('衔接正文已变化，请重新核对双方完整正文');
  if (bodyKey(previous.content, previous.title).length < 100 || parts.some(part => bodyKey(part.content, part.title).length < 100)) throw Error('衔接正文过短，无法确认对应关系');
  const key = anchorReviewKey(book, file, previous, incoming);
  const decision = {key, file, originalSourceUrl: book.sourceUrl, oldPosition: oldNumber,
    old: reviewFingerprint(previous), incoming: paired ? parts.map(reviewFingerprint) : reviewFingerprint(incoming), reason: reason.trim(), reviewedAt: new Date().toISOString()};
  state.anchorDecisions = [...(state.anchorDecisions || []).filter(item => item.key !== key), decision];
  atomicWrite(path.join(sourceDir, 'reviews.json'), sealed(state));
  return decision;
}

export function recordContinuationNoticeReview(spec, options, {link, contentHash, reason}) {
  if (!link || !contentHash || typeof reason !== 'string' || !reason.trim()) throw Error('公告核对需要链接、正文哈希及具体理由');
  const sourceDir = sourceDirectory(options.stateDir, spec, options.extraction);
  const saved = readJson(path.join(sourceDir, 'chapters', hash(link) + '.json'));
  if (!saved?.chapter || saved.hash !== hash(saved.chapter) || saved.chapter.link !== link || hash(saved.chapter.content) !== contentHash) throw Error('公告完整检查点缺失、损坏或正文已变化');
  if (chapterIdentity(saved.chapter.title)) throw Error('不能把带章号的正文核对为公告来绕过章号检查');
  const fingerprint = reviewFingerprint(saved.chapter), key = hash(fingerprint), state = loadReviews(spec, options);
  const decision = {key, ...fingerprint, reason: reason.trim(), reviewedAt: new Date().toISOString()};
  state.noticeDecisions = [...(state.noticeDecisions || []).filter(item => item.key !== key), decision];
  atomicWrite(path.join(sourceDir, 'reviews.json'), sealed(state));
  return decision;
}

// A small backward numbering reset can be reviewed only with three adjacent
// complete source chapters and a saved independent catalog showing their order.
// Preserve every title and body; this is never permission to skip a chapter.
export function recordContinuationNumberReset(spec, options, {links, hashes, reference, reason}) {
  if (!Array.isArray(links) || links.length !== 3 || new Set(links).size !== 3 || !Array.isArray(hashes) || hashes.length !== 3 || !reference || typeof reason !== 'string' || !reason.trim()) throw Error('章号回退核对需要连续三章、完整正文哈希、独立目录及理由');
  const sourceDir = sourceDirectory(options.stateDir, spec, options.extraction), catalog = readJson(path.join(sourceDir, 'catalog.json'));
  const positions = links.map(link => catalog?.findIndex(c => c.link === link));
  if (!positions.every((p, i) => Number.isInteger(p) && p >= 0 && (!i || p === positions[0] + i))) throw Error('章号回退只能核对来源目录中相邻的三章');
  const chapters = links.map((link, i) => {
    const saved = readJson(path.join(sourceDir, 'chapters', hash(link) + '.json'));
    if (!saved?.chapter || saved.hash !== hash(saved.chapter) || saved.chapter.link !== link || hash(saved.chapter.content) !== hashes[i] || saved.catalogTitle !== catalog[positions[i]].title || saved.chapter.chapter_number !== positions[i] + 1) throw Error('章号回退的完整来源检查点已变化');
    const chapter = saved.chapter, identity = chapterIdentity(chapter.title);
    if (!identity || chapterPartIdentity(chapter.title) || normalize(chapter.title) !== normalize(saved.catalogTitle) || bodyKey(chapter.content, chapter.title).length < 100) throw Error('章号回退不能代替拆章、缺正文或目录标题核对');
    return chapter;
  });
  const ids = chapters.map(c => chapterIdentity(c.title)), delta = ids[0].number + 1 - ids[1].number;
  if (delta < 1 || delta > 10 || ids[2].number !== ids[1].number + 1 || ids.some((id, i) => ids.some((other, j) => i !== j && compatibleNames(id.name, other.name)))) throw Error('仅支持不同标题连续正文的小范围编号回退，不能豁免缺章或重复版本');
  const referenceUrl = httpUrl(reference.url), raw = fs.readFileSync(reference.bodyFile);
  if (new URL(referenceUrl).hostname === new URL(spec.sourceUrl).hostname || hash(raw) !== reference.hash || !Array.isArray(reference.chapters) || reference.chapters.length !== 3) throw Error('独立目录证据或原始页面哈希无效');
  const $ = load(decode(raw, reference.contentType, reference.encoding));
  if (!normalize($('title').text()).includes(normalize(spec.title)) || !normalize($.text()).includes(normalize(spec.author))) throw Error('独立目录未核实同书同作者');
  const refs = reference.chapters.map(c => ({title: c.title, link: httpUrl(c.link, referenceUrl)}));
  const all = $('a[href]').toArray().map(el => ({title: $(el).text().trim(), link: (() => { try { return httpUrl($(el).attr('href'), referenceUrl); } catch { return ''; } })()})).filter(c => chapterIdentity(c.title));
  const at = refs.map(c => all.flatMap((a, i) => a.link === c.link && normalize(a.title) === normalize(c.title) ? [i] : []));
  if (at.some(a => a.length !== 1) || !at.every((a, i) => !i || a[0] === at[0][0] + i)) throw Error('独立目录须唯一列出相邻三章，不能省略中间正文');
  const refIds = refs.map(c => chapterIdentity(c.title));
  if (refIds.some((id, i) => !id || !compatibleNames(id.name, ids[i].name) || id.number !== ids[1].number + i - 1)) throw Error('独立目录标题或连续章号与回退衔接不对应');
  const window = chapters.map(c => ({...reviewFingerprint(c), sourcePosition: c.chapter_number}));
  const decision = {key: hash(window), window, reference: {url: referenceUrl, hash: reference.hash, chapters: refs}, reason: reason.trim(), reviewedAt: new Date().toISOString()};
  const state = loadReviews(spec, options);
  state.numberResets = [...(state.numberResets || []).filter(d => d.key !== decision.key), decision];
  atomicWrite(path.join(sourceDir, 'references', reference.hash + '.bin'), raw);
  atomicWrite(path.join(sourceDir, 'reviews.json'), sealed(state));
  return decision;
}

const numberingFingerprint = (chapter, catalogTitle) => ({...reviewFingerprint(chapter),
  catalogTitle: normalize(catalogTitle), sourcePosition: chapter.sourceChapterNumber || chapter.chapter_number});
const sourceDefectKey = ({previousNumber, window, boundary}) => hash({previousNumber, window, ...(boundary ? {boundary} : {})});
const sourceGapKey = ({boundary, window, reference, gaps}) => hash({boundary, window, reference, gaps});

// An explicitly reviewed small gap is never a fabricated chapter or an implicit
// numbering fix. Pin the old book, two complete following bodies and an independent
// catalog that names every missing chapter; keep the omission visible on later runs.
export function recordContinuationSourceGap(spec, options, {file, exportHash, links, hashes, reference, reason}) {
  if (!Array.isArray(links) || links.length !== 2 || new Set(links).size !== 2 || !Array.isArray(hashes) || hashes.length !== 2 || !reference || typeof reason !== 'string' || !reason.trim()) throw Error('缺章验收需要后续相邻两章、完整正文哈希、独立目录及核对理由');
  const rawBook = fs.readFileSync(targetPath(options.outputDir, file)), book = JSON.parse(rawBook);
  if (hash(rawBook) !== exportHash || !sameBook(book, spec)) throw Error('缺章验收的原书已变化或作品身份不匹配');
  prepareImport(book);
  const last = numbered(book.chapters).at(-1), previous = book.chapters[last?.index];
  if (!previous || chapterPartIdentity(previous.title)) throw Error('缺章验收需要完整的旧书末章');
  const sourceDir = sourceDirectory(options.stateDir, spec, options.extraction), catalog = readJson(path.join(sourceDir, 'catalog.json'));
  const positions = links.map(link => catalog?.findIndex(c => c.link === link));
  if (!positions.every((p, i) => Number.isInteger(p) && p >= 0 && (!i || p === positions[0] + i))) throw Error('缺章验收的后续两章必须在来源目录中相邻');
  const chapters = links.map((link, i) => {
    const saved = readJson(path.join(sourceDir, 'chapters', hash(link) + '.json')), entry = catalog[positions[i]];
    if (!saved?.chapter || saved.hash !== hash(saved.chapter) || saved.chapter.link !== link || hash(saved.chapter.content) !== hashes[i] || saved.catalogTitle !== entry.title || saved.chapter.chapter_number !== entry.chapter_number) throw Error('缺章验收的完整来源检查点已变化');
    const value = saved.chapter, quality = qualityReport([entry], [value], [], 'probe');
    if (!chapterIdentity(value.title) || chapterPartIdentity(value.title) || normalize(value.title) !== normalize(entry.title) || bodyKey(value.content, value.title).length < 100 || quality.issues.some(issue => issue.level !== 'info' && issue.code !== 'short-outlier')) throw Error('缺章验收不能放行空文、乱码、拆章或标题错配');
    return value;
  });
  const ids = chapters.map(c => chapterIdentity(c.title)), missing = ids[0].number - last.number - 1;
  if (missing < 1 || missing > 3 || ids[1].number !== ids[0].number + 1 || catalog.some(c => { const n = chapterIdentity(c.title)?.number; return n > last.number && n < ids[0].number; })) throw Error('只允许验收目录确实缺失的1–3章，不能跳过已有正文');
  const referenceUrl = httpUrl(reference.url), raw = fs.readFileSync(reference.bodyFile);
  if (!raw.length || raw.length > 2_000_000 || new URL(referenceUrl).hostname === new URL(spec.sourceUrl).hostname || hash(raw) !== reference.hash || !Array.isArray(reference.chapters) || reference.chapters.length !== missing + 3) throw Error('缺章验收的独立目录证据无效');
  const $ = load(decode(raw, reference.contentType, reference.encoding));
  if (!normalize($('title').text()).includes(normalize(spec.title)) || !normalize($.text()).includes(normalize(spec.author))) throw Error('独立目录未核实同书同作者');
  const refs = reference.chapters.map(c => ({title: c.title, link: httpUrl(c.link, referenceUrl)}));
  const all = $('a[href]').toArray().map(el => ({title: $(el).text().trim(), link: (() => { try { return httpUrl($(el).attr('href'), referenceUrl); } catch { return ''; } })()})).filter(c => chapterIdentity(c.title));
  const at = refs.map(c => all.flatMap((a, i) => a.link === c.link && normalize(a.title) === normalize(c.title) ? [i] : [])), refIds = refs.map(c => chapterIdentity(c.title));
  if (at.some(a => a.length !== 1) || !at.every((a, i) => !i || a[0] === at[0][0] + i) || refIds.some((id, i) => !id || chapterPartIdentity(refs[i].title) || id.number !== last.number + i) || refIds[0].name !== last.name || ids.some((id, i) => id.name !== refIds.at(i - 2).name)) throw Error('独立目录必须完整列出同题边界及每一缺章，不能省略或调序');
  const scope = {boundary: {file, exportHash, bookHash: hash(book), chapterHash: hash(previous), previousNumber: last.number},
    window: chapters.map((c, i) => numberingFingerprint(c, catalog[positions[i]].title)), reference: {url: referenceUrl, hash: reference.hash, chapters: refs},
    gaps: refs.slice(1, -2).map(c => ({...c, kind: 'missing', reason: reason.trim()}))};
  const decision = {...scope, key: sourceGapKey(scope), reason: reason.trim(), reviewedAt: new Date().toISOString()}, state = loadReviews(spec, options);
  state.sourceGaps = [...(state.sourceGaps || []).filter(d => d.window[0].link !== links[0]), decision];
  atomicWrite(path.join(sourceDir, 'references', reference.hash + '.bin'), raw);
  atomicWrite(path.join(sourceDir, 'reviews.json'), sealed(state));
  return decision;
}

// Explicitly accept a known source numbering defect, without correcting, filling,
// dropping or reordering prose. Three adjacent complete entries bind its scope.
export function recordContinuationSourceDefect(spec, options, {links, hashes, evidenceFile, evidenceHash, reason, boundary}) {
  if (!Array.isArray(links) || links.length !== 3 || new Set(links).size !== 3 || !Array.isArray(hashes) || hashes.length !== 3 || !evidenceFile || !evidenceHash || typeof reason !== 'string' || !reason.trim()) throw Error('接受来源编号缺陷需要相邻三项、完整正文哈希、证据文件及具体理由');
  const sourceDir = sourceDirectory(options.stateDir, spec, options.extraction), catalog = readJson(path.join(sourceDir, 'catalog.json'));
  const positions = links.map(link => catalog?.findIndex(c => c.link === link));
  if (!positions.every((p, i) => Number.isInteger(p) && p >= 0 && (!i || p === positions[0] + i))) throw Error('来源缺陷核对窗口必须是相邻三项');
  const chapters = links.map((link, i) => {
    const saved = readJson(path.join(sourceDir, 'chapters', hash(link) + '.json')), entry = catalog[positions[i]];
    if (!saved?.chapter || saved.hash !== hash(saved.chapter) || saved.chapter.link !== link || hash(saved.chapter.content) !== hashes[i] || saved.catalogTitle !== entry.title || saved.chapter.chapter_number !== entry.chapter_number) throw Error('来源缺陷的完整检查点已变化');
    const value = saved.chapter, quality = qualityReport([entry], [value], [], 'probe');
    if (quality.issues.some(issue => issue.level !== 'info' && issue.code !== 'short-outlier') || normalize(value.title) !== normalize(entry.title) || i && (!chapterIdentity(value.title) || bodyKey(value.content, value.title).length < 100)) throw Error('来源编号缺陷不能接受访问页、乱码、空正文或标题错配');
    return formatChapterForExport(value);
  });
  const previousNumber = numbered(catalog.slice(0, positions[1])).at(-1)?.number, current = chapterIdentity(chapters[1].title);
  if (!previousNumber || current.number === previousNumber + 1 || policyPart(chapters[1].title, loadReviews(spec, options).partPolicy)) throw Error('来源编号缺陷只能接受实际跳号、重号或回退，拆章需单独核对');
  const evidence = fs.readFileSync(evidenceFile);
  if (!evidence.length || evidence.length > 2_000_000 || hash(evidence) !== evidenceHash) throw Error('来源缺陷证据缺失、过大或哈希不符');
  const window = chapters.map((c, i) => numberingFingerprint(c, catalog[positions[i]].title));
  let reviewedBoundary;
  if (boundary) {
    if (!options.outputDir || !boundary.exportHash || !boundary.chapterHash) throw Error('边界编号核对需要原文件和末章的完整哈希');
    const raw = fs.readFileSync(targetPath(options.outputDir, boundary.file)), book = JSON.parse(raw), previous = book.chapters?.at(-1);
    if (hash(raw) !== boundary.exportHash || !sameBook(spec, book) || !previous || hash(previous) !== boundary.chapterHash) throw Error('边界编号核对的原书或末章已变化');
    const previousId = chapterIdentity(previous.title), sourceId = chapterIdentity(chapters[0].title);
    if (!previousId || !sourceId || previousId.number !== sourceId.number || !compatibleNames(previousId.name, sourceId.name) ||
      bodyKey(previous.content, previous.title).length < 100 || bodyKey(previous.content, previous.title) !== bodyKey(chapters[0].content, chapters[0].title)) throw Error('边界编号核对必须与原书末章完整正文一致');
    reviewedBoundary = {file: boundary.file, exportHash: boundary.exportHash, bookHash: hash(book), chapterHash: boundary.chapterHash};
  }
  const scope = {previousNumber, window, ...(reviewedBoundary ? {boundary: reviewedBoundary} : {})};
  const key = sourceDefectKey(scope), decision = {key, kind: 'numbering', ...scope, evidenceHash, reason: reason.trim(), reviewedAt: new Date().toISOString()};
  const state = loadReviews(spec, options);
  state.sourceDefects = [...(state.sourceDefects || []).filter(d => d.window[1].link !== links[1]), decision];
  atomicWrite(path.join(sourceDir, 'references', evidenceHash + '.bin'), evidence);
  atomicWrite(path.join(sourceDir, 'reviews.json'), sealed(state));
  return decision;
}

// Correct an explicitly reviewed, bounded numbering error between two unchanged
// chapters. An independent catalog must contain the same complete adjacent window.
// Full source bodies and raw titles remain intact in their original checkpoints.
export function recordContinuationNumberCorrection(spec, options, {links, hashes, reference, reason}) {
  if (!Array.isArray(links) || links.length < 3 || links.length > 12 || new Set(links).size !== links.length || !Array.isArray(hashes) || hashes.length !== links.length || !reference || typeof reason !== 'string' || !reason.trim()) throw Error('章号校正需要3–12个连续完整章节、正文哈希、独立目录和理由');
  const sourceDir = sourceDirectory(options.stateDir, spec, options.extraction), catalog = readJson(path.join(sourceDir, 'catalog.json'));
  const positions = links.map(link => catalog?.findIndex(c => c.link === link));
  if (!positions.every((p, i) => Number.isInteger(p) && p >= 0 && (!i || p === positions[0] + i))) throw Error('章号校正窗口必须在来源目录中相邻');
  const chapters = links.map((link, i) => {
    const saved = readJson(path.join(sourceDir, 'chapters', hash(link) + '.json'));
    if (!saved?.chapter || saved.hash !== hash(saved.chapter) || saved.chapter.link !== link || hash(saved.chapter.content) !== hashes[i] || saved.catalogTitle !== catalog[positions[i]].title || saved.chapter.chapter_number !== positions[i] + 1) throw Error('章号校正的完整来源检查点已变化');
    const chapter = saved.chapter;
    if (!chapterIdentity(chapter.title) || chapterPartIdentity(chapter.title) || normalize(chapter.title) !== normalize(saved.catalogTitle) || bodyKey(chapter.content, chapter.title).length < 100) throw Error('章号校正不能替代拆章、目录标题不符或缺正文的核对');
    return chapter;
  });
  const referenceUrl = httpUrl(reference.url), raw = fs.readFileSync(reference.bodyFile);
  if (new URL(referenceUrl).hostname === new URL(spec.sourceUrl).hostname || hash(raw) !== reference.hash || !Array.isArray(reference.chapters) || reference.chapters.length !== links.length) throw Error('独立目录证据或原始页面哈希无效');
  const $ = load(decode(raw, reference.contentType, reference.encoding));
  if (!normalize($('title').text()).includes(normalize(spec.title)) || !normalize($.text()).includes(normalize(spec.author))) throw Error('独立目录未核实同书同作者');
  const refs = reference.chapters.map(c => ({title: c.title, link: httpUrl(c.link, referenceUrl)}));
  const all = $('a[href]').toArray().map(el => ({title: $(el).text().trim(), link: (() => { try { return httpUrl($(el).attr('href'), referenceUrl); } catch { return ''; } })()})).filter(c => chapterIdentity(c.title));
  const at = refs.map(c => all.flatMap((a, i) => a.link === c.link && normalize(a.title) === normalize(c.title) ? [i] : []));
  if (at.some(a => a.length !== 1) || !at.every((a, i) => !i || a[0] === at[0][0] + i)) throw Error('独立目录必须唯一列出全部相邻章节，不能略去中间条目');
  const ids = chapters.map(c => chapterIdentity(c.title)), refIds = refs.map(c => chapterIdentity(c.title));
  if (refIds.some((id, i) => !id || chapterPartIdentity(refs[i].title) || id.name !== ids[i].name || (i && id.number !== refIds[0].number + i)) || ids[0].number !== refIds[0].number || ids.at(-1).number !== refIds.at(-1).number || ids.every((id, i) => id.number === refIds[i].number) || new Set(refIds.map(id => id.name)).size !== refIds.length) throw Error('章号校正须同题且独立章号连续，首尾两章编号必须不变');
  const window = chapters.map((c, i) => ({source: numberingFingerprint(c, catalog[positions[i]].title),
    acceptedTitle: ids[i].number === refIds[i].number ? c.title : c.title.replace(/^第[0-9０-９零〇一二三四五六七八九十百千万两]+/u, `第${refIds[i].number}`)}));
  if (window.some((w, i) => chapterIdentity(w.acceptedTitle)?.number !== refIds[i].number)) throw Error('无法保留原章名进行编号校正');
  const state = loadReviews(spec, options), key = hash(window);
  const sameWindow = d => d.window.length === links.length && d.window.every((w, i) => w.source.link === links[i]);
  if ((state.numberCorrections || []).some(d => !sameWindow(d) && d.window.some(w => links.includes(w.source.link)))) throw Error('章号校正窗口与已有核对重叠');
  const decision = {key, window, reference: {url: referenceUrl, hash: reference.hash, chapters: refs}, reason: reason.trim(), reviewedAt: new Date().toISOString()};
  state.numberCorrections = [...(state.numberCorrections || []).filter(d => !sameWindow(d)), decision];
  atomicWrite(path.join(sourceDir, 'references', reference.hash + '.bin'), raw);
  atomicWrite(path.join(sourceDir, 'reviews.json'), sealed(state));
  return decision;
}

// A completed mirror may end inside a local edition's existing appendices and
// use volume numbers. Review its entire ending block before adopting the source;
// this operation only changes the binding, never the local book or its order.
export async function bindReviewedCompletedSource(spec, options, {file, exportHash, catalogHash, matches, reason}) {
  if (spec.kind !== 'html' || !Array.isArray(matches) || matches.length < 3 || matches.length > 10 || typeof reason !== 'string' || !reason.trim()) throw Error('完结来源绑定需要3–10个连续末尾条目的核对映射及具体理由');
  if (hasContinuation(spec, options.stateDir)) throw Error('已有换源绑定，请使用检查更新，不能覆盖原绑定');
  const target = targetPath(options.outputDir, file), original = fs.readFileSync(target), book = JSON.parse(original);
  if (hash(original) !== exportHash || !sameBook(book, spec) || book.status !== '完结') throw Error('本地完结作品身份、状态或文件哈希不匹配');
  prepareImport(book);
  if (book.chapters.some((c, i) => i && c.chapter_number <= book.chapters[i - 1].chapter_number)) throw Error('原书顺序号未严格递增');
  if (new Set(matches.map(m => m.oldNumber)).size !== matches.length) throw Error('末尾映射不能重复使用同一个旧章');
  const sourceDir = sourceDirectory(options.stateDir, spec, options.extraction);
  const client = options.client || makeClient({cacheDir: path.join(options.stateDir, 'cache'), profileDir: browserProfile(options.stateDir, spec.sourceUrl), allowedHosts: spec.allowedHosts, delayMs: spec.delayMs, retries: spec.retries, timeoutMs: spec.timeoutMs, browser: spec.browser});
  try {
    const source = await getCatalog(spec, client), catalog = source.catalog;
    if (source.actual.status !== '完结' || hash(catalog) !== catalogHash) throw Error('新来源未确认完结或目录已变化，请重新核对');
    const ending = catalog.slice(-matches.length), links = new Set(catalog.map(c => c.link)), anchors = [], checkpoints = [];
    if (ending.length !== matches.length) throw Error('新来源末尾条目不足');
    const name = title => {
      const text = String(title).replace(/^\s*\d+[.．]\s*/u, '');
      let result = chapterIdentity(text)?.name || normalize(text);
      if (result.startsWith('附录')) result = result.slice(2);
      const author = normalize(book.author);
      if (result.endsWith(author)) result = result.slice(0, -author.length);
      return result;
    };
    for (const [index, entry] of ending.entries()) {
      const mapping = matches[index], previous = book.chapters.find(c => c.chapter_number === mapping.oldNumber);
      if (!previous || mapping.newLink !== entry.link || !name(previous.title) || name(previous.title) !== name(entry.title)) throw Error('末尾映射须按新目录顺序、标题对应且旧章存在');
      const incoming = await getChapter(spec, entry, links, client);
      const quality = qualityReport([entry], [incoming], [], 'probe');
      if (quality.issues.some(issue => issue.level !== 'info' && issue.code !== 'short-outlier')) throw Error('新来源末尾章节未通过结构检查');
      if (name(incoming.title) !== name(entry.title) || hash(previous.content) !== mapping.oldHash || hash(incoming.content) !== mapping.newHash) throw Error('末尾完整正文或标题已变化，请重新核对');
      if (bodyKey(previous.content, previous.title).length < 100 || bodyKey(incoming.content, incoming.title).length < 100 || typeof mapping.reason !== 'string' || !mapping.reason.trim()) throw Error('每个末尾条目须有完整正文及具体差异核对依据');
      const checkpoint = {hash: hash(incoming), chapter: incoming, catalogTitle: entry.title};
      const saved = readJson(path.join(sourceDir, 'chapters', hash(entry.link) + '.json'));
      if (saved && (saved.hash !== hash(saved.chapter) || hash(saved.chapter.content) !== mapping.newHash || saved.chapter.title !== incoming.title || saved.chapter.link !== entry.link || saved.chapter.chapter_number !== entry.chapter_number || saved.catalogTitle !== entry.title)) throw Error('末尾来源检查点冲突或损坏');
      checkpoints.push({link: entry.link, value: saved || checkpoint});
      anchors.push({kind: 'reviewed-completed-ending', oldPosition: book.chapters.indexOf(previous) + 1, oldNumber: previous.chapter_number, sourcePosition: entry.chapter_number,
        oldLink: previous.link, newLink: incoming.link, oldHash: mapping.oldHash, newHash: mapping.newHash, oldTitle: previous.title, newTitle: incoming.title, reason: mapping.reason});
    }
    if (hash(fs.readFileSync(target)) !== exportHash || hasContinuation(spec, options.stateDir)) throw Error('核对期间原书或绑定已变化，拒绝覆盖');
    const updatedAt = new Date().toISOString(), review = {catalogHash, exportHash, reason: reason.trim(), anchors, reviewedAt: updatedAt};
    const binding = {version: 1, revision: 1, title: book.title, author: book.author, file, outputPath: target, originalSourceUrl: book.sourceUrl,
      source: {url: spec.sourceUrl, title: spec.title, author: spec.author, variant: spec.variant || '', extraction: options.extraction},
      count: book.chapters.length, exportHash, catalog: catalog.map(({title, link}) => ({title, link})), anchors, skipped: [], resolutions: [],
      previousSourceUrl: book.sourceUrl, completedSourceReview: review, updatedAt};
    validateBinding(binding, spec, options.outputDir);
    for (const checkpoint of checkpoints) atomicWrite(path.join(sourceDir, 'chapters', hash(checkpoint.link) + '.json'), checkpoint.value);
    atomicWrite(path.join(sourceDir, 'catalog.json'), catalog);
    atomicWrite(path.join(sourceDir, 'completed-source-review.json'), sealed(review));
    const dir = directory(options.stateDir, spec);
    if (!fs.existsSync(path.join(dir, 'original.json'))) atomicWrite(path.join(dir, 'original.json'), original);
    atomicWrite(path.join(dir, 'binding.json'), sealed(binding));
    return {sourceUrl: spec.sourceUrl, file, sourceEntries: catalog.length, reviewedEnding: anchors.length, added: 0, unchangedExport: true};
  } finally { if (!options.client) await client.close(); }
}

// Resolve only decisions backed by complete content or the chapter page's own
// heading. A repeated number with different prose is still an unresolved version.
export function createContinuationReviewer(book, reviews = [], noticeReviews = [], partPolicy, numberResets = [], numberCorrections = [], sourceDefects = [], sourceGaps = []) {
  const accepted = [...book.chapters], originals = new Set(book.chapters), skipped = [], resolutions = [];
  const boundaryBookHash = sourceGaps.length || sourceDefects.some(d => d.boundary) ? hash(book) : null;
  let number = numbered(accepted).at(-1)?.number;
  let requiredAfterReset = null;
  let correctionWindow = null;
  let requiredAfterDefect = null;
  const resetFingerprint = c => ({...reviewFingerprint(c), sourcePosition: c.sourceChapterNumber || c.chapter_number});
  const paired = partPolicy?.kind === 'paired';
  let openPart = paired ? policyPart(accepted.filter(c => chapterIdentity(c.title)).at(-1)?.title, partPolicy) : null;
  if (openPart?.part !== 1) openPart = null;
  if (!number) throw Error('原书缺少可核对的正文章号');
  return {
    skipped, resolutions,
    finish() { if (requiredAfterDefect) throw Error('来源缺陷的后续核对章缺失，旧书已保留'); if (correctionWindow) throw Error('章号校正的后续核对章缺失，旧书已保留'); if (requiredAfterReset) throw Error('章号回退的后续核对章缺失，旧书已保留'); if (openPart) throw Error(`拆章缺少下篇：第 ${openPart.number} 章「${openPart.baseTitle}」，旧书已保留`); },
    accept(entry, value) {
      if (requiredAfterDefect) {
        if (hash(numberingFingerprint(value, entry.title)) !== hash(requiredAfterDefect)) throw Error('来源缺陷的后续完整核对章已变化');
        requiredAfterDefect = null;
      }
      const completesReset = requiredAfterReset && hash(resetFingerprint(value)) === hash(requiredAfterReset);
      if (requiredAfterReset && !completesReset) throw Error('章号回退的后续核对章已变化，需重新核对');
      const listed = chapterIdentity(entry.title), originalTitle = value.title;
      if (!correctionWindow) {
        const review = numberCorrections.find(d => d.window[0]?.source.link === value.link);
        if (review) correctionWindow = {review, index: 0};
      }
      const correction = correctionWindow?.review, corrected = correction?.window[correctionWindow.index];
      if (correction) {
        if (correction.key !== hash(correction.window) || !corrected || hash(numberingFingerprint(value, entry.title)) !== hash(corrected.source)) throw Error('章号校正的完整相邻窗口已变化，请重新核对');
        if (normalize(corrected.acceptedTitle) !== normalize(value.title)) {
          value.sourceTitle ??= value.title;
          value.title = formatChapterForExport({title: corrected.acceptedTitle}).title;
        }
      }
      const actual = chapterIdentity(value.title);
      if (!!listed !== !!actual || (listed && !compatibleNames(listed.name, actual.name))) throw Error(`目录与正文标题无法对应：「${entry.title}」 / 「${value.title}」`);
      const part = paired ? policyPart(value.title, partPolicy) : null;
      if (paired && !samePart(policyPart(entry.title, partPolicy), part)) throw Error(`目录与正文拆章标记无法对应：「${entry.title}」 / 「${value.title}」`);
      const peers = accepted.filter(previous => {
        const identity = chapterIdentity(previous.title);
        return actual ? identity?.number === actual.number && compatibleNames(identity.name, actual.name) && (!paired || samePart(policyPart(previous.title, partPolicy), part)) : !identity && normalize(previous.title) === normalize(value.title);
      });
      const content = bodyKey(value.content, value.title);
      const duplicate = (actual ? content.length >= 100 : !!content) && peers.find(previous => bodyKey(previous.content, previous.title) === content);
      if (duplicate) {
        const decision = {kind: actual ? 'duplicate-chapter' : 'duplicate-notice', title: entry.title, link: entry.link, sourcePosition: entry.chapter_number,
          retainedTitle: duplicate.title, retainedLink: duplicate.link, retainedPosition: duplicate.chapter_number,
          contentHash: hash(value.content), retainedContentHash: hash(duplicate.content), comparisonHash: hash(content),
          reason: '书名作者已核对；同一章号及标题（或同名公告）的完整正文一致，保留已接受版本'};
        skipped.push(decision); resolutions.push(decision);
        return false;
      }
      for (const peer of peers) {
        const review = reviews.find(item => item.key === reviewPairKey([peer, value]));
        if (!review) continue;
        const incoming = review.keepLink === value.link;
        if (!incoming && review.keepLink !== peer.link) throw Error('版本核对记录的保留链接无效');
        if (incoming && originals.has(peer)) throw Error('版本核对不能替换原书章节，原书已保留');
        const kept = incoming ? value : peer, discarded = incoming ? peer : value;
        const decision = {kind: 'reviewed-variant', title: entry.title, link: discarded.link, sourcePosition: discarded.sourceChapterNumber || discarded.chapter_number,
          retainedTitle: kept.title, retainedLink: kept.link, retainedPosition: peer.chapter_number,
          contentHash: hash(discarded.content), retainedContentHash: hash(kept.content), reviewKey: review.key, reason: review.reason, reviewedAt: review.reviewedAt};
        if (incoming) {
          const ordinal = peer.chapter_number;
          for (const key of Object.keys(peer)) delete peer[key];
          Object.assign(peer, value, {chapter_number: ordinal});
        }
        skipped.push(decision); resolutions.push(decision);
        return false;
      }
      if (actual) {
        const secondPart = followsPart(openPart, part);
        if (openPart ? !secondPart : part?.part === 2 || actual.number !== number + 1) {
          const previous = accepted.at(-1), reset = !openPart && !part && !peers.length && !originals.has(previous) && numberResets.find(d =>
            d.key === hash(d.window) && d.window.length === 3 && hash(d.window[0]) === hash(resetFingerprint(previous)) && hash(d.window[1]) === hash(resetFingerprint(value)));
          const defect = !openPart && !part && !peers.length && sourceDefects.find(d =>
            d.kind === 'numbering' && d.key === sourceDefectKey(d) && d.previousNumber === number && d.window.length === 3 &&
            (originals.has(previous) ? d.boundary?.bookHash === boundaryBookHash && d.boundary?.chapterHash === hash(previous) :
              hash(d.window[0]) === hash(numberingFingerprint(previous, previous.catalogTitle || previous.title))) && hash(d.window[1]) === hash(numberingFingerprint(value, entry.title)));
          const oldLast = book.chapters[numbered(book.chapters).at(-1).index];
          const gap = !openPart && !part && !peers.length && sourceGaps.find(d => d.key === sourceGapKey(d) && d.boundary.bookHash === boundaryBookHash && d.boundary.chapterHash === hash(oldLast) && d.boundary.previousNumber === number && hash(d.window[0]) === hash(numberingFingerprint(value, entry.title)));
          if (!reset && !defect && !gap) {
            const reason = peers.length ? '同章号正文不同，不能自动选择版本' : '缺章或章号顺序无法确定';
            throw Error(`新来源衔接后章号冲突：应为第 ${openPart ? number + ' 章下篇' : number + 1 + ' 章'}，实际为「${value.title}」；${reason}`);
          }
          if (gap) {
            requiredAfterDefect = gap.window[1];
            resolutions.push({kind: 'reviewed-source-gap', title: value.title, link: value.link, gaps: gap.gaps, reviewKey: gap.key, reference: gap.reference, reason: gap.reason, reviewedAt: gap.reviewedAt});
          } else if (defect) {
            requiredAfterDefect = defect.window[2];
            resolutions.push({kind: 'accepted-source-defect', defect: 'numbering', title: value.title, link: value.link, acceptedPosition: value.chapter_number, sourcePosition: entry.chapter_number, previousLink: previous.link, previousTitle: previous.title, contentHash: hash(value.content), reviewKey: defect.key, evidenceHash: defect.evidenceHash, reason: defect.reason, reviewedAt: defect.reviewedAt});
          } else {
            requiredAfterReset = reset.window[2];
            resolutions.push({kind: 'reviewed-number-reset', title: value.title, link: value.link, sourcePosition: entry.chapter_number, previousLink: previous.link, previousTitle: previous.title, contentHash: hash(value.content), reviewKey: reset.key, reference: reset.reference, reason: reset.reason});
          }
        }
        if (correction && normalize(originalTitle) !== normalize(value.title)) resolutions.push({kind: 'reviewed-number-correction', title: entry.title, originalTitle, acceptedTitle: value.title, link: entry.link, sourcePosition: entry.chapter_number,
          contentHash: hash(value.content), reviewKey: correction.key, reference: correction.reference, reason: correction.reason, reviewedAt: correction.reviewedAt});
        else if (listed.number !== actual.number) resolutions.push({kind: 'catalog-number', title: entry.title, link: entry.link, sourcePosition: entry.chapter_number,
          acceptedTitle: value.title, catalogNumber: listed.number, pageNumber: actual.number, contentHash: hash(value.content),
          reason: '目录与正文页标题名称一致，正文页章号接续原书；沿用正文页标题，保留原目录标题'});
        number = actual.number;
        if (part) resolutions.push({kind: 'chapter-part', title: value.title, link: value.link, number: part.number, part: part.part, family: part.family, contentHash: hash(value.content), reason: partPolicy.reason});
        openPart = part?.part === 1 ? part : null;
      } else {
        const reviewed = noticeReviews.find(item => item.key === hash(reviewFingerprint(value)));
        if (!notice(value.title) && !reviewed) throw Error(`无法确定新增条目是否为公告或番外：「${value.title}」，需核对后接续`);
        if (peers.length && !reviewed) throw Error(`同名公告或番外内容冲突：「${value.title}」，两个版本均已保留，原书未改写`);
        if (reviewed) resolutions.push({kind: 'reviewed-notice', title: value.title, link: value.link, contentHash: hash(value.content), reviewKey: reviewed.key, reason: reviewed.reason, reviewedAt: reviewed.reviewedAt});
      }
      accepted.push(value);
      if (correctionWindow && ++correctionWindow.index === correctionWindow.review.window.length) correctionWindow = null;
      if (completesReset) requiredAfterReset = null;
      return true;
    },
  };
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
  const reviewState = loadReviews(spec, options);
  const reviewer = createContinuationReviewer(book, reviewState.decisions, reviewState.noticeDecisions, reviewState.partPolicy, reviewState.numberResets, reviewState.numberCorrections, reviewState.sourceDefects, reviewState.sourceGaps);
  const switching = !binding || binding.source.url !== spec.sourceUrl;
  if (!switching && binding.source.extraction !== extraction) throw Error('当前续更来源的提取规则已变化，请先核对适配，旧文件已保留');
  const sourceDir = sourceDirectory(stateDir, spec, extraction);
  for (const defect of reviewState.sourceDefects || []) {
    const evidenceFile = path.join(sourceDir, 'references', defect.evidenceHash + '.bin');
    if (!fs.existsSync(evidenceFile) || hash(fs.readFileSync(evidenceFile)) !== defect.evidenceHash) throw Error('已接受来源缺陷的证据缺失或变化');
  }
  for (const correction of [...(reviewState.numberCorrections || []), ...(reviewState.sourceGaps || [])]) {
    const referenceFile = path.join(sourceDir, 'references', correction.reference.hash + '.bin');
    if (!fs.existsSync(referenceFile) || hash(fs.readFileSync(referenceFile)) !== correction.reference.hash) throw Error('章节核对的独立原始页面证据缺失或已变化');
  }
  const stopped = () => options.signal?.aborted || options.shouldStop?.();
  const client = options.client || makeClient({cacheDir: path.join(stateDir, 'cache'), profileDir: browserProfile(stateDir, spec.sourceUrl), allowedHosts: spec.allowedHosts, delayMs: spec.delayMs, retries: spec.retries, timeoutMs: spec.timeoutMs, browser: spec.browser, signal: options.signal, shouldStop: stopped, onStatus: options.onStatus});
  const initialStats = {...client.stats}, started = Date.now();
  const failures = [], anchors = [], tail = [], {skipped, resolutions} = reviewer;
  let catalog = [], evidence, added = 0, paused = false, exportFile = null, reusedExport = false, quality = {issues: []}, nextBook = book, fetched = 0;
  async function readChapter(entry, links) {
    if (stopped()) throw Error('采集已暂停');
    const checkpoint = path.join(sourceDir, 'chapters', hash(entry.link) + '.json'), saved = readJson(checkpoint);
    if (saved && (saved.hash !== hash(saved.chapter) || saved.chapter.link !== entry.link || saved.chapter.chapter_number !== entry.chapter_number || saved.catalogTitle !== entry.title)) throw Error(`新来源检查点与目录不匹配：${entry.title}`);
    if (!saved && options.maxNew !== undefined && fetched >= options.maxNew) { paused = true; throw Error('本次采集数量已达上限'); }
    const value = saved?.chapter || await getChapter(spec, entry, links, client);
    if (!saved) { fetched++; atomicWrite(checkpoint, {hash: hash(value), chapter: value, catalogTitle: entry.title}); }
    const report = qualityReport([entry], [value], [], 'probe');
    if (report.issues.some(issue => issue.level !== 'info' && issue.code !== 'short-outlier')) throw Object.assign(Error(`新来源章节需核对「${entry.title}」：${report.issues.map(issue => issue.code).join('、')}`), {continuationConflict: true});
    return value;
  }
  async function chapter(entry, links) {
    try { return await readChapter(entry, links); }
    catch (error) {
      Object.assign(error, {chapter: entry.chapter_number, title: entry.title, link: entry.link, url: error.url || entry.link});
      throw error;
    }
  }
  try {
    options.onStatus?.({kind: 'continuation', message: switching ? '正在对齐新旧目录并核对末尾正文…' : '正在检查当前续更来源的新增目录…'});
    const source = await getCatalog(spec, client);
    catalog = preserveCatalogLabels(source.catalog, switching ? null : binding.catalog); evidence = source.evidence;
    const links = new Set(catalog.map(entry => entry.link)), oldNumbers = numbered(book.chapters), newNumbers = numbered(catalog);
    const last = oldNumbers.at(-1);
    if (!last || oldNumbers.length < 3) throw Error('本地书籍不足三个可核对的正文章节，无法自动确定换源衔接点');
    let boundary;
    if (switching) {
      const ending = oldNumbers.slice(-3);
      for (const [index, old] of ending.entries()) {
        if (index && old.number !== ending[index - 1].number + 1) {
          const gap = preservedReadingGap({stateDir, outputDir, file: selected.file, spec, book, catalog, previous: book.chapters[ending[index - 1].index], current: book.chapters[old.index], identity: chapterIdentity});
          if (!gap) throw Error('原书末尾正文章号不连续，需先核对缺章');
          resolutions.push(gap);
        }
        const matches = newNumbers.filter(item => {
          const part = policyPart(catalog[item.index].title, reviewState.partPolicy), previousPart = policyPart(book.chapters[old.index].title, reviewState.partPolicy);
          if (part && !previousPart) return reviewState.partPolicy?.kind === 'paired' && part.part === 1 && part.number === old.number && compatibleNames(part.name, old.name) && (boundary === undefined || item.index > boundary);
          return item.number === old.number && compatibleNames(item.name, old.name) && samePart(part, previousPart) && (boundary === undefined || item.index > boundary);
        });
        if (!matches.length || matches.length > 8) throw Error(`新来源无法对齐「${book.chapters[old.index].title}」，可能缺章、改名或拆合章`);
        const previous = book.chapters[old.index], oldBody = bodyKey(previous.content, previous.title);
        let actual, match, anchorReview, anchorParts;
        for (const candidate of matches) {
          const entry = catalog[candidate.index], pair = policyPart(entry.title, reviewState.partPolicy) && !policyPart(previous.title, reviewState.partPolicy);
          const entries = pair ? catalog.slice(candidate.index, candidate.index + 2) : [entry];
          if (pair && !completePair(entries)) continue;
          const values = [];
          for (const item of entries) values.push(await chapter(item, links));
          if (pair && !completePair(values)) continue;
          // Page headings must agree with the catalog's exact part and number.
          if (values.some((value, index) => chapterIdentity(value.title)?.number !== old.number || !samePart(chapterPartIdentity(value.title), chapterPartIdentity(entries[index].title)))) continue;
          const combined = values.map(value => bodyKey(value.content, value.title)).join('');
          const review = (reviewState.anchorDecisions || []).find(item => item.key === anchorReviewKey(book, selected.file, previous, pair ? values : values[0]));
          if (oldBody.length >= 100 && values.every(value => bodyKey(value.content, value.title).length >= 100) && oldBody === combined || review) {
            actual = values[0]; match = {...candidate, index: candidate.index + values.length - 1}; anchorReview = review; anchorParts = pair ? values : null; break;
          }
        }
        if (!actual) {
          const entry = catalog[matches[0].index];
          throw Object.assign(Error(`衔接正文不一致「${previous.title}」，旧书已保留，请核对版本差异`), {
            code: 'continuation-body-conflict', chapter: entry.chapter_number, title: entry.title, link: entry.link, url: entry.link,
            nextStep: '来源正文与本地末尾章节不完全一致，原书保留。可先跳过这本，将失败章节交给 Codex 核对具体文字或版本差异。',
          });
        }
        anchors.push({oldPosition: old.index + 1, sourcePosition: match.index + 1, oldLink: previous.link, newLink: actual.link, oldHash: hash(previous.content), newHash: hash(actual.content),
          ...(anchorParts ? {parts: anchorParts.map(reviewFingerprint)} : {}),
          ...(anchorReview ? {reviewKey: anchorReview.key, reason: anchorReview.reason, reviewedAt: anchorReview.reviewedAt} : {})});
        boundary = match.index;
      }
    } else {
      if (binding.catalog.some((entry, index) => !catalog[index] || entry.link !== catalog[index].link || entry.title !== catalog[index].title)) throw Error('已接续的新来源目录发生删除、插入或改名，暂停更新以保护旧章节');
      boundary = binding.catalog.length - 1;
    }
    const pending = catalog.slice(boundary + 1);
    const probeEndsWithUpper = reviewState.partPolicy?.kind === 'paired' && policyPart(pending[2]?.title, reviewState.partPolicy)?.part === 1;
    const targets = mode === 'probe' ? pending.slice(0, probeEndsWithUpper ? 4 : 3) : pending;
    atomicWrite(path.join(sourceDir, 'catalog.json'), catalog);
    options.onProgress?.({jobId: id, mode, downloaded: 0, total: targets.length, failed: 0});
    for (const entry of targets) {
      let loaded = false;
      try {
        const value = await chapter(entry, links);
        loaded = true;
        const next = {...formatChapterForExport(value), chapter_number: lastOrdinal + tail.length + 1, sourceChapterNumber: value.chapter_number, sourceChapterUrl: value.link, sourceBookUrl: spec.sourceUrl};
        if (reviewer.accept(entry, next)) tail.push(next);
      } catch (error) {
        // Transport/access and checkpoint failures must stop the batch. Only
        // complete source bodies with reviewable content conflicts may continue.
        if (paused || stopped() || (!loaded && !error.continuationConflict)) throw error;
        failures.push({chapter: entry.chapter_number, title: entry.title, link: entry.link, error: error.message, nextStep: options.stopOnFailure ? '本书已暂停，请核对完整正文；已有章节和原文件保留。' : '已保存完整正文可供核对，其他章节继续采集；全部冲突解决后才更新原书。'});
        if (options.stopOnFailure) break;
      }
      options.onProgress?.({jobId: id, mode, downloaded: tail.length + skipped.length, total: targets.length, failed: failures.length});
    }
    reviewer.finish();
    nextBook = {...book, chapters: [...book.chapters, ...tail]};
    Object.assign(nextBook, mergeBookCategory({...book, ...mergeBookCategory(book, spec)}, source.actual));
    // Preserve stable import identity, author mapping, cover and all old chapters.
    if (source.actual?.description) nextBook.description = source.actual.description;
    if (source.actual?.status && book.status !== '完结') nextBook.status = source.actual.status;
    quality = qualityReport(nextBook.chapters, nextBook.chapters, [], mode);
    const newIssues = quality.issues.filter(issue => issue.chapter > lastOrdinal);
    if (newIssues.some(issue => issue.level !== 'info' && issue.code !== 'short-outlier')) throw Error(`新增内容检查未通过：${newIssues.map(issue => `第 ${issue.chapter} 项 ${issue.code}`).join('；')}`);
    prepareImport(nextBook);
    if (stopped()) { paused = true; throw Error('采集已暂停'); }
    if (mode === 'download' && !failures.length) {
      if (hash(fs.readFileSync(file)) !== originalHash) throw Error('采集期间原书被其他程序修改，拒绝覆盖');
      const nextHash = hash(bytes(nextBook));
      const next = {version: 1, revision: (binding?.revision || 0) + 1, title: book.title, author: book.author, file: selected.file, outputPath: file, originalSourceUrl: book.sourceUrl,
        source: {url: spec.sourceUrl, title: spec.title, author: spec.author, variant: spec.variant || '', extraction}, count: nextBook.chapters.length, exportHash: nextHash, catalog: catalog.map(({title, link}) => ({title, link})),
        ...(!switching && binding?.completedSourceReview ? {completedSourceReview: binding.completedSourceReview} : {}),
        ...(!switching && binding?.ruleMigrations ? {ruleMigrations: binding.ruleMigrations} : {}),
        anchors: switching ? anchors : binding.anchors, skipped, resolutions: [...(binding?.resolutions || []), ...resolutions], previousSourceUrl: switching ? binding?.source.url || book.sourceUrl : binding.previousSourceUrl, updatedAt: new Date().toISOString()};
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
    if (!paused) failures.push(failureDetails(error, error.chapter ? {chapter: error.chapter, title: error.title, link: error.link} : {}));
  } finally { if (!options.client) await client.close(); }
  const acceptedSourceDefects = [...new Map([...(binding?.resolutions || []), ...resolutions].filter(d => d.kind === 'accepted-source-defect').map(d => [d.reviewKey, d])).values()];
  const preservedReadingGaps = [...new Map([...(binding?.resolutions || []), ...resolutions].filter(d => ['preserved-reading-gap', 'reviewed-source-gap'].includes(d.kind)).flatMap(d => d.gaps).map(g => [g.link, g])).values()];
  const issues = [...quality.issues.filter(issue => issue.chapter > lastOrdinal), ...acceptedSourceDefects.map(d => ({level: 'warning', code: 'accepted-source-defect', chapter: d.acceptedPosition, link: d.link, reviewKey: d.reviewKey, detail: d.reason})), ...preservedReadingGaps.map(g => ({level: 'warning', code: 'preserved-reading-gap', link: g.link, detail: `${g.title}：既有缺文仍保留记录，未补齐。`}))];
  const errors = failures.length + issues.filter(issue => issue.level === 'error').length;
  const result = {title: book.title, author: book.author, sourceUrl: spec.sourceUrl, originalSourceUrl: book.sourceUrl, mode, jobId: id, continuation: true, switching,
    expected: exportFile ? nextBook.chapters.length : book.chapters.length + tail.length, downloaded: exportFile ? nextBook.chapters.length : book.chapters.length,
    originalCount: book.chapters.length, sourceExpected: catalog.length, continuationAdded: added, checkedNew: tail.length, anchors, skipped, resolutions, acceptedSourceDefects, sourceGaps: preservedReadingGaps, automaticResolutions: resolutions.filter(r => !['accepted-source-defect', 'preserved-reading-gap', 'reviewed-source-gap'].includes(r.kind)).length, evidence, issues, failures,
    errors, warnings: issues.filter(issue => issue.level === 'warning').length, information: issues.filter(issue => issue.level === 'info').length,
    structuralPass: !errors && !paused, completeAgainstSource: !!exportFile && !preservedReadingGaps.length, completeSelectedScope: !!exportFile, paused, exportFile, reusedExport, description: nextBook.description, status: nextBook.status,
    checkedAt: new Date().toISOString(), elapsedMs: Date.now() - started, requests: Object.fromEntries(Object.entries(client.stats).map(([key, value]) => [key, value - initialStats[key]])),
    limitation: '保留原书全部条目及稳定导入来源。完整正文一致、同章号且标题对应的章节或同名公告可自动去重；目录编号有误而正文页编号连续时沿用正文页标题并记录证据。不同正文只沿用已核对且两边哈希完全匹配的版本选择，不按相似度自动择优。未解决的冲突保留全部已取得正文并阻止更新原书，其他章节继续采集。未重采或核对新站全部旧正文。'};
  result.reportFile = path.join(sourceDir, `${mode}-report.json`);
  result.summaryFile = path.join(sourceDir, `${mode}-report.md`);
  atomicWrite(result.reportFile, result);
  atomicWrite(result.summaryFile, `# 换源续更报告\n\n原有 ${result.originalCount} 项；本次追加 ${added} 项；衔接核对 ${anchors.length} 章；本次自动核对处理 ${result.automaticResolutions} 项；已接受的来源缺陷 ${acceptedSourceDefects.length} 项，仍作为警告保留。\n\n${result.limitation}\n\n${resolutions.map(item => `${item.title}：${item.reason}（${item.link}）`).join('\n\n')}\n\n${acceptedSourceDefects.map(item => `已接受来源缺陷：${item.title}，${item.reason}（${item.link}）`).join('\n\n')}\n\n${preservedReadingGaps.map(g => `缺口未补齐：${g.title}，${g.reason}（${g.link}）`).join('\n\n')}\n\n${failures.map(item => item.error).join('\n\n')}\n`);
  return result;
}
