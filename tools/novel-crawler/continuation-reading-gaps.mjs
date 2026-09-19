import fs from 'node:fs';
import path from 'node:path';
import {readJson, hash} from './storage.mjs';
import {preserveCatalogLabels} from './titles.mjs';

// A same-source migration may retain an already reviewed historical omission.
// This never excuses a new gap or inserts/replaces an old chapter. Every source
// position, omitted checkpoint and complete original export must still match.
export function preservedReadingGap({stateDir, outputDir, file, spec, book, catalog, previous, current, identity}) {
  const start = previous.sourceChapterNumber, end = current.sourceChapterNumber;
  if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start + 1 || book.sourceUrl !== spec.sourceUrl) return null;
  const jobs = path.join(stateDir, 'jobs'), exportHash = hash(JSON.stringify(book, null, 2) + '\n');
  for (const id of fs.existsSync(jobs) ? fs.readdirSync(jobs) : []) {
    if (!/^[a-f0-9]{20}$/u.test(id)) continue;
    const dir = path.join(jobs, id), saved = readJson(path.join(dir, 'reading-edition.json')), state = saved?.value;
    if (!state || saved.hash !== hash(state) || state.version !== 1 || state.outputPath !== path.resolve(outputDir, file) || state.file !== file || state.exportHash !== exportHash || hash(state.book) !== hash(book) || state.identity?.sourceUrl !== spec.sourceUrl) continue;
    const gaps = state.sourceOrderReview?.gaps;
    if (!gaps?.length || state.book.chapters.some(c => c.sourceChapterNumber > start && c.sourceChapterNumber < end)) continue;
    const firstNumber = identity(previous.title)?.number, lastNumber = identity(current.title)?.number;
    if (lastNumber - firstNumber !== end - start) continue;
    const preserved = [];
    for (let position = start; position <= end; position++) {
      const source = state.sources[position - 1], entry = catalog[position - 1];
      if (!source || !entry || source.position !== position || source.link !== entry.link || preserveCatalogLabels([entry], [{link: source.link, title: source.catalogTitle}])[0].title !== source.catalogTitle || identity(source.title)?.number !== firstNumber + position - start) break;
      if (position === start || position === end) {
        const old = position === start ? previous : current;
        if (source.link !== old.link || source.contentHash !== hash(old.content) || identity(old.title)?.number !== identity(source.title)?.number) break;
      } else {
        const gap = gaps.find(g => g.position === position), checkpoint = readJson(path.join(dir, 'chapters', hash(source.link) + '.json'));
        if (!gap || !['truncated', 'placeholder'].includes(gap.kind) || !gap.reason?.trim() || !gap.evidence?.url || !gap.evidence?.detail || !Number.isFinite(Date.parse(gap.evidence.checkedAt)) || gap.link !== source.link || gap.contentHash !== source.contentHash || !checkpoint?.chapter || checkpoint.hash !== hash(checkpoint.chapter) || checkpoint.chapter.link !== source.link || checkpoint.chapter.chapter_number !== position || hash(checkpoint.chapter.content) !== gap.contentHash) break;
        preserved.push({...gap, title: source.title});
      }
      if (position === end && preserved.length === end - start - 1) return {kind: 'preserved-reading-gap', title: preserved.map(g => g.title).join('、'), link: preserved[0].link, originalExportHash: exportHash, readingStateHash: saved.hash, readingJob: id, gaps: preserved, reason: '沿用已核对阅读版的历史缺文记录；旧章节及顺序不变，缺口未视为已补齐。'};
    }
  }
  return null;
}
