import fs from 'node:fs';
import path from 'node:path';
import {validateSpec, extractionHash} from './core.mjs';
import {continuationKey, chapterIdentity} from './continuation.mjs';
import {readJson, atomicWrite, hash, withLock} from './storage.mjs';
import {getCatalog, getChapter} from './adapters.mjs';
import {makeClient} from './http.mjs';
import {qualityReport} from './quality.mjs';

const sealed = value => ({value, hash: hash(value)});
const notice = title => /^(?:请假|公告|通知|月票|总结|感言|后记)/u.test(title);
function decisions(dir) {
  const record = readJson(path.join(dir, 'catalog-notice-reviews.json'));
  if (!record) return [];
  if (!Array.isArray(record.value) || record.hash !== hash(record.value)) throw Error('公告目录核对记录损坏');
  return record.value;
}

// Restore only explicitly reviewed labels. The exported notice and its original
// checkpoint remain unchanged; a site's added chapter number must not consume a
// narrative chapter number or weaken the normal catalog-prefix check.
export function preserveReviewedNotices(catalog, binding, book, dir) {
  const result = catalog.map(entry => ({...entry}));
  for (const review of decisions(dir)) {
    const entry = result[review.position - 1];
    const accepted = binding?.catalog[review.position - 1];
    if (!entry || entry.link !== review.link || entry.title !== review.currentTitle) continue;
    const prior = readJson(path.join(dir, 'chapters', hash(review.link) + '.json'));
    const local = book.chapters.find(c => c.link === review.link);
    if (accepted?.link !== review.link || accepted.title !== review.previousTitle ||
        !prior?.chapter || hash(prior.chapter) !== prior.hash || prior.hash !== review.checkpointHash ||
        !local || hash(local) !== review.localChapterHash ||
        hash(review.incoming) !== review.incomingHash || review.incoming.link !== review.link ||
        review.incoming.title !== review.currentTitle || review.incoming.content !== prior.chapter.content) {
      throw Error('已核对公告的原文、目录或证据发生变化');
    }
    entry.title = review.previousTitle;
  }
  return result;
}

export async function reviewContinuationCatalogNotice(input, options, review) {
  const spec = validateSpec(input), extraction = extractionHash(spec);
  const stateDir = path.resolve(options.stateDir), outputDir = path.resolve(options.outputDir);
  const key = continuationKey(spec), base = path.join(stateDir, 'continuations', key);
  return withLock(path.join(stateDir, 'book-locks', key + '.lock'), async () => {
    const record = readJson(path.join(base, 'binding.json')), binding = record?.value;
    if (!binding || record.hash !== hash(binding) || binding.source.url !== spec.sourceUrl ||
        binding.source.extraction !== extraction || binding.exportHash !== review.exportHash ||
        path.resolve(outputDir, binding.file) !== binding.outputPath || !review.reason?.trim() ||
        fs.existsSync(path.join(base, 'pending.json'))) throw Error('公告核对需要有效的当前绑定、原书哈希和理由');
    const raw = fs.readFileSync(binding.outputPath), book = JSON.parse(raw);
    if (hash(raw) !== binding.exportHash) throw Error('公告核对的原书已变化');
    const position = binding.catalog.findIndex(c => c.link === review.link), old = binding.catalog[position];
    const currentId = chapterIdentity(review.title);
    if (position !== binding.catalog.length - 1 || !old || chapterIdentity(old.title) ||
        !notice(old.title) || !currentId || review.title.normalize('NFKC').replace(/^第[0-9零〇一二三四五六七八九十百千万两]+章\s*/u, '') !== old.title.normalize('NFKC')) {
      throw Error('只支持末尾公告增加章号，不能接受正文改名或目录重排');
    }
    const dir = path.join(base, 'sources', hash([spec.sourceUrl, extraction]).slice(0, 24));
    const checkpoint = readJson(path.join(dir, 'chapters', hash(review.link) + '.json'));
    const local = book.chapters.find(c => c.link === review.link);
    if (!checkpoint?.chapter || checkpoint.hash !== hash(checkpoint.chapter) || checkpoint.catalogTitle !== old.title ||
        checkpoint.chapter.title !== old.title || checkpoint.chapter.chapter_number !== position + 1 ||
        !local || local.title !== old.title || local.content !== checkpoint.chapter.content) throw Error('原公告检查点与本地全文不一致');
    const client = makeClient({cacheDir: path.join(stateDir, 'cache'), allowedHosts: spec.allowedHosts,
      delayMs: spec.delayMs, retries: spec.retries, timeoutMs: spec.timeoutMs, browser: {...spec.browser, headless: true}, refresh: true});
    try {
      const source = await getCatalog(spec, client);
      const catalog = preserveReviewedNotices(source.catalog, binding, book, dir);
      if (binding.catalog.some((c, i) => catalog[i]?.link !== c.link ||
          catalog[i]?.title !== (i === position ? review.title : c.title))) throw Error('除该公告外的已接受目录也发生变化');
      const incoming = await getChapter(spec, source.catalog[position], new Set(source.catalog.map(c => c.link)), client);
      const quality = qualityReport([source.catalog[position]], [incoming], [], 'probe');
      if (incoming.title !== review.title || incoming.content !== checkpoint.chapter.content ||
          quality.issues.some(i => i.level !== 'info' && i.code !== 'short-outlier')) throw Error('公告正文或页面标题发生变化，不能接受改名');
      if (hash(fs.readFileSync(binding.outputPath)) !== binding.exportHash || hash(readJson(path.join(base, 'binding.json')).value) !== record.hash) throw Error('核对期间原书或绑定发生变化');
      const decision = {position: position + 1, link: review.link, previousTitle: old.title, currentTitle: review.title,
        checkpointHash: checkpoint.hash, localChapterHash: hash(local), incoming, incomingHash: hash(incoming),
        exportHash: binding.exportHash, catalogEvidence: source.evidence, reason: review.reason.trim(), reviewedAt: new Date().toISOString()};
      atomicWrite(path.join(dir, 'catalog-notice-reviews.json'), sealed([...decisions(dir).filter(d => d.link !== review.link), decision]));
      return decision;
    } finally { await client.close(); }
  });
}
