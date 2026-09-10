import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {fork, spawn} from 'node:child_process';
import {defaultStateDir, projectRoot} from '../core.mjs';
import {readJson, atomicWrite} from '../storage.mjs';
import {loadSites, readSettings, rememberWebsite, searchBooks, resolveBook} from './sources.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicFiles = {'/': ['index.html', 'text/html'], '/app.css': ['app.css', 'text/css'], '/app.js': ['app.js', 'text/javascript'], '/icon.svg': ['icon.svg', 'image/svg+xml']};
const busy = task => ['search', 'resolving', 'probe', 'download', 'pausing'].includes(task.phase);
function visibleReport(report) {
  if (!report) return null;
  return Object.fromEntries(['title', 'author', 'jobId', 'downloaded', 'expected', 'errors', 'warnings', 'structuralPass', 'completeAgainstSource', 'exportFile', 'summaryFile', 'reportFile', 'limitation'].map(key => [key, report[key]]));
}
function openLocal(target) {
  const child = process.platform === 'win32'
    ? spawn('explorer.exe', [target], {windowsHide: true, stdio: 'ignore'})
    : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [target], {stdio: 'ignore'});
  child.on('error', () => {});
}

export async function createDesktop({stateDir = defaultStateDir, outputDir = path.join(projectRoot, 'downloads'), port = 0, sitesDirectory, open = openLocal, onFocus = () => {}, findBooks = searchBooks, prepareBook = resolveBook} = {}) {
  const token = randomBytes(32).toString('hex');
  let worker, closing = false, selectedBook = null, candidates = [], lastProgress = 0;
  let task = readJson(path.join(stateDir, 'desktop-last-task.json'), {phase: 'idle', message: '准备好后，先查找你的书。'});
  // An interrupted process can be resumed from crawler checkpoints, never shown as running.
  if (busy(task)) task = {...task, phase: 'paused', message: '上次任务已停止。重新查找这本书即可继续。'};
  function save() { atomicWrite(path.join(stateDir, 'desktop-last-task.json'), task); }
  function update(values) { task = {...task, ...values}; save(); }
  function sites() { return loadSites(sitesDirectory); }
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
        return respond(200, {settings: readSettings(stateDir), sites: loaded.sites.map(({id, name, home, hosts}) => ({id, name, home, hosts})), adapterErrors: loaded.errors, task, candidates, outputDir});
      }
      if (req.method !== 'POST') return respond(405, {error: '请求方式无效'});
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 12000) return respond(413, {error: '输入过长'}); }
      const input = raw ? JSON.parse(raw) : {};
      if (closing) return respond(409, {error: '程序正在退出'});
      if (pathname === '/api/focus') { await onFocus(); return respond(200, {ok: true}); }
      if (pathname === '/api/remember') return respond(200, rememberWebsite(stateDir, input.website));
      if (pathname === '/api/search') {
        if (busy(task)) return respond(409, {error: '请先暂停当前任务'});
        const settings = rememberWebsite(stateDir, input.website);
        candidates = []; selectedBook = null;
        task = {phase: 'search', message: '正在站内查找并核对书名…', title: input.title, author: input.author}; save();
        try {
          candidates = await findBooks({website: input.website, title: input.title, author: input.author, stateDir, sites: sites().sites, shouldStop: () => closing, onStatus: status => update({message: status.message})});
          update({phase: 'ready', message: candidates.length ? `找到 ${candidates.length} 本同名书，请核对作者。` : '未找到匹配的书。可核对书名、作者，或粘贴该书的详情页地址。'});
          return respond(200, {candidates, settings, task});
        } catch (error) { update({phase: 'error', message: error.message}); throw error; }
      }
      if (pathname === '/api/start') {
        if (busy(task) || worker) return respond(409, {error: '当前任务还在处理，请稍后再试'});
        selectedBook = candidates.find(book => book.url === input.url);
        if (!selectedBook) throw Error('请先查找并选择书籍');
        update({phase: 'resolving', message: '正在读取目录配置…', title: selectedBook.title, author: selectedBook.author, sourceUrl: selectedBook.url, report: null, progress: null, probeOnly: input.probeOnly === true});
        let spec;
        try { spec = await prepareBook({...selectedBook, stateDir, sites: sites().sites, shouldStop: () => closing, onStatus: status => update({message: status.message})}); }
        catch (error) { update({phase: 'error', message: error.message}); throw error; }
        if (closing) { update({phase: 'paused', message: '任务已停止，下次可继续。'}); return respond(409, {error: '程序正在退出'}); }
        worker = fork(path.join(here, 'worker.mjs'), [], {windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc']});
        let workerError = '';
        worker.stderr.on('data', chunk => { workerError = (workerError + chunk.toString()).slice(-1500); });
        worker.on('message', message => {
          if (message.type === 'status' && task.phase !== 'pausing') update({message: message.message});
          if (message.type === 'phase') update({phase: task.phase === 'pausing' ? 'pausing' : message.phase, message: message.phase === 'probe' ? '先抽样检查目录、正文和编码…' : '正在下载章节，完成后检查并导出…', progress: null});
          if (message.type === 'progress') {
            task.progress = message;
            if (Date.now() - lastProgress > 1000) { save(); lastProgress = Date.now(); }
          }
          if (message.type === 'done') {
            const report = visibleReport(message.report), complete = !!report.exportFile;
            update({phase: message.paused ? 'paused' : complete ? 'complete' : message.report.structuralPass && task.probeOnly ? 'probed' : 'error', report,
              message: message.paused ? '已暂停，完成的章节已保存。' : complete ? '下载完成，已生成书籍文件和质量报告。' : message.report.structuralPass && task.probeOnly ? '试采通过，可以继续下载整本。' : `本次未导出完整书籍：${message.report.failures?.[0]?.error || '检查发现异常，详见质量报告。'}`});
          }
          if (message.type === 'error') update({phase: 'error', message: message.error});
        });
        worker.on('error', error => update({phase: 'error', message: error.message}));
        worker.on('exit', () => {
          worker = null;
          if (busy(task)) update({phase: 'error', message: `采集进程意外停止。已完成章节可续传。${workerError.slice(-300)}`});
        });
        worker.send({type: 'start', spec, stateDir, outputDir, probeOnly: input.probeOnly === true});
        return respond(200, {ok: true});
      }
      if (pathname === '/api/pause') {
        if (worker?.connected) { worker.send({type: 'pause'}); update({phase: 'pausing', message: '正在保存当前章节，请稍候…'}); }
        return respond(200, {ok: true});
      }
      if (pathname === '/api/open') {
        let target;
        if (input.kind === 'folder') { fs.mkdirSync(outputDir, {recursive: true}); target = outputDir; }
        else if (input.kind === 'report' && /^[a-f0-9]{20}$/.test(task.report?.jobId)) target = path.join(stateDir, 'jobs', task.report.jobId);
        else throw Error('暂无可打开的结果');
        if (!fs.existsSync(target)) throw Error('结果目录不存在');
        open(target);
        return respond(200, {ok: true});
      }
      return respond(404, {error: '操作不存在'});
    } catch (error) { if (!res.headersSent) respond(400, {error: error.message}); else res.end(); }
  });
  server.requestTimeout = 300000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return {server, token, baseUrl, url: `${baseUrl}/#${token}`, state: () => task, async close() {
    closing = true;
    if (worker) {
      const current = worker;
      if (current.connected) current.send({type: 'pause'});
      await new Promise(resolve => current.once('exit', resolve));
    }
    await new Promise(resolve => server.close(resolve));
  }};
}
