import fs from 'node:fs';
import path from 'node:path';
import {acquire, extractionHash, jobId, localBookState} from '../core.mjs';
import {continuationKey, hasContinuation} from '../continuation.mjs';
import {hash, readJson} from '../storage.mjs';
import {failureDetails} from '../diagnostics.mjs';
import {makeClient} from '../http.mjs';
import {browserProfile} from '../browser-session.mjs';
import {applyVerifiedBookStatus, loadSites, specForBook} from './sources.mjs';

const entries = dir => fs.existsSync(dir) ? fs.readdirSync(dir, {withFileTypes: true}) : [];
function sealed(file) {
  const record = readJson(file);
  if (!record?.value || record.hash !== hash(record.value)) throw Error('来源绑定记录损坏，请先核对；原文件保留');
  return record.value;
}

// Inspect exports once, in the worker. Reports and mapping sidecars are not books.
// An explicit continuation or reading-edition binding takes precedence over old exports.
export function planLibrary({stateDir, outputDir, sites = loadSites().sites}) {
  stateDir = path.resolve(stateDir); outputDir = path.resolve(outputDir);
  const groups = new Map(), invalid = [], jobs = [];
  for (const entry of entries(outputDir)) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const file = path.join(outputDir, entry.name);
    try {
      const raw = fs.readFileSync(file), book = JSON.parse(raw);
      if (!book.title || !book.author || !Array.isArray(book.chapters) || !book.chapters.length) continue;
      const key = continuationKey(book);
      const item = {file: entry.name, title: book.title, author: book.author, url: book.sourceUrl,
        count: book.chapters.length, hash: hash(raw), description: book.description, status: book.status};
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    } catch (error) { invalid.push({file: entry.name, title: entry.name, state: 'skipped', message: `无法读取下载文件：${error.message}`}); }
  }
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
      const currentSpec = specForBook(book, sites);
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
      plans.push({...files[0], ...(book || {}), state: 'skipped', message: error.message});
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
const publicItem = ({file, title, author, url, count, state, message, added, failure}) => ({file, title, author, url, count, state, message, added, failure});

export async function updateLibrary({stateDir, outputDir, sites, shouldStop = () => false, signal, onLibrary = () => {}, onPhase = () => {},
  onStatus, onProgress, onClient = () => {}, collect = acquire, createClient = makeClient}) {
  const plans = planLibrary({stateDir, outputDir, sites}), startedAt = new Date().toISOString();
  const stopped = () => signal?.aborted || shouldStop();
  const snapshot = () => ({startedAt, ...librarySummary(plans), items: plans.map(publicItem)});
  onLibrary(snapshot());
  for (const item of plans) {
    if (stopped()) break;
    if (item.state !== 'pending') continue;
    item.state = 'running'; item.message = '正在核对来源目录…';
    onLibrary(snapshot());
    let client;
    try {
      const file = path.resolve(outputDir, item.file);
      if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink() || hash(fs.readFileSync(file)) !== item.hash) throw Error('排队期间下载文件被修改或移走，请重新检查；原文件保留');
      const spec = item.spec;
      client = createClient({cacheDir: path.join(stateDir, 'cache'), profileDir: browserProfile(stateDir, spec.sourceUrl), allowedHosts: spec.allowedHosts,
        delayMs: spec.delayMs, retries: spec.retries, timeoutMs: spec.timeoutMs, browser: spec.browser, signal, shouldStop: stopped, onStatus});
      onClient(client);
      const options = {stateDir, outputDir, continuation: item.continuation, client, signal, shouldStop: stopped, onStatus, onProgress};
      onPhase('probe', item);
      let report = await collect(spec, {...options, mode: 'probe'});
      if (!stopped() && !report.paused && report.structuralPass) {
        onPhase('download', item);
        report = await collect(spec, {...options, mode: 'download'});
      }
      if (report.exportFile && report.completeAgainstSource) {
        if (path.resolve(report.exportFile) !== file) throw Error('更新输出与原文件不一致，请核对来源绑定');
        item.added = Math.max(0, report.expected - item.count);
        item.state = report.reusedExport ? 'unchanged' : 'updated';
        item.message = item.added ? `新增 ${item.added} 章，现有 ${report.expected} 章` : report.reusedExport ? '已是最新' : '章节无新增，书籍信息已更新';
      } else if (stopped() || report.paused) {
        item.state = 'stopped'; item.message = '已停止，已保存的章节可续传';
      } else throw Error(report.failures?.[0]?.error || '来源检查未通过，原文件保留');
    } catch (error) {
      item.state = stopped() ? 'stopped' : 'failed';
      item.message = stopped() ? '已停止，已保存的章节可续传' : error.message;
      if (!stopped()) item.failure = failureDetails(error);
    } finally {
      try { await client?.close(); }
      catch (error) { item.state = 'failed'; item.message = `采集窗口关闭失败：${error.message}`; item.failure = failureDetails(error); }
      onClient(null);
    }
    onLibrary(snapshot());
  }
  for (const item of plans) if (item.state === 'pending') { item.state = 'stopped'; item.message = '尚未检查，下次更新时继续核对'; }
  const result = {...snapshot(), finishedAt: new Date().toISOString(), stopped: !!stopped()};
  onLibrary(result);
  return result;
}
