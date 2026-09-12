import fs from 'node:fs';
import path from 'node:path';
import {atomicWrite, readJson, hash} from './storage.mjs';
import {checkIdentity, qualityReport, normalizedTitle} from './quality.mjs';
import {formatChapterForExport} from './titles.mjs';
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

function orderedChapters(chapters) {
  let number = 0;
  for (const [index, chapter] of chapters.entries()) {
    if (chapter.chapter_number !== index + 1) throw Error('阅读版顺序号不连续');
    const title = chapter.title.normalize('NFKC').trim();
    const match = /^第([0-9]+)章/u.exec(title);
    if (match) {
      const current = Number(match[1]);
      if (!Number.isSafeInteger(current) || current !== number + 1) throw Error(`阅读版章号不连续：应为第 ${number + 1} 章，实际为“${chapter.title}”`);
      number = current;
    } else if (!/^(?:番外|IF番外|(?:[一二三四五六七八九十0-9]+月)?总结|请假|公告|通知|活动|感言|后记|月票)/iu.test(title)) {
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

export function adoptReadingEdition(dir, spec, extraction, file, outputDir) {
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
  orderedChapters(book.chapters);
  checkNewIssues(editionQuality(book));
  prepareImport(book);
  const state = {
    version: 1, revision: 1, identity: {title: spec.title, author: spec.author, sourceUrl: spec.sourceUrl, variant: spec.variant || ''},
    extractionHash: extraction, file: path.basename(file), outputPath: path.resolve(file),
    sources: catalog.map((entry, i) => fingerprint(entry, raw[i])), book,
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
  let book = state.book, reusedExport = false, exportFile = null, added = 0, failure;
  try {
    checkState(state, spec, extraction, outputDir);
    assertOutput(state, outputPath(state, outputDir));
    verifyReadingSources(dir, state, catalog);
    if (rawReport.failures.length) throw Error(rawReport.failures[0].error);
    // Only historical, fingerprint-pinned problems may be excluded. Newly
    // collected problems must stop even if their duplicate is in a discarded block.
    const unreviewed = rawReport.issues.filter(issue => !issue.chapter || issue.chapter > state.sources.length);
    checkNewIssues({issues: unreviewed});
    if (!rawReport.paused && rawReport.mode === 'download' && rawReport.completeAgainstSource) {
      const tail = catalog.slice(state.sources.length).map(entry => rawChapter(dir, entry));
      const chapters = [...book.chapters, ...tail.map((chapter, index) => ({...formatChapterForExport(chapter), chapter_number: originalCount + index + 1, sourceChapterNumber: chapter.chapter_number, sourceChapterUrl: chapter.link}))];
      orderedChapters(chapters);
      const nextBook = {...book, ...Object.fromEntries(['description', 'status', 'category', 'cover_image', 'authorSourceUrl'].filter(key => spec[key] !== undefined).map(key => [key, spec[key]])), chapters};
      checkNewIssues(editionQuality(nextBook), originalCount);
      prepareImport(nextBook);
      const file = outputPath(state, outputDir), nextHash = hash(bytes(nextBook));
      reusedExport = fileHash(file) === nextHash;
      if (nextHash !== state.exportHash || tail.length || !reusedExport) {
        const next = {...state, revision: state.revision + 1, sources: [...state.sources, ...tail.map((chapter, i) => fingerprint(catalog[state.sources.length + i], chapter))], book: nextBook, exportHash: nextHash, updatedAt: new Date().toISOString()};
        atomicWrite(pendingFile(dir), seal({previousStateHash: hash(state), next}));
        recover(dir, state, spec, extraction, outputDir);
      }
      book = nextBook; added = tail.length; exportFile = file;
    }
  } catch (error) { failure = {error: error.message, nextStep: '保留当前阅读版，核对报告中的新增条目或来源映射后再继续。'}; }
  const quality = editionQuality(book, rawReport.mode);
  if (failure) { quality.failures.push(failure); quality.errors++; quality.structuralPass = false; }
  return {...rawReport, ...quality, readingEdition: true, sourceExpected: rawReport.expected, sourceDownloaded: rawReport.downloaded, sourceErrors: rawReport.errors, sourceWarnings: rawReport.warnings,
    completeAgainstSource: !!exportFile, exportFile, reusedExport, readingAdded: added,
    mappingFile: stateFile(dir), mapping: book.chapters.map(c => ({chapter_number: c.chapter_number, title: c.title, sourcePosition: c.sourceChapterNumber, sourceUrl: c.link, sourceHash: hash(c.content)})),
    limitation: '沿用这本书已核对的来源映射，阅读版章序保持稳定。新发现的重复、乱码、章号跳转会暂停更新，旧阅读版和原始采集记录保留。只检查可检测异常，不能保证源站无删文或错配。',
  };
}
