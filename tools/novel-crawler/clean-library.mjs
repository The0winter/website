import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {cleanBookForReading, readingCleanupVersion} from '../../shared/reading-cleanup.mjs';
import {atomicWrite, hash, readJson, withLock} from './storage.mjs';
import {continuationKey} from './continuation.mjs';
import snapshots from '../storage-snapshots.cjs';

const serialize = value => JSON.stringify(value, null, 2) + '\n';
const seal = value => ({value, hash: hash(value)});
function checked(file) {
  const record = readJson(file);
  if (!record?.value || record.hash !== hash(record.value)) throw Error('清理期间遇到损坏的书库状态：' + file);
  return record.value;
}
function inside(root, file) {
  const rel = path.relative(root, file);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw Error('清理文件必须位于项目目录内');
  return rel.replaceAll('\\', '/');
}

export function previewBookCleaning(book) {
  const next = cleanBookForReading(book), changes = [], warnings = [];
  for (let i = 0; i < book.chapters.length; i++) {
    const before = book.chapters[i], after = next.chapters[i];
    if (before.title !== after.title || before.chapter_number !== after.chapter_number || before.link !== after.link) throw Error('清理不得改变章节身份或顺序');
    if (after.readingCleanupWarnings?.length) warnings.push({number: before.chapter_number, title: before.title, issues: after.readingCleanupWarnings});
    if (before.content !== after.content || before.volume_title !== after.volume_title || before.volume_number !== after.volume_number) {
      changes.push({number: before.chapter_number, title: before.title, link: before.link || before.sourceUrl,
        beforeHash: hash(before.content), afterHash: hash(after.content),
        beforeVolume: {volume_title: before.volume_title, volume_number: before.volume_number},
        afterVolume: {volume_title: after.volume_title, volume_number: after.volume_number},
        reasons: before.content !== after.content ? [...new Set(after.readingCleanup.changes.slice(before.readingCleanup?.changes?.length || 0).map(c => c.reason))] : ['volume'],
        removedCharacters: before.content.length - after.content.length});
    }
  }
  if (hash(next) !== hash(cleanBookForReading(next))) throw Error('清理不满足重复执行无变化，已停止');
  return {book: next, changes, warnings};
}

// Combine successive verified passes, keeping the original online baseline.
// A changed intermediate body/volume must match the preceding pass exactly.
export function mergeCleaningReports(first, last) {
  if (first.file !== last.file || first.title !== last.title || first.sourceUrl !== last.sourceUrl || first.afterHash !== last.beforeHash) throw Error('清理记录不是连续的同一本书');
  const merged = new Map(first.changes.map(c => [c.number, c]));
  for (const change of last.changes) {
    const previous = merged.get(change.number);
    if (previous && (previous.afterHash !== change.beforeHash || JSON.stringify(previous.afterVolume) !== JSON.stringify(change.beforeVolume))) throw Error('章节清理记录不连续');
    merged.set(change.number, previous ? {...change, beforeHash: previous.beforeHash, beforeVolume: previous.beforeVolume,
      reasons: [...new Set([...previous.reasons, ...change.reasons])], removedCharacters: previous.removedCharacters + change.removedCharacters} : change);
  }
  return {...last, beforeHash: first.beforeHash, changes: [...merged.values()].sort((a,b)=>a.number-b.number),
    snapshots: [...(first.snapshots || (first.snapshot ? [first.snapshot] : [])), ...(last.snapshots || (last.snapshot ? [last.snapshot] : []))]};
}

