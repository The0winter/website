import fs from 'node:fs';
import path from 'node:path';
import {acquire, extractionHash, jobId, localBookState} from '../core.mjs';
import {continuationKey, hasContinuation} from '../continuation.mjs';
import {hash, readJson} from '../storage.mjs';
import {failureDetails} from '../diagnostics.mjs';
import {makeClient} from '../http.mjs';
import {browserProfile} from '../browser-session.mjs';
import {applyVerifiedBookStatus, loadSites, specForBook} from './sources.mjs';
import {createLibraryControl} from './library-control.mjs';
import {localUploadIndex} from './upload-cache.mjs';

const entries = dir => fs.existsSync(dir) ? fs.readdirSync(dir, {withFileTypes: true}) : [];
function sealed(file) {
  const record = readJson(file);
  if (!record?.value || record.hash !== hash(record.value)) throw Error('来源绑定记录损坏，请先核对；原文件保留');
  return record.value;
}

// Inspect exports once, in the worker. Reports and mapping sidecars are not books.
// An explicit continuation or reading-edition binding takes precedence over old exports.
export function planLibrary({stateDir, outputDir, sites = loadSites().sites, forUpload = false, forceFull = false}) {
  stateDir = path.resolve(stateDir); outputDir = path.resolve(outputDir);
  const groups = new Map(), invalid = [], jobs = [];
  const index = forUpload ? localUploadIndex({stateDir, outputDir, forceFull}) : null;
  for (const entry of entries(outputDir)) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const file = path.join(outputDir, entry.name);
    try {
      const inspect = () => {
        const raw = fs.readFileSync(file), book = JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, ''));
        if (!book.title || !book.author || !Array.isArray(book.chapters) || !book.chapters.length) return null;
        return {file: entry.name, title: book.title, author: book.author, url: book.sourceUrl, sourceUrl: book.sourceUrl,
          count: book.chapters.length, hash: hash(raw), description: book.description, status: book.status};
      };
      const item = index ? index.get(entry.name, inspect) : inspect();
      if (!item) continue;
      const key = continuationKey(item);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    } catch (error) { invalid.push({file: entry.name, title: entry.name, state: 'blocked', message: `无法读取下载文件：${error.message}`}); }
  }
  index?.flush();
  for (const entry of entries(path.join(stateDir, 'jobs'))) {
    if (!entry.isDirectory() || !/^[a-f0-9]{20}$/.test(entry.name)) continue;
    const dir = path.join(stateDir, 'jobs', entry.name);
    try { const spec = readJson(path.join(dir, 'spec.json')); if (spec?.title && spec?.author) jobs.push({dir, spec, key: continuationKey(spec)}); }
    catch { /* A known export without a readable job will use guarded tail reconciliation. */ }
  }
  const plans = [];
  for (const [key, files] of groups) {
    let book = files[0];
    try {
      const related = jobs.filter(job => job.key === key);
      let binding, reading, rawJob;
      if (hasContinuation(book, stateDir)) {
        const dir = path.join(stateDir, 'continuations', key);
        binding = fs.existsSync(path.join(dir, 'pending.json')) ? sealed(path.join(dir, 'pending.json')).next : sealed(path.join(dir, 'binding.json'));
        book = files.find(item => path.join(outputDir, item.file) === binding.outputPath);
        if (!book || binding.file !== book.file) throw Error('已绑定的续更文件被移走，请恢复原文件后再更新');
        book = {...book, url: binding.source?.url};
      } else {
        const editions = related.filter(job => ['reading-edition.json', 'reading-edition-pending.json'].some(file => fs.existsSync(path.join(job.dir, file))));
        if (editions.length > 1) throw Error('有多个阅读版来源绑定，请先核对保留的版本');
        if (editions.length) {
          reading = editions[0];
          const record = sealed(path.join(reading.dir, 'reading-edition.json'));
          book = files.find(item => path.join(outputDir, item.file) === record.outputPath);
          if (!book) throw Error('已绑定的阅读版被移走，请恢复原文件后再更新');
          book = {...book, url: reading.spec.sourceUrl};
        } else if (files.length > 1) throw Error('有多个同名同作者的下载版本，请先选择保留的版本再更新');
        for (const job of related) {
          const record = readJson(path.join(job.dir, 'export.json'));
          if (record?.path === path.join(outputDir, book.file)) {
            if (record.hash !== book.hash) throw Error('导出文件已被修改，请先核对；原文件保留');
            rawJob = job;
          }
        }
      }
      // Upload uses the accepted local edition, independent of today's website
      // selectors or availability. Never publish a half-committed edition.
      if (forUpload) {
        if (binding) {
          if (fs.existsSync(path.join(stateDir, 'continuations', key, 'pending.json'))) throw Error('上次换源更新尚未完成，请先继续更新以恢复');
          if (binding.exportHash !== book.hash) throw Error('已绑定的续更文件被修改，请先核对');
        }
        if (reading) {
          if (fs.existsSync(path.join(reading.dir, 'reading-edition-pending.json'))) throw Error('上次阅读版更新尚未完成，请先继续更新以恢复');
          if (sealed(path.join(reading.dir, 'reading-edition.json')).exportHash !== book.hash) throw Error('已绑定的阅读版被修改，请先核对');
        }
        plans.push({...book, state: 'pending', message: '等待核对网站书库'});
        continue;
      }
      const siteSpec = specForBook(book, sites);
      // A verified TXT job owns its file boundaries and cleanup rules. Replacing
      // it with the site's HTML template abandons checkpoints/reading bindings.
      const savedSpec = reading?.spec || rawJob?.spec;
      const currentSpec = savedSpec?.kind === 'txt' && savedSpec.sourceUrl === siteSpec.sourceUrl ? savedSpec : siteSpec;
      if (currentSpec === savedSpec && siteSpec.maxChapterPages !== undefined) {
        currentSpec.maxChapterPages = Math.max(currentSpec.maxChapterPages || currentSpec.chapter?.maxPages || 20, siteSpec.maxChapterPages);
      }
      // Preserve the book's background-window preference without concealing
      // changes to the site's selectors, transport or other extraction rules.
      if (currentSpec !== savedSpec && savedSpec?.sourceUrl === siteSpec.sourceUrl) {
        for (const field of ['headless', 'minimized']) if (typeof savedSpec.browser?.[field] === 'boolean') {
          currentSpec.browser = {...currentSpec.browser, [field]: savedSpec.browser[field]};
        }
      }
      const spec = applyVerifiedBookStatus(currentSpec, stateDir, currentSpec.identityNormalization);
      if (binding && (binding.source.variant !== (spec.variant || '') || binding.source.extraction !== extractionHash(spec))) throw Error('当前续更来源规则已变化，请先核对适配；原文件保留');
      if (reading && (jobId(reading.spec) !== jobId(spec) || extractionHash(reading.spec) !== extractionHash(spec))) throw Error('阅读版来源规则已变化，请先核对映射；原文件保留');
      const local = localBookState(spec, {stateDir, outputDir});
      if (binding || reading || (rawJob && jobId(rawJob.spec) === jobId(spec))) {
        if (local.blocked || ['modified', 'incompatible', 'unknown'].includes(local.state)) throw Error(local.message);
      }
      // Legacy exports have no crawler checkpoints. The existing continuation engine
      // verifies three tail chapters, preserves the whole old book, then appends only.
      const continuation = binding ? local.continuation : !reading && (!rawJob || jobId(rawJob.spec) !== jobId(spec)) ? {file: book.file, hash: book.hash} : undefined;
      if (continuation && (spec.kind !== 'html' || spec.catalog?.walk)) throw Error('此旧下载需要先补齐完整目录适配，暂不能自动衔接');
      plans.push({...book, spec, continuation, state: 'pending', message: '等待检查来源'});
    } catch (error) {
      plans.push({...files[0], ...(book || {}), state: 'blocked', message: error.message});
    }
  }
  return [...plans, ...invalid];
}

