import fs from 'node:fs';
import path from 'node:path';
import {continuationKey, recoverContinuation, chapterIdentity} from './continuation.mjs';
import {extractionHash, validateSpec} from './core.mjs';
import {atomicWrite, hash, readJson, withLock} from './storage.mjs';
import {normalizedTitle} from './quality.mjs';
import {chapterDuplicateIssues} from '../../shared/chapter-duplicates.mjs';
import {prepareImport} from '../../infra/import-plan.mjs';

// Maintenance only: an exact export and both complete variants must have been
// reviewed. Never automatically choose between similar chapters during updates.
export async function repairContinuationDuplicates(input, {stateDir, outputDir}, review) {
  const spec = validateSpec(input), options = {stateDir: path.resolve(stateDir), outputDir: path.resolve(outputDir)};
  const dir = path.join(options.stateDir, 'continuations', continuationKey(spec));
  return withLock(path.join(options.stateDir, 'book-locks', continuationKey(spec) + '.lock'), () => {
    const binding = recoverContinuation(spec, options);
    if (!binding || binding.source.url !== spec.sourceUrl || binding.source.extraction !== extractionHash(spec)) throw Error('重复项修复需要匹配当前来源规则的已有续更绑定');
    const original = fs.readFileSync(binding.outputPath), originalHash = hash(original), book = JSON.parse(original);
    if (originalHash !== binding.exportHash || originalHash !== review?.exportHash) throw Error('原书已变化，请重新核对重复项');
    if (!Array.isArray(review.pairs) || !review.pairs.length || typeof review.reason !== 'string' || !review.reason.trim()) throw Error('重复项修复需要逐项核对及具体理由');
    if (book.chapters.some((c,i) => i && c.chapter_number <= book.chapters[i-1].chapter_number)) throw Error('原书顺序号未严格递增');
    const issues = chapterDuplicateIssues(book.chapters), removed = new Set(review.pairs.map(p => p.omit));
    const ending = new Set(book.chapters.filter(c => chapterIdentity(c.title)).slice(-3).map(c => c.chapter_number));
    if (removed.size !== review.pairs.length) throw Error('不能重复移出同一条目');
    const decisions = review.pairs.map(pair => {
      const omitted = book.chapters.find(c => c.chapter_number === pair.omit), retained = book.chapters.find(c => c.chapter_number === pair.keep);
      if (!omitted || !retained || pair.omit === pair.keep || removed.has(pair.keep) || ending.has(pair.omit)) throw Error('保留项或末尾衔接章不能被移出');
      if (hash(omitted) !== pair.omitHash || hash(retained) !== pair.keepHash) throw Error('重复项完整内容哈希已变化');
      if (typeof pair.reason !== 'string' || !pair.reason.trim() || normalizedTitle(omitted.title) !== normalizedTitle(retained.title) ||
          !issues.some(issue => ['duplicate-body','duplicate-title-body'].includes(issue.code) &&
            [issue.chapter,issue.otherChapter].includes(pair.omit) && [issue.chapter,issue.otherChapter].includes(pair.keep))) throw Error('只能修复逐项核对的同题重复正文');
      return {kind:'repaired-old-duplicate', omit:pair.omit, keep:pair.keep, title:retained.title, omitHash:pair.omitHash, keepHash:pair.keepHash, reason:pair.reason.trim()};
    });
    const nextBook = {...book, chapters:book.chapters.filter(c => !removed.has(c.chapter_number))};
    prepareImport(nextBook);
    const nextHash = hash(JSON.stringify(nextBook, null, 2) + '\n'), backup = path.join(dir, 'repairs', originalHash);
    const preserve = (name, bytes) => {
      const file = path.join(backup, name);
      if (fs.existsSync(file)) { if (hash(fs.readFileSync(file)) !== hash(bytes)) throw Error('修复备份已存在且内容不同'); }
      else atomicWrite(file, bytes);
    };
    preserve('book.json', original);
    preserve('binding.json', fs.readFileSync(path.join(dir,'binding.json')));
    const record = {originalHash, nextHash, backup, reason:review.reason.trim(), reviewedAt:new Date().toISOString(), decisions};
    atomicWrite(path.join(backup,'review.json'), record);
    if (hash(fs.readFileSync(binding.outputPath)) !== originalHash || hash(readJson(path.join(dir,'binding.json')).value) !== hash(binding)) throw Error('修复期间原书或绑定被修改');
    const next = {...binding, revision:binding.revision+1, count:nextBook.chapters.length, exportHash:nextHash,
      resolutions:[...(binding.resolutions || []), ...decisions.map(d => ({...d,originalHash,backup,reviewedAt:record.reviewedAt}))], updatedAt:record.reviewedAt};
    atomicWrite(path.join(dir,'pending.json'), {hash:hash({previousBindingHash:hash(binding),previousExportHash:originalHash,next,book:nextBook}),
      value:{previousBindingHash:hash(binding),previousExportHash:originalHash,next,book:nextBook}});
    recoverContinuation(spec, options);
    return record;
  });
}
