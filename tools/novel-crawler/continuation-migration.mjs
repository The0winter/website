import fs from 'node:fs';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {validateSpec, extractionHash} from './core.mjs';
import {continuationKey, recoverContinuation} from './continuation.mjs';
import {getCatalog, getChapter} from './adapters.mjs';
import {makeClient} from './http.mjs';
import {browserProfile} from './browser-session.mjs';
import {qualityReport} from './quality.mjs';
import {preserveCatalogLabels} from './titles.mjs';
import {atomicWrite, readJson, hash, withLock} from './storage.mjs';

// Explicit maintenance operation, never an automatic exemption from an
// extraction mismatch. Only additive cleanup/catalog pagination is supported.
export async function migrateContinuationRules(previousInput, input, {stateDir, outputDir, reason, client: suppliedClient}) {
  const previous = validateSpec(previousInput), spec = validateSpec(input);
  if (typeof reason !== 'string' || !reason.trim() || previous.kind !== 'html' || spec.kind !== 'html') throw Error('来源规则迁移需要完整旧规则、新规则及具体核对理由');
  const strip = value => {
    const copy = structuredClone(value);
    delete copy.variant; delete copy.chapter.removeText; delete copy.catalog.next; delete copy.catalog.maxPages;
    return extractionHash(copy);
  };
  if (strip(previous) !== strip(spec) || (previous.chapter.removeText || []).some(rule => !(spec.chapter.removeText || []).includes(rule)) ||
      previous.catalog.next && !isDeepStrictEqual(previous.catalog.next, spec.catalog.next) ||
      (previous.catalog.maxPages || 100) > (spec.catalog.maxPages || 100) && previous.catalog.next) throw Error('仅支持新增清理规则或补充目录分页，其他提取变化须独立重新核对');
  const oldExtraction = extractionHash(previous), extraction = extractionHash(spec);
  const dir = path.join(path.resolve(stateDir), 'continuations', continuationKey(spec));
  return withLock(path.join(path.resolve(stateDir), 'book-locks', continuationKey(spec) + '.lock'), async () => {
    const binding = recoverContinuation(previous, {stateDir, outputDir});
    if (!binding || binding.source.url !== spec.sourceUrl || binding.source.extraction !== oldExtraction || oldExtraction === extraction) throw Error('旧来源规则与当前续更绑定不匹配');
    if (hash(fs.readFileSync(binding.outputPath)) !== binding.exportHash) throw Error('原书被修改，拒绝迁移');
    const from = path.join(dir, 'sources', hash([spec.sourceUrl, oldExtraction]).slice(0, 24));
    const to = path.join(dir, 'sources', hash([spec.sourceUrl, extraction]).slice(0, 24));
    const client = suppliedClient || makeClient({cacheDir: path.join(stateDir, 'cache'), profileDir: browserProfile(stateDir, spec.sourceUrl), allowedHosts: spec.allowedHosts, delayMs: spec.delayMs, retries: 2, timeoutMs: spec.timeoutMs, browser: spec.browser});
    try {
      const source = await getCatalog(spec, client), catalog = preserveCatalogLabels(source.catalog, binding.catalog);
      if (binding.catalog.some((entry, i) => !catalog[i] || entry.link !== catalog[i].link || entry.title !== catalog[i].title)) throw Error('迁移目录与已接受目录不一致');
      const ending = catalog.slice(0, binding.catalog.length).slice(-3), links = new Set(catalog.map(c => c.link)), anchors = [];
      if (ending.length !== 3) throw Error('来源不足三个末尾检查点');
      for (const entry of ending) {
        const saved = readJson(path.join(from, 'chapters', hash(entry.link) + '.json'));
        if (!saved?.chapter || saved.hash !== hash(saved.chapter) || saved.chapter.link !== entry.link || saved.chapter.chapter_number !== entry.chapter_number) throw Error('迁移末尾检查点缺失或损坏');
        const freshClient = {get: (url, options) => client.get(url, {...options, fresh: true}), assertUrl: client.assertUrl};
        const chapter = await getChapter(spec, entry, links, freshClient);
        const quality = qualityReport([entry], [chapter], [], 'probe');
        if (quality.issues.some(issue => issue.level !== 'info' && issue.code !== 'short-outlier') || chapter.title !== saved.chapter.title || chapter.content !== saved.chapter.content) throw Error(`新规则与已接受的末尾全文不一致：${entry.title}`);
        anchors.push({link: entry.link, position: entry.chapter_number, contentHash: hash(chapter.content), previousCheckpointHash: saved.hash, evidence: chapter.provenance});
      }
      const oldReviews = readJson(path.join(from, 'reviews.json'));
      if (oldReviews && (oldReviews.hash !== hash(oldReviews.value) || oldReviews.value.extraction !== oldExtraction)) throw Error('旧核对记录损坏');
      const migratedReviews = oldReviews && {...oldReviews.value, extraction};
      const existingReviews = readJson(path.join(to, 'reviews.json'));
      if (existingReviews && (!migratedReviews || existingReviews.hash !== hash(migratedReviews))) throw Error('新规则目录已有不同核对记录，拒绝覆盖');
      if (hash(fs.readFileSync(binding.outputPath)) !== binding.exportHash || !isDeepStrictEqual(readJson(path.join(dir, 'binding.json')).value, binding)) throw Error('迁移期间原书或绑定发生变化');
      const migration = {previousSource: binding.source, source: {url: spec.sourceUrl, title: spec.title, author: spec.author, variant: spec.variant || '', extraction}, reason: reason.trim(), catalogHash: hash(catalog), evidence: source.evidence, anchors, reviewedAt: new Date().toISOString()};
      if (oldReviews) {
        const refs = path.join(from, 'references');
        for (const name of fs.existsSync(refs) ? fs.readdirSync(refs) : []) {
          if (!/^[a-f0-9]{64}\.bin$/.test(name)) throw Error('旧证据文件名无效');
          const bytes = fs.readFileSync(path.join(refs, name));
          if (hash(bytes) !== name.slice(0, -4)) throw Error('旧证据文件损坏');
          atomicWrite(path.join(to, 'references', name), bytes);
        }
        atomicWrite(path.join(to, 'reviews.json'), {hash: hash(migratedReviews), value: migratedReviews});
      }
      // Accepted chapter bytes and checkpoints keep their original extraction
      // provenance. New chapters start in a separate directory for the new rules.
      atomicWrite(path.join(to, 'rule-migration.json'), {hash: hash(migration), value: migration});
      const next = {...binding, revision: binding.revision + 1, source: migration.source, ruleMigrations: [...(binding.ruleMigrations || []), migration]};
      atomicWrite(path.join(dir, 'binding.json'), {hash: hash(next), value: next});
      return migration;
    } finally { if (!suppliedClient) await client.close(); }
  });
}
