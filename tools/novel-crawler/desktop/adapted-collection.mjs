import fs from 'node:fs';
import path from 'node:path';
import {acquire, jobId, localBookState, validateSpec} from '../core.mjs';
import {atomicWrite, hash, readJson} from '../storage.mjs';
import {normalizedIdentity} from '../identity.mjs';
import {makeClient} from '../http.mjs';
import {browserProfile} from '../browser-session.mjs';
import {planLibrary, sourceLanes} from './library.mjs';

export const adaptedBooklist = stateDir => path.join(stateDir, 'booklists', '榜单100本-选源标注.json');
const normalized = value => normalizedIdentity(value, 'chinese-simplified');
const inside = (root, file) => { const relative = path.relative(root, file); return relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative); };

function readBooklist(stateDir, filename = path.basename(adaptedBooklist(stateDir))) {
  const root = path.resolve(stateDir, 'booklists'), file = path.resolve(root, filename);
  if (!inside(root, file) || (fs.existsSync(file) && !inside(fs.realpathSync(root), fs.realpathSync(file)))) throw Error('选源书单必须位于本地 booklists 目录内');
  const list = readJson(file);
  if (!list) throw Error('未找到已核验的选源书单，请先完成书籍选源标注');
  if (list.version !== 1 || !Array.isArray(list.books) || list.books.length > 1000) throw Error('选源书单格式不正确');
  if (list.eligibleForAutomaticAcquisition !== true) throw Error('此书单仅作选源参考，尚未启用适配采集');
  return list;
}

function enabledBooklists(stateDir) {
  const root = path.join(stateDir, 'booklists'), legacy = path.basename(adaptedBooklist(stateDir));
  const files = fs.existsSync(root) ? fs.readdirSync(root, {withFileTypes: true}).filter(entry => entry.isFile() && entry.name.endsWith('.json')).map(entry => entry.name) : [];
  // Keep the original queue order. New lists join only after explicit approval.
  files.sort((a, b) => a === legacy ? -1 : b === legacy ? 1 : a.localeCompare(b));
  const lists = files.filter(file => readJson(path.join(root, file))?.eligibleForAutomaticAcquisition === true).map(file => ({file, list: readBooklist(stateDir, file)}));
  if (!lists.length) throw Error(files.length ? '此书单仅作选源参考，尚未启用适配采集' : '未找到已核验的选源书单，请先完成书籍选源标注');
  return lists;
}

function approvedSpec(row, {stateDir, sites}) {
  if (row.collectionApproved !== true || !row.status?.startsWith('优先候选')) throw Error('尚未核验通过，暂不采集');
  const site = sites.find(site => site.id === row.website?.id);
  if (!row.website?.adapted || !site) throw Error('来源尚未适配，暂不采集');
  if (typeof row.candidateSpec !== 'string' || !row.candidateSpec) throw Error('缺少已核验的采集配置');
  const root = path.resolve(stateDir, 'candidates'), file = path.resolve(root, row.candidateSpec);
  if (!inside(root, file) || !inside(fs.realpathSync(root), fs.realpathSync(file))) throw Error('采集配置必须位于本地 candidates 目录内');
  const raw = readJson(file);
  if (!row.candidateSpecHash || hash(raw) !== row.candidateSpecHash) throw Error('采集配置已变化，需重新核验来源');
  const spec = validateSpec(raw);
  if (new URL(row.website.url).href !== spec.sourceUrl || !site.hosts.includes(new URL(spec.sourceUrl).hostname)) throw Error('采集配置与标注来源不一致');
  if (!row.collectionIdentity?.title || !row.collectionIdentity?.author || normalized(row.collectionIdentity.title) !== normalized(spec.title) || normalized(row.collectionIdentity.author) !== normalized(spec.author)) throw Error('采集配置与核验的作品身份不一致');
  if (spec.browser?.headless === false) throw Error('此配置会显示浏览器，请改为后台采集并重新核验');
  return spec;
}

function matches(book, row, spec) {
  const titles = [row.title, row.collectionIdentity?.title, spec?.title, ...(spec?.titleAliases || [])].filter(Boolean).map(normalized);
  const authors = [row.author, row.collectionIdentity?.author, spec?.author, ...(spec?.authorAliases || [])].filter(Boolean).map(normalized);
  return [book.title, ...(book.titleAliases || [])].some(title => titles.includes(normalized(title))) && [book.author, ...(book.authorAliases || [])].some(author => authors.includes(normalized(author)));
}