// The checksummed journal recovers file/state changes after a crash. Recovery
// accepts only exact old/new bytes; an unrelated external edit is never adopted.
export function recoverBookCleaning({root, journal}) {
  if (!fs.existsSync(journal)) return null;
  const value = checked(journal);
  for (const edit of value.edits) {
    const file = path.resolve(root, edit.path); inside(root, file);
    const current = hash(fs.readFileSync(file));
    if (![edit.beforeHash, hash(edit.bytes)].includes(current)) throw Error('恢复清理时文件被其他程序修改：' + edit.path);
  }
  for (const edit of value.edits) {
    const file = path.resolve(root, edit.path);
    if (hash(fs.readFileSync(file)) !== hash(edit.bytes)) atomicWrite(file, edit.bytes);
  }
  for (const edit of value.edits) if (hash(fs.readFileSync(path.resolve(root, edit.path))) !== hash(edit.bytes)) throw Error('清理写回校验失败');
  snapshots.accept(root, value.snapshot.id);
  atomicWrite(path.join(path.dirname(journal), 'last-completed.json'), {...value.summary, snapshot: value.snapshot, completedAt: new Date().toISOString()});
  fs.unlinkSync(journal);
  return value.summary;
}

export async function cleanLocalBook({root, stateDir, outputDir, file, apply = false, failAfterJournal = false}) {
  root = path.resolve(root); stateDir = path.resolve(stateDir); outputDir = path.resolve(outputDir);
  if (path.basename(file) !== file || !file.endsWith('.json')) throw Error('书库文件名无效');
  const filename = path.join(outputDir, file); inside(root, filename);
  let input = readJson(filename); const key = continuationKey(input);
  return withLock(path.join(stateDir, 'book-locks', key + '.lock'), async () => {
    const journal = path.join(stateDir, 'cleaning', key, 'pending.json');
    if (fs.existsSync(journal)) {
      if (!apply) throw Error('上次清理中断，须先恢复');
      return {...recoverBookCleaning({root, journal}), recovered: true};
    }
    const bytes = fs.readFileSync(filename), beforeHash = hash(bytes); input = JSON.parse(bytes.toString('utf8').replace(/^\ufeff/u, ''));
    const preview = previewBookCleaning(input);
    const summary = {file, title: input.title, author: input.author, sourceUrl: input.sourceUrl, version: readingCleanupVersion,
      beforeHash, afterHash: preview.changes.length ? hash(serialize(preview.book)) : beforeHash,
      chapters: input.chapters.length, changes: preview.changes, warnings: preview.warnings, apply};
    if (!preview.changes.length || !apply) return summary;
    const edits = [{path: inside(root, filename), beforeHash, bytes: serialize(preview.book)}];
    const add = (p, value) => edits.push({path: inside(root, p), beforeHash: hash(fs.readFileSync(p)), bytes: serialize(value)});
    const jobs = path.join(stateDir, 'jobs');
    for (const id of fs.existsSync(jobs) ? fs.readdirSync(jobs) : []) {
      if (!/^[a-f0-9]{20}$/u.test(id)) continue;
      const dir = path.join(jobs, id), spec = readJson(path.join(dir, 'spec.json'));
      if (!spec?.title || !spec.author || continuationKey(spec) !== key) continue;
      if (fs.existsSync(path.join(dir, 'job.lock')) || fs.existsSync(path.join(dir, 'reading-edition-pending.json'))) throw Error('相关采集任务正在运行或有待恢复的阅读版');
      const p = path.join(dir, 'export.json'), record = readJson(p);
      if (record?.path === filename && record.hash === beforeHash) add(p, {...record, hash: summary.afterHash});
      const readingFile = path.join(dir, 'reading-edition.json');
      if (fs.existsSync(readingFile)) {
        const state = checked(readingFile);
        if (state.outputPath === filename && state.exportHash === beforeHash) {
          if (hash(serialize(state.book)) !== beforeHash) throw Error('阅读版原文与导出不一致');
          add(readingFile, seal({...state, book: preview.book, exportHash: summary.afterHash, revision: state.revision + 1,
            cleaningVersion: readingCleanupVersion, updatedAt: new Date().toISOString()}));
        }
      }
    }
    const bindingDir = path.join(stateDir, 'continuations', key), bindingFile = path.join(bindingDir, 'binding.json');
    if (fs.existsSync(path.join(bindingDir, 'pending.json'))) throw Error('续更尚未恢复完成，已保留原书');
    if (fs.existsSync(bindingFile)) {
      const binding = checked(bindingFile);
      if (binding.outputPath !== filename || binding.exportHash !== beforeHash) throw Error('续更绑定与当前文件不一致');
      add(bindingFile, seal({...binding, exportHash: summary.afterHash, revision: binding.revision + 1, cleaningVersion: readingCleanupVersion, updatedAt: new Date().toISOString()}));
    }
    const snapshot = snapshots.create(root, {files: edits.map(e => e.path), group: 'reading-cleanup-' + key, pinned: true});
    for (const edit of edits) if (hash(fs.readFileSync(path.resolve(root, edit.path))) !== edit.beforeHash) throw Error('备份期间文件发生变化，已保留原书');
    atomicWrite(journal, seal({version: 1, edits, snapshot, summary}));
    if (failAfterJournal) throw Error('injected interruption');
    recoverBookCleaning({root, journal});
    return {...summary, snapshot};
  });
}

