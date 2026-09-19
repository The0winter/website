import fs from 'node:fs';
import path from 'node:path';
import {atomicWrite, readJson, hash} from './storage.mjs';
import {checkIdentity, qualityReport, normalizedTitle, placeholderEvidence} from './quality.mjs';
import {formatChapterForExport} from './titles.mjs';
import {chapterIdentity} from './continuation.mjs';
import {prepareImport} from '../../infra/import-plan.mjs';

// A local, explicitly reviewed edition is bound to one extraction job. Source
// checkpoints remain intact; their positions must never become reading ordinals.
const stateFile = dir => path.join(dir, 'reading-edition.json');
const pendingFile = dir => path.join(dir, 'reading-edition-pending.json');
const bytes = value => JSON.stringify(value, null, 2) + '\n';
const seal = value => ({hash: hash(value), value});
function checked(file) {
  const data = readJson(file);
  if (!data?.value || data.hash !== hash(data.value)) throw Error('阅读版来源映射缺失或损坏，已保留原文件');
  return data.value;
}
export const hasReadingEdition = dir => fs.existsSync(stateFile(dir)) || fs.existsSync(pendingFile(dir));

function outputPath(state, outputDir) {
  if (typeof state.file !== 'string' || !state.file.endsWith('.json') || /[<>:"/\\|?*\x00-\x1f]/u.test(state.file) || /[. ]$/u.test(state.file)) throw Error('阅读版文件名无效');
  const file = path.resolve(outputDir, state.file);
  if (file !== state.outputPath) throw Error('阅读版输出目录发生变化，请先核对绑定，旧文件已保留');
  return file;
}
function checkState(state, spec, extraction, outputDir) {
  if (state.version !== 1 || state.extractionHash !== extraction || state.identity.sourceUrl !== spec.sourceUrl || state.identity.variant !== (spec.variant || '')) throw Error('阅读版绑定与当前来源规则不匹配');
  checkIdentity(spec, state.identity);
  if (!state.sources?.length || !state.book?.chapters?.length || hash(bytes(state.book)) !== state.exportHash) throw Error('阅读版来源映射内容不完整');
  checkIdentity(spec, state.book);
  if (state.book.sourceUrl !== spec.sourceUrl) throw Error('阅读版作品来源不匹配');
  return outputPath(state, outputDir);
}
function fileHash(file) { return fs.existsSync(file) ? hash(fs.readFileSync(file)) : null; }
function assertOutput(state, file) {
  const current = fileHash(file);
  if (current && current !== state.exportHash) throw Error(`阅读版文件被其他程序修改，拒绝覆盖：${file}`);
}

// Called under the crawler's job lock. The journal makes a file/state pair
// recoverable after interruption, without accepting an unrelated edited output.
function recover(dir, state, spec, extraction, outputDir) {
  if (!fs.existsSync(pendingFile(dir))) return state;
  const pending = checked(pendingFile(dir)), next = pending.next;
  const file = checkState(next, spec, extraction, outputDir);
  if (![pending.previousStateHash, hash(next)].includes(hash(state))) throw Error('阅读版更新记录与当前映射冲突');
  const current = fileHash(file);
  if (current && ![state.exportHash, next.exportHash].includes(current)) throw Error('阅读版更新期间文件被修改，拒绝覆盖');
  if (current !== next.exportHash) atomicWrite(file, next.book);
  atomicWrite(stateFile(dir), seal(next));
  fs.unlinkSync(pendingFile(dir));
  return next;
}

export function loadReadingEdition(dir, spec, extraction, outputDir, {resume = false} = {}) {
  if (!hasReadingEdition(dir)) {
    // A variant change creates a new raw job, but must not silently abandon a
    // book's reviewed edition and return to exporting the repeated source.
    const jobs = path.dirname(dir);
    for (const name of fs.existsSync(jobs) ? fs.readdirSync(jobs) : []) {
      const otherDir = path.join(jobs, name);
      if (otherDir === dir || !/^[a-f0-9]{20}$/u.test(name) || !hasReadingEdition(otherDir)) continue;
      const other = readJson(path.join(otherDir, 'spec.json'));
      if (other?.sourceUrl === spec.sourceUrl && ['title', 'author'].every(key => normalizedTitle(other[key]) === normalizedTitle(spec[key]))) throw Error('这本书已有另一版本规则的阅读版绑定，请先核对迁移；旧映射和阅读版保留');
    }
    return null;
  }
  let state = checked(stateFile(dir));
  checkState(state, spec, extraction, outputDir);
  if (resume) state = recover(dir, state, spec, extraction, outputDir);
  else if (fs.existsSync(pendingFile(dir))) throw Error('上次阅读版更新尚未完成，请继续采集以恢复');
  assertOutput(state, outputPath(state, outputDir));
  return state;
}

function rawChapter(dir, entry) {
  const saved = readJson(path.join(dir, 'chapters', hash(entry.link) + '.json'));
  if (!saved?.chapter || saved.hash !== hash(saved.chapter) || saved.chapter.link !== entry.link || saved.chapter.chapter_number !== entry.chapter_number) throw Error(`来源第 ${entry.chapter_number} 项检查点缺失或损坏`);
  return saved.chapter;
}
function fingerprint(entry, chapter) {
  return {position: entry.chapter_number, link: entry.link, catalogTitle: entry.title, title: chapter.title, contentHash: hash(chapter.content)};
}
export function verifyReadingSources(dir, state, catalog) {
  for (const [i, accepted] of state.sources.entries()) {
    const entry = catalog[i];
    if (!entry || hash(fingerprint(entry, rawChapter(dir, entry))) !== hash(accepted)) throw Error(`已确认的来源第 ${i + 1} 项发生变化，暂停阅读版更新`);
  }
}

// Explicitly reviewed unnumbered notices are pinned to the complete source
// text, not just a permissive title pattern. Recording does not change the book.
export function recordReadingNoticeReview(dir, spec, extraction, outputDir, {link, contentHash, reason}) {
  const state = loadReadingEdition(dir, spec, extraction, outputDir);
  if (!state || typeof reason !== 'string' || !reason.trim()) throw Error('公告核对需要已有阅读版及具体理由');
  const catalog = readJson(path.join(dir, 'catalog.json'), []), entry = catalog.find(item => item.link === link);
  if (!entry || entry.chapter_number <= state.sources.length) throw Error('只能核对尚未纳入阅读版的新公告');
  const chapter = rawChapter(dir, entry);
  if (chapterIdentity(chapter.title) || /^\s*[0-9]+[、.]/u.test(chapter.title) || hash(chapter.content) !== contentHash) throw Error('公告正文哈希已变化或标题含正文章号');
  const quality = qualityReport([entry], [chapter], [], 'probe');
  if (quality.issues.some(issue => issue.level !== 'info' && issue.code !== 'short-outlier')) throw Error('公告正文未通过质量检查');
  const review = {link, title: chapter.title, contentHash, reason: reason.trim(), evidence: chapter.provenance, reviewedAt: new Date().toISOString()};
  atomicWrite(stateFile(dir), seal({...state, noticeReviews: [...(state.noticeReviews || []).filter(item => item.link !== link), review]}));
  return review;
}

function orderedChapters(chapters, reviewedPrefix = 0, noticeReviews = []) {
  let number = 0;
  for (const [index, chapter] of chapters.entries()) {
    if (chapter.chapter_number !== index + 1) throw Error('阅读版顺序号不连续');
    const title = chapter.title.normalize('NFKC').trim();
    const match = /^([0-9]+)[、.]/u.exec(title);
    const current = chapterIdentity(title)?.number ?? (match ? Number(match[1]) : null);
    if (index < reviewedPrefix) { if (current !== null) number = current; continue; }
    if (current !== null) {
      if (!Number.isSafeInteger(current) || current !== number + 1) throw Error(`阅读版章号不连续：应为第 ${number + 1} 章，实际为“${chapter.title}”`);
      number = current;
    } else if (!/^(?:番外|IF番外|(?:[一二三四五六七八九十0-9]+月)?总结|请假|公告|通知|活动|感言|后记|月票)/iu.test(title) &&
      !noticeReviews.some(review => review.link === chapter.link && review.title === chapter.title && review.contentHash === hash(chapter.content))) {
      throw Error(`未识别的番外或公告标题，需要核对：“${chapter.title}”`);
    }
  }
  if (!number) throw Error('阅读版未找到连续正文章号');
  return number;
}
const editionQuality = (book, mode = 'download') => qualityReport(book.chapters, book.chapters, [], mode);
function checkNewIssues(report, after = 0) {
  const blocking = report.issues.filter(issue => issue.level === 'error' || (issue.chapter > after && issue.level === 'warning' && issue.code !== 'short-outlier'));
  if (blocking.length) throw Error(`阅读版需要核对：${blocking.slice(0, 5).map(i => `第 ${i.chapter} 项 ${i.code}`).join('；')}`);
}

function verifySourceOrderReview(review, catalog, raw, book, seen) {
  if (!review || review.catalogHash !== hash(catalog) || !Array.isArray(review.pairs) || (review.gaps !== undefined && !Array.isArray(review.gaps)) || !(review.pairs.length || review.gaps?.length) || typeof review.reason !== 'string' || !review.reason.trim()) throw Error('来源顺序验收需要目录哈希、逐项重复或缺文核对和具体理由');
  let previous = 0;
  for (const [index, chapter] of book.chapters.entries()) {
    if (chapter.chapter_number !== index + 1) throw Error('阅读版顺序号不连续');
    if (chapter.sourceChapterNumber <= previous) throw Error('来源顺序验收不能重排章节');
    previous = chapter.sourceChapterNumber;
  }
  const issues = qualityReport(catalog, raw, [], 'download').issues;
  const omissions = new Set();
  for (const pair of review.pairs) {
    const omit = raw[pair.omit - 1], keep = raw[pair.keep - 1];
    if (!Number.isInteger(pair.omit) || !Number.isInteger(pair.keep) || !omit || !keep || seen.has(omit.link) || !seen.has(keep.link) || omissions.has(omit.link) || pair.omitHash !== hash(omit.content) || pair.keepHash !== hash(keep.content) || typeof pair.reason !== 'string' || !pair.reason.trim()) throw Error('重复项核对与保留章节、正文哈希不匹配');
    if (!issues.some(i => ['duplicate-body', 'duplicate-title-body'].includes(i.code) && ((i.chapter === pair.omit && i.otherChapter === pair.keep) || (i.chapter === pair.keep && i.otherChapter === pair.omit)))) throw Error('不能将未检测为重复的正文从阅读版排除');
    omissions.add(omit.link);
  }
  for (const gap of review.gaps || []) {
    const chapter = raw[gap.position - 1];
    if (!Number.isInteger(gap.position) || !chapter || seen.has(chapter.link) || omissions.has(chapter.link) || gap.link !== chapter.link || gap.contentHash !== hash(chapter.content) || typeof gap.reason !== 'string' || !gap.reason.trim()) throw Error('缺文核对与来源位置、链接及正文哈希不匹配');
    if (!gap.evidence || !/^https?:\/\//u.test(gap.evidence.url || '') || !Number.isFinite(Date.parse(gap.evidence.checkedAt)) || typeof gap.evidence.detail !== 'string' || !gap.evidence.detail.trim()) throw Error('缺文核对必须保存独立证据地址、时间和说明');
    if (gap.kind === 'placeholder') {
      if (!placeholderEvidence(chapter.content)) throw Error('缺文提示验收不能排除普通正文');
    } else if (gap.kind === 'truncated') {
      const actual = chapter.content.replace(/\s/gu, '').length;
      if (gap.actualCharacters !== actual || !Number.isInteger(gap.expectedCharacters) || gap.expectedCharacters < 1000 || gap.expectedCharacters > 60000 || actual >= gap.expectedCharacters * 0.8) throw Error('残缺章节验收需要显著缺文的实际字数和独立预期字数');
    } else throw Error('未支持的缺文章节验收类型');
    omissions.add(chapter.link);
  }
  if (review.titleMappings !== undefined && !Array.isArray(review.titleMappings)) throw Error('标题差异验收必须是逐项记录');
  const mapped = new Set();
  for (const item of review.titleMappings || []) {
    const chapter = raw[item.position - 1];
    if (!Number.isInteger(item.position) || !chapter || !seen.has(chapter.link) || mapped.has(item.position) || item.link !== chapter.link || item.contentHash !== hash(chapter.content) || item.title !== chapter.title || item.catalogTitle !== chapter.catalogTitle || typeof item.reason !== 'string' || !item.reason.trim()) throw Error('标题差异核对与保留章节、标题及正文哈希不匹配');
    if (!item.evidence || !/^https?:\/\//u.test(item.evidence.url || '') || !Number.isFinite(Date.parse(item.evidence.checkedAt)) || typeof item.evidence.detail !== 'string' || !item.evidence.detail.trim() || !issues.some(i => i.code === 'title-mismatch' && i.chapter === item.position)) throw Error('标题差异验收需要已检测的差异和独立核对证据');
    mapped.add(item.position);
  }
  if (raw.some(c => !seen.has(c.link) && !omissions.has(c.link))) throw Error('来源顺序验收不得遗漏未核对的目录项');
  return {...review, reviewedAt: new Date().toISOString()};
}

export function adoptReadingEdition(dir, spec, extraction, file, outputDir, sourceOrderReview) {
  if (hasReadingEdition(dir)) throw Error('这本书已绑定阅读版，不能重新覆盖来源映射');
  const report = readJson(path.join(dir, 'download-report.json'));
  const catalog = readJson(path.join(dir, 'catalog.json'));
  if (!report?.completeAgainstSource || !catalog?.length || report.expected !== catalog.length || report.failures?.length) throw Error('绑定前须完整采集原始来源并保留检查点');
  const book = readJson(file);
  if (!book?.chapters?.length) throw Error('阅读版文件为空');
  checkIdentity(spec, book);
  if (book.sourceUrl !== spec.sourceUrl) throw Error('阅读版来源地址不匹配');
  const raw = catalog.map(entry => rawChapter(dir, entry));
  const byLink = new Map(raw.map(chapter => [chapter.link, chapter]));
  const seen = new Set();
  for (const chapter of book.chapters) {
    const source = byLink.get(chapter.link);
    const expected = source && {...formatChapterForExport(source), chapter_number: chapter.chapter_number, sourceChapterNumber: source.chapter_number, sourceChapterUrl: source.link};
    // Compare the entire selected chapter, not merely the body, so an adopted
    // artifact cannot smuggle altered titles, provenance or unrelated fields.
    if (!source || seen.has(chapter.link) || hash(chapter) !== hash(expected)) throw Error(`阅读版第 ${chapter.chapter_number} 项与来源检查点不匹配`);
    seen.add(chapter.link);
  }
  let acceptedSourceOrder;
  if (sourceOrderReview) acceptedSourceOrder = verifySourceOrderReview(sourceOrderReview, catalog, raw, book, seen);
  else orderedChapters(book.chapters);
  const quality = editionQuality(book);
  const reviewedTitles = new Set(acceptedSourceOrder?.titleMappings?.map(item => item.position) || []);
  checkNewIssues({...quality, issues: quality.issues.filter(issue => issue.code !== 'title-mismatch' || !reviewedTitles.has(book.chapters[issue.chapter - 1]?.sourceChapterNumber))});
  prepareImport(book);
  const state = {
    version: 1, revision: 1, identity: {title: spec.title, author: spec.author, sourceUrl: spec.sourceUrl, variant: spec.variant || ''},
    extractionHash: extraction, file: path.basename(file), outputPath: path.resolve(file),
    sources: catalog.map((entry, i) => fingerprint(entry, raw[i])), book,
    ...(acceptedSourceOrder ? {sourceOrderReview: acceptedSourceOrder} : {}),
    exportHash: hash(bytes(book)), updatedAt: new Date().toISOString(),
  };
  checkState(state, spec, extraction, outputDir);
  // Adoption is read-only for the reviewed artifact, including its formatting.
  if (fileHash(file) !== state.exportHash) throw Error('阅读版 JSON 格式与自动导出格式不同，请先核对文件');
  atomicWrite(stateFile(dir), seal(state));
  return {bindingFile: stateFile(dir), exportFile: state.outputPath, sourceEntries: state.sources.length, readingEntries: book.chapters.length};
}

export function updateReadingEdition({dir, state, spec, extraction, outputDir, catalog, rawReport}) {
  const originalCount = state.book.chapters.length;
  let book = state.book, reusedExport = false, exportFile = null, added = 0, failure, checkedQuality;
  try {
    checkState(state, spec, extraction, outputDir);
    assertOutput(state, outputPath(state, outputDir));
    if (rawReport.failures.length) throw Error(rawReport.failures[0].error);
    verifyReadingSources(dir, state, catalog);
    // Only historical, fingerprint-pinned problems may be excluded. Newly
    // collected problems must stop even if their duplicate is in a discarded block.
    const unreviewed = rawReport.issues.filter(issue => !issue.chapter || issue.chapter > state.sources.length);
    checkNewIssues({issues: unreviewed});
    if (!rawReport.paused && rawReport.mode === 'download' && rawReport.completeAgainstSource) {
      const tail = catalog.slice(state.sources.length).map(entry => rawChapter(dir, entry));
      const chapters = [...book.chapters, ...tail.map((chapter, index) => ({...formatChapterForExport(chapter), chapter_number: originalCount + index + 1, sourceChapterNumber: chapter.chapter_number, sourceChapterUrl: chapter.link}))];
      orderedChapters(chapters, state.sourceOrderReview ? originalCount : 0, state.noticeReviews);
      const nextBook = {...book, ...Object.fromEntries(['description', 'status', 'category', 'cover_image', 'authorSourceUrl'].filter(key => spec[key] !== undefined).map(key => [key, spec[key]])), chapters};
      const nextQuality = editionQuality(nextBook);
      checkNewIssues(nextQuality, originalCount);
      prepareImport(nextBook);
      const file = outputPath(state, outputDir), nextHash = hash(bytes(nextBook));
      reusedExport = fileHash(file) === nextHash;
      if (nextHash !== state.exportHash || tail.length || !reusedExport) {
        const next = {...state, revision: state.revision + 1, sources: [...state.sources, ...tail.map((chapter, i) => fingerprint(catalog[state.sources.length + i], chapter))], book: nextBook, exportHash: nextHash, updatedAt: new Date().toISOString()};
        atomicWrite(pendingFile(dir), seal({previousStateHash: hash(state), next}));
        recover(dir, state, spec, extraction, outputDir);
      }
      book = nextBook; checkedQuality = nextQuality; added = tail.length; exportFile = file;
    }
  } catch (error) { failure = {error: error.message, nextStep: '保留当前阅读版，核对报告中的新增条目或来源映射后再继续。'}; }
  const quality = checkedQuality || editionQuality(book, rawReport.mode);
  if (failure) { quality.failures.push(failure); quality.errors++; quality.structuralPass = false; }
  return {...rawReport, ...quality, readingEdition: true, sourceExpected: rawReport.expected, sourceDownloaded: rawReport.downloaded, sourceErrors: rawReport.errors, sourceWarnings: rawReport.warnings,
    ...(state.sourceOrderReview ? {acceptedSourceOrder: state.sourceOrderReview} : {}),
    completeAgainstSource: !!exportFile && !state.sourceOrderReview?.gaps?.length, completeSelectedScope: !!exportFile, sourceGaps: state.sourceOrderReview?.gaps || [], exportFile, reusedExport, readingAdded: added,
    mappingFile: stateFile(dir), mapping: book.chapters.map(c => ({chapter_number: c.chapter_number, title: c.title, sourcePosition: c.sourceChapterNumber, sourceUrl: c.link, sourceHash: hash(c.content)})),
    limitation: '沿用这本书已核对的来源映射，阅读版章序保持稳定。新发现的重复、乱码、章号跳转会暂停更新，旧阅读版和原始采集记录保留。只检查可检测异常，不能保证源站无删文或错配。',
  };
}