export function planAdaptedCollection({stateDir, outputDir, sites, inventory}) {
  const lists = enabledBooklists(stateDir);
  const local = inventory ?? planLibrary({stateDir, outputDir, sites, forUpload: true});
  const seen = [];
  const plans = lists.flatMap(({file, list}) => list.books.map(row => {
    const item = {rank: row.rank, title: row.title, author: row.author, booklist: list.title || path.basename(file, '.json'), url: row.website?.url, website: row.website?.name, state: 'pending', message: '等待试采与质量检查'};
    let spec, problem;
    try { spec = approvedSpec(row, {stateDir, sites}); } catch (error) { problem = error.message; }
    // Existing books, including protected/modified editions, always win over a
    // candidate. Aliases allow a former title or traditional edition to match.
    if (local.some(book => matches(book, row, spec))) Object.assign(item, {state: 'existing', message: '本地书库已有，保留原版'});
    else if (problem) Object.assign(item, {state: 'deferred', message: `${problem}${row.issues?.length ? `；${row.issues.join('；')}` : ''}`});
    else if (seen.some(book => matches(book, row, spec))) Object.assign(item, {state: 'deferred', message: '书单内作品重复，保留前一条任务'});
    else seen.push(spec);
    return {item, listFile: file, rowHash: hash(row), spec};
  }));
  return plans;
}

function reportProblems(report) {
  const problems = [
    ...(report.failures || []).map(failure => ({...failure, detail: failure.error || failure.message})),
    ...(report.issues || []).filter(issue => issue.level === 'error'),
  ];
  const summary = problems.slice(0, 3).map(issue => `${issue.chapter ? `目录第 ${issue.chapter} 项${issue.title ? `「${issue.title}」` : ''}：` : ''}${issue.detail || issue.code}${issue.otherChapter ? `（关联第 ${issue.otherChapter} 项）` : ''}`).join('；');
  return {summary: summary || '质量检查未通过，已保留检查点，未完成入库', problems};
}

