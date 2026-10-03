import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';

// A deployment can stop the API for longer than the worker's short HTTP retry
// window. Reconnect only for transient outages and replay the missing-only job;
// the uploader then reads back the book before accepting it as synchronized.
export function createVpsLibrarySession({wait = (ms, signal) => sleep(ms, undefined, {signal}), ...options} = {}) {
  let session = openVpsLibrarySession(options), busy = false;
  const lifetime = new AbortController();
  const transient = new Set(['网站暂时无法写入，已成功的批次保留，再次上传可续传', '网站连接中断，已完成批次保留',
    '网站连接已关闭，已完成批次保留；请再次上传核对', '网站连接已关闭，请再次上传核对', '网站响应超时，已完成批次保留']);
  const send = async (job, {signal, onProgress = () => {}} = {}) => {
    if (busy) throw Error('当前网站核对尚未完成');
    const combined = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
    if (combined.aborted) throw Error('上传已停止，已完成批次保留');
    const replayable = (!options.worker || options.worker === 'library-sync-worker.mjs') && ['headers', 'inspect', 'apply', 'preflight'].includes(job.mode);
    const delays = [5000, 15000, 30000, 60000];
    busy = true;
    try {
      for (let attempt = 0; ; attempt++) {
        try { return await session(job, {signal: combined, onProgress}); }
        catch (error) {
          if (combined.aborted) throw Error('上传已停止，已完成批次保留');
          if (!replayable || !error.fatal || !transient.has(error.message) || attempt === delays.length) throw error;
          await session.close();
          onProgress({stage: 'retry', attempt: attempt + 1, delayMs: delays[attempt]});
          try { await wait(delays[attempt], combined); }
          catch (waitError) { if (combined.aborted) throw Error('上传已停止，已完成批次保留'); throw waitError; }
          if (combined.aborted) throw Error('上传已停止，已完成批次保留');
          session = openVpsLibrarySession(options);
        }
      }
    } finally { busy = false; }
  };
  send.batchHeaders = true;
  send.close = async () => { lifetime.abort(); await session.close(); };
  return send;
}

function openVpsLibrarySession({host = 'ubuntu@51.79.242.0', identity = path.join(os.homedir(), '.ssh', 'ovh_website_ed25519'), spawnProcess = spawn, worker = 'library-sync-worker.mjs'} = {}) {
  if (!['library-sync-worker.mjs', 'library-cleaning-worker.mjs'].includes(worker)) throw Error('网站同步入口无效');
  if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*@[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(host)) throw Error('SSH 主机无效');
  let child, active, buffer = '', serial = 0, closed = false, exited;
  function settle(error, result) {
    if (!active) return;
    const request = active; active = null;
    clearTimeout(request.timer); request.signal?.removeEventListener('abort', request.abort);
    error ? request.reject(error) : request.resolve(result);
  }
  function fail(message) {
    closed = true;
    settle(Object.assign(Error(message), {fatal: true})); child?.kill();
  }
  function start() {
    const command = `sudo -n /opt/node-v22.23.2-linux-x64/bin/node --env-file=/etc/test1/api.env /srv/test1/current/infra/${worker}`;
    child = spawnProcess('ssh', ['-i', identity, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2', host, command], {stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true});
    exited = new Promise(resolve => child.once('close', resolve));
    child.stderr.resume(); child.stdin.on('error', () => fail('网站连接中断，已完成批次保留'));
    child.once('error', () => fail('无法启动 SSH，请检查本机连接工具和网站密钥'));
    child.once('close', () => { closed = true; settle(Object.assign(Error('网站连接已关闭，已完成批次保留；请再次上传核对'), {fatal: true})); });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 32 * 1024 * 1024) return fail('网站同步响应过大');
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        let message; try { message = JSON.parse(line); } catch { continue; }
        if (message.protocol !== 1 || message.id !== active?.id) continue;
        active.resetTimer();
        if (message.type === 'progress') { try { active.onProgress(message); } catch { fail('保存上传进度失败，已完成批次保留'); } }
        else if (message.type === 'error') {
          const error = Object.assign(Error(message.error), {fatal: !!message.fatal, ...(message.databaseUsage ? {databaseUsage:message.databaseUsage} : {})});
          settle(error); if (error.fatal) { closed = true; child.kill(); }
        } else if (message.type === 'result') settle(null, message.result);
      }
    });
  }
  const send = (job, {signal, onProgress = () => {}} = {}) => new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Error('上传已停止，已完成批次保留'));
    if (closed) return reject(Object.assign(Error('网站连接已关闭，请再次上传核对'), {fatal: true}));
    if (active) return reject(Error('当前网站核对尚未完成'));
    const request = {id: ++serial, signal, onProgress, resolve, reject,
      abort: () => fail('上传已停止，已完成批次保留；再次上传会重新核对网站'),
      resetTimer: () => { clearTimeout(request.timer); request.timer = setTimeout(() => fail('网站响应超时，已完成批次保留'), 420000); }};
    active = request; signal?.addEventListener('abort', request.abort, {once: true}); request.resetTimer();
    try { if (!child) start(); child.stdin.write(JSON.stringify({protocol: 1, id: request.id, job}) + '\n'); }
    catch { fail('无法启动网站同步连接'); }
  });
  send.batchHeaders = true;
  send.close = async () => {
    if (!child) { closed = true; return; }
    closed = true; settle(Object.assign(Error('上传已停止，已完成批次保留'), {fatal: true})); child.stdin.end();
    const timer = setTimeout(() => child.kill(), 5000);
    try { await exited; } finally { clearTimeout(timer); }
  };
  return send;
}