export async function main(args = process.argv.slice(2)) {
  const options = Object.fromEntries(args.filter(a => a.startsWith('--') && a.includes('=')).map(a => a.slice(2).split(/=(.*)/su).slice(0,2)));
  if (args.some(a => a !== '--apply' && !/^--(?:inventory|report-dir|file|limit)=/u.test(a))) throw Error('用法：node tools/novel-crawler/clean-library.mjs --inventory=书库列表.json --report-dir=任务目录 [--file=书库文件名] [--limit=10] [--apply]');
  if (!options.inventory || !options['report-dir']) throw Error('需要 inventory 和 report-dir');
  const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url))), stateDir = path.join(root, '.novel-crawler'), outputDir = path.join(root, 'downloads');
  const inventory = readJson(path.resolve(options.inventory));
  let rows = inventory.books || inventory;
  if (!Array.isArray(rows)) throw Error('书库列表无效');
  rows = rows.filter(b => b.file && (!options.file || b.file === options.file));
  if (options.limit) rows = rows.slice(0, Number(options.limit));
  const reportDir = path.resolve(options['report-dir']); inside(root, reportDir); fs.mkdirSync(reportDir, {recursive: true});
  const previousSummary = readJson(path.join(reportDir, 'applied-summary.json'));
  const priorReports = new Map((previousSummary?.books || []).map(b => [b.file, b.reportFile]));
  const result = {version: readingCleanupVersion, apply: args.includes('--apply'), startedAt: new Date().toISOString(), books: [], errors: []};
  for (const row of rows) {
    try {
      const previousFile = priorReports.get(row.file);
      const previous = result.apply && previousFile && readJson(previousFile);
      const report = previous && hash(fs.readFileSync(path.join(outputDir, row.file))) === previous.afterHash ? {...previous, reused: true}
        : await cleanLocalBook({root, stateDir, outputDir, file: row.file, apply: result.apply});
      const reportFile = path.join(reportDir, continuationKey(report) + (result.apply ? '-applied.json' : '-preview.json'));
      atomicWrite(reportFile, report);
      result.books.push({file: report.file, title: report.title, author: report.author, chapters: report.chapters, changed: report.changes.length, warnings: report.warnings.length, reportFile, snapshot: report.snapshot});
    } catch (error) { result.errors.push({file: row.file, title: row.title, error: error.message}); }
    atomicWrite(path.join(reportDir, result.apply ? 'applied-summary.json' : 'preview-summary.json'), result);
  }
  console.log(JSON.stringify({books: result.books.length, changedBooks: result.books.filter(b=>b.changed).length, changedChapters: result.books.reduce((n,b)=>n+b.changed,0), errors: result.errors, reportDir}));
  if (result.errors.length) process.exitCode = 2;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e=>{console.error(e.message);process.exitCode=1;});
