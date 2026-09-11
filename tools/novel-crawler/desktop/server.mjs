import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {fork} from 'node:child_process';
import {defaultStateDir, projectRoot, localBookState} from '../core.mjs';
import {readJson, atomicWrite} from '../storage.mjs';
import {loadSites, readSettings, rememberWebsite, searchBooks, resolveBook, specForBook, normalizeWebsite} from './sources.mjs';
import {failureDetails} from '../diagnostics.mjs';
import {clearBrowserSession} from '../browser-session.mjs';
import {openLocal} from './open-local.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicFiles = {'/': ['index.html', 'text/html'], '/app.css': ['app.css', 'text/css'], '/app.js': ['app.js', 'text/javascript'], '/icon.svg': ['icon.svg', 'image/svg+xml']};
const busy = task => ['search', 'resolving', 'probe', 'download', 'pausing', 'stopping'].includes(task.phase);
function visibleReport(report) {
  if (!report) return null;
  return {...Object.fromEntries(['title', 'author', 'description', 'descriptionStatus', 'jobId', 'mode', 'checkedAt', 'downloaded', 'expected', 'errors', 'warnings', 'structuralPass', 'completeAgainstSource', 'exportFile', 'summaryFile', 'reportFile', 'limitation', 'reusedExport'].map(key => [key, report[key]])), failures: (report.failures || []).map(item => failureDetails(item, item))};
}
export async function createDesktop({stateDir = defaultStateDir, outputDir = path.join(projectRoot, 'downloads'), port = 0, sitesDirectory, open = openLocal, onFocus = () => {}, findBooks = searchBooks, prepareBook = resolveBook} = {}) {
  const token = randomBytes(32).toString('hex');
  let worker, operation, stopRequested = false, closing = false, selectedBook = null, candidates = [], lastProgress = 0;
  const resolvedSpecs = new Map();
  let task = readJson(path.join(stateDir, 'desktop-last-task.json'), {phase: 'idle', message: '准备好后，先查找你的书。'});
  // Older desktop summaries omitted failures; recover them from the original report.
  if (task.report && /^[a-f0-9]{20}$/.test(task.report.jobId) && !task.report.failures) {
    const mode = task.progress?.mode === 'probe' ? 'probe' : 'download';
    task.report = visibleReport(readJson(path.join(stateDir, 'jobs', task.report.jobId, `${mode}-report.json`), task.report));
  }
  // An interrupted process can be resumed from crawler checkpoints, never shown as running.
  if (busy(task)) task = {...task, phase: 'paused', message: '上次任务已停止。重新查找这本书即可继续。'};
  function save() { atomicWrite(path.join(stateDir, 'desktop-last-task.json'), task); }
  function update(values) { task = {...task, ...(Object.hasOwn(values, 'phase') ? {action: null, actionUrl: null, actionDeadline: null, failure: null} : {}), ...values}; save(); }
  function sites() { return loadSites(sitesDirectory); }
  function withLocalState(book) {
    try { return {...book, local: localBookState(resolvedSpecs.get(book.url) || specForBook(book, sites().sites), {stateDir, outputDir})}; }
    catch { return {...book, local: {state: 'unknown', saved: 0, total: 0, message: '开始采集时核对本地进度'}}; }
  }
  function stoppedTask() {
    candidates = candidates.map(withLocalState);
    update({phase: 'stopped', message: '已停止，采集页面已关闭；已保存的章节保留，下次会接着补齐。'});
  }
  const statusValues = status => ({message: status.message, action: status.kind, actionUrl: status.url || null, actionDeadline: status.deadline || null});
  const controls = controller => ({signal: controller.signal, shouldStop: () => closing || controller.signal.aborted, onStatus: status => { if (!controller.signal.aborted) update(statusValues(status)); }});
  const server = http.createServer(async (req, res) => {
    const expectedHost = `127.0.0.1:${server.address().port}`;
    const respond = (status, value) => { res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'}); res.end(JSON.stringify(value)); };
    try {
      if (req.headers.host !== expectedHost) return respond(403, {error: '访问地址无效'});
      const pathname = new URL(req.url, `http://${expectedHost}`).pathname;
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
      if (publicFiles[pathname] && req.method === 'GET') {
        const [file, type] = publicFiles[pathname];
        res.writeHead(200, {'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store'});
        return res.end(fs.readFileSync(path.join(here, file)));
      }
      if (!pathname.startsWith('/api/')) return respond(404, {error: '页面不存在'});
      if (req.headers['x-desktop-token'] !== token || (req.headers.origin && req.headers.origin !== `http://${expectedHost}`)) return respond(403, {error: '窗口已过期，请重新打开程序'});
      if (pathname === '/api/state' && req.method === 'GET') {
        const loaded = sites();
        return respond(200, {settings: readSettings(stateDir), sites: loaded.sites.map(({id, name, home, hosts, spec, search, book}) => ({id, name, home, hosts, remembersLogin: [spec.transport, search?.transport, book?.transport].includes('browser')})), adapterErrors: loaded.errors, task: {...task, canShowBrowser: !!worker?.connected && busy(task) && ['login', 'verification'].includes(task.action)}, candidates, outputDir});
      }
      if (req.method !== 'POST') return respond(405, {error: '请求方式无效'});
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 12000) return respond(413, {error: '输入过长'}); }
      const input = raw ? JSON.parse(raw) : {};
      if (closing) return respond(409, {error: '程序正在退出'});
      if (pathname === '/api/focus') { await onFocus(); return respond(200, {ok: true}); }
      if (pathname === '/api/remember') return respond(200, rememberWebsite(stateDir, input.website));
      if (pathname === '/api/clear-login') {
        if (busy(task) || worker || operation) return respond(409, {error: '请先停止当前任务，等待采集窗口关闭后再清除登录'});
        const host = new URL(normalizeWebsite(input.website)).hostname;
        const site = sites().sites.find(item => item.hosts.includes(host));
        if (!site) throw Error('请先选择一个已适配的网站');
        clearBrowserSession(stateDir, site.home);
        return respond(200, {message: `已清除${site.name}在拾页中的登录状态，需要登录时会重新提示；已保存章节保留。`});
      }
      if (pathname === '/api/search') {
        if (busy(task) || worker) return respond(409, {error: '请先停止当前任务，等待进度保存完成'});
        stopRequested = false;
        const settings = rememberWebsite(stateDir, input.website);
        const controller = new AbortController(); operation = controller;
        candidates = []; selectedBook = null;
        task = {phase: 'search', message: '正在站内查找并核对书名…', title: input.title, author: input.author}; save();
        try {
          const found = await findBooks({website: input.website, title: input.title, author: input.author, stateDir, sites: sites().sites, ...controls(controller)});
          if (controller.signal.aborted) { stoppedTask(); return respond(200, {candidates: [], settings, task}); }
          candidates = found.map(withLocalState);
          update({phase: 'ready', message: candidates.length ? `找到 ${candidates.length} 本同名书，请核对作者。` : '未找到匹配的书。可核对书名、作者，或粘贴该书的详情页地址。'});
          return respond(200, {candidates, settings, task});
        } catch (error) {
          if (controller.signal.aborted) { stoppedTask(); return respond(200, {candidates: [], settings, task}); }
          update({phase: 'error', message: error.message, failure: failureDetails(error)}); throw error;
        } finally { if (operation === controller) operation = null; }
      }
      if (pathname === '/api/start') {
        if (busy(task) || worker) return respond(409, {error: '当前任务还在处理，请稍后再试'});
        selectedBook = candidates.find(book => book.url === input.url);
        if (!selectedBook) throw Error('请先查找并选择书籍');
        stopRequested = false;
        const controller = new AbortController(); operation = controller;
        update({phase: 'resolving', message: '正在读取书籍信息…', title: selectedBook.title, author: selectedBook.author, sourceUrl: selectedBook.url, description: null, report: null, progress: null, probeOnly: input.probeOnly === true});
        let spec;
        try { spec = await prepareBook({...selectedBook, stateDir, sites: sites().sites, ...controls(controller)}); }
        catch (error) {
          if (controller.signal.aborted) { stoppedTask(); return respond(200, {stopped: true}); }
          update({phase: 'error', message: error.message, failure: failureDetails(error)}); throw error;
        } finally { if (operation === controller) operation = null; }
        if (closing || controller.signal.aborted) { stoppedTask(); return respond(200, {stopped: true}); }
        resolvedSpecs.set(selectedBook.url, spec);
        update({local: localBookState(spec, {stateDir, outputDir}), description: spec.description || null});
        worker = fork(path.join(here, 'worker.mjs'), [], {windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc']});
        let workerError = '';
        worker.stderr.on('data', chunk => { workerError = (workerError + chunk.toString()).slice(-1500); });
        worker.on('message', message => {
          if (message.type === 'status' && !['pausing', 'stopping'].includes(task.phase)) update(statusValues(message));
          if (message.type === 'phase' && !['pausing', 'stopping'].includes(task.phase)) update({phase: message.phase, message: `${task.local?.saved ? `已保存 ${task.local.saved} 章，本次会跳过已有正文。` : ''}${message.phase === 'probe' ? '先抽样检查目录、正文和编码…' : '正在补齐章节，完成后检查并导出…'}`, progress: null});
          if (message.type === 'progress') {
            task.progress = message;
            if (Date.now() - lastProgress > 1000) { save(); lastProgress = Date.now(); }
          }
          if (message.type === 'done') {
            const report = visibleReport(message.report), complete = !!report.exportFile;
            update({phase: message.stopped || stopRequested ? 'stopped' : message.paused ? 'paused' : complete ? 'complete' : message.report.structuralPass && task.probeOnly ? 'probed' : 'error', report,
              message: message.stopped || stopRequested ? '已停止，采集页面已关闭；已保存的章节保留，下次会接着补齐。' : message.paused ? '已暂停，完成的章节已保存。' : complete ? report.reusedExport ? '已下载过这本书，本次目录没有新增章节；已复用原文件，没有重复下载正文。' : '下载完成，已生成书籍文件和质量报告。' : message.report.structuralPass && task.probeOnly ? '试采通过，可以继续下载整本。' : `本次未导出完整书籍：${message.report.failures?.[0]?.error || '检查发现异常，详见质量报告。'}`});
            candidates = candidates.map(withLocalState);
          }
          if (message.type === 'error') { if (stopRequested) stoppedTask(); else update({phase: 'error', message: message.error, failure: message.failure || failureDetails(message)}); }
        });
        worker.on('error', error => { if (stopRequested) stoppedTask(); else update({phase: 'error', message: error.message}); });
        worker.on('exit', () => {
          worker = null;
          if (busy(task)) { if (stopRequested) stoppedTask(); else update({phase: 'error', message: `采集进程意外停止。已完成章节可续传。${workerError.slice(-300)}`}); }
        });
        worker.send({type: 'start', spec, stateDir, outputDir, probeOnly: input.probeOnly === true});
        return respond(200, {ok: true});
      }
      if (pathname === '/api/show-browser') {
        if (!worker?.connected || !busy(task) || !['login', 'verification'].includes(task.action)) throw Error('当前没有等待操作的采集窗口');
        const current = worker, requestId = randomBytes(8).toString('hex');
        await new Promise((resolve, reject) => {
          const finish = error => { clearTimeout(timer); current.off('message', received); current.off('exit', exited); error ? reject(Error(error)) : resolve(); };
          const received = message => { if (message.type === 'browser-shown' && message.requestId === requestId) finish(message.error); };
          const exited = () => finish('采集任务已结束，请查看当前状态');
          const timer = setTimeout(() => finish('未能唤起采集窗口，请检查窗口是否已关闭'), 5000);
          current.on('message', received); current.once('exit', exited);
          current.send({type: 'show-browser', requestId}, error => { if (error) finish(error.message); });
        });
        return respond(200, {ok: true});
      }
      if (pathname === '/api/stop') {
        if (!busy(task)) return respond(200, {ok: true});
        stopRequested = true;
        update({phase: 'stopping', message: '正在停止请求并关闭采集页面…'});
        operation?.abort();
        if (worker?.connected) worker.send({type: 'stop'});
        if (!operation && !worker) stoppedTask();
        return respond(200, {ok: true});
      }
      if (pathname === '/api/pause') {
        if (task.phase === 'stopping') return respond(200, {ok: true});
        if (worker?.connected) { worker.send({type: 'pause'}); update({phase: 'pausing', message: '正在保存当前章节，请稍候…'}); }
        return respond(200, {ok: true});
      }
      if (pathname === '/api/open') {
        let target;
        if (input.kind === 'folder') { fs.mkdirSync(outputDir, {recursive: true}); target = outputDir; }
        else if (input.kind === 'report' && /^[a-f0-9]{20}$/.test(task.report?.jobId)) target = path.join(stateDir, 'jobs', task.report.jobId);
        else throw Error('暂无可打开的结果');
        if (!fs.existsSync(target)) throw Error('结果目录不存在');
        target = path.resolve(target);
        const result = await open(target);
        const verified = result?.verified === true;
        return respond(200, {ok: true, path: target, verified, foreground: result?.foreground,
          message: `${verified ? '已显示' : '已请求打开'}${input.kind === 'report' ? '报告' : '下载'}目录${verified && result.foreground === false ? '（可从任务栏切换）' : ''}：${target}`});
      }
      return respond(404, {error: '操作不存在'});
    } catch (error) { if (!res.headersSent) respond(400, {error: error.message}); else res.end(); }
  });
  server.requestTimeout = 300000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return {server, token, baseUrl, url: `${baseUrl}/#${token}`, state: () => task, async close() {
    closing = true;
    stopRequested = true;
    operation?.abort();
    if (worker) {
      const current = worker;
      if (current.connected) current.send({type: 'stop'});
      await new Promise(resolve => current.once('exit', resolve));
    }
    await new Promise(resolve => server.close(resolve));
  }};
}