export async function collectAdapted({stateDir, outputDir, sites, signal, shouldStop = () => false, onLibrary = () => {}, onPhase = () => {}, onProgress, onStatus, onClient = () => {}, inventory, acquireBook = acquire, clientFactory = makeClient, concurrency = 2}) {
  if (![1, 2].includes(concurrency)) throw Error('适配采集同时处理的来源数只能为1或2');
  const plans = planAdaptedCollection({stateDir, outputDir, sites, inventory});
  const batch = {kind: 'adapted', startedAt: new Date().toISOString(), concurrency, total: plans.length, items: plans.map(plan => plan.item)};
  const contexts = new Map();
  let fatal, presentation, lastProgress, lastStatus, lastPublish = 0;
  const stopped = () => !!fatal || signal?.aborted || shouldStop();
  const publish = (progressOnly = false) => {
    const current = plans.find(plan => plan.item.state === 'running'), context = contexts.get(current);
    const key = context ? `${plans.indexOf(current)}:${context.phase}` : '';
    const changed = key !== presentation;
    if (changed) {
      presentation = key; lastProgress = lastStatus = null;
      if (context) onPhase(context.phase, current.item);
    }
    onClient(context?.client || null);
    if (context?.progress && context.progress !== lastProgress) { lastProgress = context.progress; onProgress?.(context.progress); }
    if (context?.status && context.status !== lastStatus) { lastStatus = context.status; onStatus?.(context.status); }
    if (progressOnly && !changed && Date.now() - lastPublish < 1000) return;
    lastPublish = Date.now();
    batch.active = plans.filter(plan => plan.item.state === 'running').length;
    for (const state of ['collected', 'existing', 'deferred', 'failed']) batch[state] = batch.items.filter(item => item.state === state).length;
    batch.checked = batch.collected + batch.existing + batch.deferred + batch.failed;
    atomicWrite(path.join(stateDir, 'adapted-collection.json'), batch);
    onLibrary(structuredClone(batch));
  };
  publish();
  async function collectBook(plan, pacing) {
    const {item} = plan;
    let client;
    try {
      // Never continue with stale approvals if the list/spec changes mid-run.
      const row = readBooklist(stateDir, plan.listFile).books.find(row => hash(row) === plan.rowHash);
      if (!row) throw Error('选源标注已变化，需重新检查后再次点击适配采集');
      const spec = approvedSpec(row, {stateDir, sites});
      const local = localBookState(spec, {stateDir, outputDir});
      if (local.blocked || ['modified', 'incompatible'].includes(local.state)) throw Error(local.message || '本地版本需先核对，原文件保留');
      if (local.state === 'complete' || local.continuation || local.readingEdition) { Object.assign(item, {state: 'existing', message: '本地已有版本，保留原版'}); publish(); return; }
      // A previous download already passed the initial probe. Resume through
      // download's full identity/catalog/checkpoint/quality checks, avoiding a
      // second catalog and scattered sample requests on every restart.
      const resume = local.saved > 0 && !!readJson(path.join(stateDir, 'jobs', jobId(spec), 'download-report.json'));
      // File resources are already fetched and split in full during a probe.
      // Run their full QA once, rather than download/parse the same book twice.
      const direct = resume || spec.kind !== 'html';
      const context = {phase: direct ? 'download' : 'probe'};
      contexts.set(plan, context);
      Object.assign(item, {state: 'running', message: resume ? '正在复用检查点并续采' : direct ? '正在采集并检查全文' : '正在试采并检查来源'}); publish();
      const status = value => { context.status = value; publish(true); };
      const options = {stateDir, outputDir, publisherCategories: true, stopOnFailure: true, signal, shouldStop: stopped,
        onProgress: value => { context.progress = value; publish(true); }, onStatus: status};
      // Use the approved extraction rules verbatim, including TXT boundaries,
      // cleanup, variant and aliases. The client alone enforces headless mode.
      client = clientFactory({cacheDir: path.join(stateDir, 'cache'), profileDir: browserProfile(stateDir, spec.sourceUrl), allowedHosts: spec.allowedHosts, delayMs: spec.delayMs, pacing, retries: spec.retries, retryNetworkErrors: true, timeoutMs: spec.timeoutMs, browser: {...spec.browser, headless: true}, signal, shouldStop: stopped, onStatus: status});
      context.client = client; options.client = client; publish();
      let report = await acquireBook(spec, {...options, mode: direct ? 'download' : 'probe'});
      if (!direct && !stopped() && !report.paused && report.structuralPass) {
        item.message = '试采通过，正在采集并检查导出'; context.phase = 'download'; context.progress = context.status = null; publish();
        report = await acquireBook(spec, {...options, mode: 'download'});
      }
      item.reportFile = report.reportFile;
      item.downloaded = report.downloaded; item.expected = report.expected;
      if (stopped() || report.paused) { item.state = 'stopped'; item.message = '已保存进度，再次点击适配采集可继续'; return; }
      if (!report.exportFile || !report.structuralPass || !(report.completeAgainstSource || report.completeSelectedScope) || !fs.existsSync(report.exportFile)) {
        const {summary, problems} = reportProblems(report);
        item.problems = problems.slice(0, 10); item.problemCount = problems.length;
        throw Error(summary);
      }
      Object.assign(item, {state: 'collected', exportFile: report.exportFile, reportFile: report.reportFile, message: `已采集到本地书库${report.warnings ? `；质量报告有 ${report.warnings} 项提示` : ''}`, actualBinding: true});
    } catch (error) {
      Object.assign(item, {state: stopped() ? 'stopped' : 'failed', message: stopped() ? '已停止，保存的进度保留' : error.message});
    } finally {
      try { await client?.close(); }
      catch (error) { item.message += `；来源会话关闭失败：${error.message}`; }
      contexts.delete(plan); publish();
    }
  }
  // Reuse library source grouping, including domain aliases and shared hosts.
  // Each lane is serial and retains its rate-limit clock across books.
  const lanes = sourceLanes(plans.filter(plan => plan.item.state === 'pending').map(plan => ({url: plan.item.url, spec: plan.spec, plan})), sites), running = new Map();
  try {
    while (!stopped()) {
      while (running.size < concurrency && !stopped()) {
        const lane = lanes.find(lane => lane.items.length && !running.has(lane));
        if (!lane) break;
        const {plan} = lane.items.shift();
        const work = collectBook(plan, lane.pacing).catch(error => { fatal ||= error; }).finally(() => running.delete(lane));
        running.set(lane, work);
      }
      if (!running.size) break;
      await Promise.race(running.values());
    }
  } finally { await Promise.all(running.values()); onClient(null); }
  if (fatal) throw fatal;
  batch.stopped = stopped() || batch.items.some(item => item.state === 'stopped');
  for (const item of batch.items) if (item.state === 'pending') Object.assign(item, {state: 'stopped', message: '本轮尚未开始，再次点击适配采集可继续'});
  batch.finishedAt = new Date().toISOString(); publish();
  return batch;
}