export function librarySummary(items) {
  const count = state => items.filter(item => item.state === state).length;
  const updated = count('updated'), unchanged = count('unchanged'), failed = count('failed'), skipped = count('skipped');
  return {total: items.length, checked: updated + unchanged + failed + skipped, updated, unchanged, failed, skipped,
    added: items.reduce((sum, item) => sum + (item.added || 0), 0)};
}
const publicItem = ({file, title, author, url, count, state, message, added, failure, controlId}) => ({file, title, author, url, count, state, message, added, failure, controlId});

export async function updateLibrary({stateDir, outputDir, sites, shouldStop = () => false, signal, onLibrary = () => {}, onPhase = () => {},
  onStatus, onProgress, onClient = () => {}, onFailure, control = createLibraryControl({signal, shouldStop}), collect = acquire, createClient = makeClient}) {
  const plans = planLibrary({stateDir, outputDir, sites}), startedAt = new Date().toISOString();
  const stopped = () => signal?.aborted || shouldStop();
  const snapshot = () => ({startedAt, ...librarySummary(plans), items: plans.map(publicItem)});
  onLibrary(snapshot());
  try {
    for (const item of plans) {
      if (stopped()) break;
      const bookControl = control.begin();
      item.controlId = bookControl.id;
      const bookStopped = () => stopped() || bookControl.skipped;
      let blocked = item.state === 'blocked' ? item.message : null;
      while (!bookStopped()) {
        item.state = 'running'; item.message = '正在核对来源目录…'; delete item.failure; delete item.interruption;
        onPhase('probe', item); onLibrary(snapshot());
        let client, failure;
        try {
          if (blocked) throw Error(blocked);
          const file = path.resolve(outputDir, item.file);
          if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink() || hash(fs.readFileSync(file)) !== item.hash) throw Error('排队期间下载文件被修改或移走，请重新检查；原文件保留');
          const spec = item.spec;
          client = createClient({cacheDir: path.join(stateDir, 'cache'), profileDir: browserProfile(stateDir, spec.sourceUrl), allowedHosts: spec.allowedHosts,
            delayMs: spec.delayMs, retries: 2, retryNetworkErrors: true, timeoutMs: spec.timeoutMs, browser: spec.browser,
            signal: bookControl.controller.signal, shouldStop: bookStopped, onStatus: status => {
              item.state = status.kind === 'retrying' ? 'retrying' : 'running'; item.message = status.message;
              item.interruption = ['login', 'verification', 'retrying'].includes(status.kind) ? failureDetails(Error(status.message), {url: status.url || item.url}) : null;
              onStatus?.(status); onLibrary(snapshot());
            }});
          onClient(client);
          const options = {stateDir, outputDir, continuation: item.continuation, client, signal: bookControl.controller.signal, shouldStop: bookStopped, stopOnFailure: true, onStatus, onProgress};
          // Download already validates identity, catalog, checkpoints, every new
          // chapter and the complete edition before replacing the output. A
          // separate probe repeats the catalog and whole-book quality work.
          onPhase('download', item);
          const report = await collect(spec, {...options, mode: 'download'});
          if (report.exportFile && report.structuralPass && (report.completeAgainstSource || report.completeSelectedScope)) {
            if (path.resolve(report.exportFile) !== file) throw Error('更新输出与原文件不一致，请核对来源绑定');
            item.added = Math.max(0, report.expected - item.count);
            item.state = report.reusedExport ? 'unchanged' : 'updated';
            item.message = item.added ? `新增 ${item.added} 章，现有 ${report.expected} 章` : report.reusedExport ? '已是最新' : '章节无新增，书籍信息已更新';
            if (report.sourceGaps?.length) item.message = `${item.added ? `新增 ${item.added} 章` : '已保留核实的阅读版'}；另有 ${report.sourceGaps.length} 处已记录缺文`;
          } else if (bookStopped() || report.paused) {
            item.state = 'stopped'; item.message = '已停止，已保存的章节可续传';
          } else throw Object.assign(Error(report.failures?.[0]?.error || '来源检查未通过，原文件保留'), report.failures?.[0]);
        } catch (error) {
          failure = failureDetails(error, {url: error.url || error.link || item.url, ...(error.chapter ? {chapter: error.chapter, title: error.title, link: error.link} : {})});
        } finally {
          try { await client?.close(); }
          catch (error) { failure = failureDetails(Error(`采集窗口关闭失败：${error.message}`)); }
          onClient(null);
        }
        if (bookStopped()) break;
        if (!failure) break;
        item.state = 'waiting'; item.message = failure.error; item.failure = failure;
        const decision = control.wait(bookControl);
        onPhase('library-wait', item); onLibrary(snapshot());
        if (onFailure) control.act(bookControl.id, await onFailure(publicItem(item)));
        const action = await decision;
        if (action !== 'retry') break;
        // Refresh only this selected file's plan after the user repairs its source or
        // restores a protected file. Never accept a different edition implicitly.
        const refreshed = planLibrary({stateDir, outputDir, sites}).find(book => book.file === item.file && book.title === item.title && book.author === item.author);
        blocked = !refreshed ? '原文件被移走或身份发生变化，请恢复后重试' : refreshed.state === 'blocked' ? refreshed.message : null;
        if (refreshed && !blocked) Object.assign(item, refreshed, {controlId: bookControl.id});
      }
      const completed = ['updated', 'unchanged'].includes(item.state);
      if (bookControl.skipped && !completed) { item.failure ||= item.interruption; item.state = 'skipped'; item.message = `已手动跳过${item.failure ? `：${item.failure.error}` : '，已保存章节保留'}`; }
      else if (!completed && (stopped() || item.state === 'waiting')) { item.state = 'stopped'; item.message = '已停止，已保存的章节可续传'; }
      control.end(bookControl);
      onLibrary(snapshot());
    }
  } finally { control.close(); }
  for (const item of plans) if (['pending', 'blocked'].includes(item.state)) { item.state = 'stopped'; item.message = '尚未检查，下次更新时继续核对'; }
  const result = {...snapshot(), finishedAt: new Date().toISOString(), stopped: !!stopped()};
  onLibrary(result);
  return result;
}
