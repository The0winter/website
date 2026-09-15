import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

// Kept self-contained so the same logic runs in isolated API tests and on VPS.
export async function inspectLibraryBook(job, {Book, Chapter, bodyHash}) {
  const fail = message => { throw Object.assign(Error(message), {publicMessage: message}); };
  const matches = await Book.find({sourceUrl: job.sourceUrl}).limit(2).lean();
  if (matches.length > 1) fail('网站存在多个相同来源的作品，请先核对');
  const book = matches[0];
  if (!book) {
    const similar = await Book.find({title: job.title, author: job.author}).select('_id sourceUrl').limit(2).lean();
    if (similar.length) fail('网站已有同名同作者的其他来源版本，请先核对来源绑定，避免重复建书');
    return {book: null, chapters: []};
  }
  if (!book.importManaged || book.author_id || book.deletedAt) fail('网站作品已下架或归属不允许自动导入，请先核对');
  const chapters = await Chapter.find({bookId: book._id}).select('chapter_number title content contentSha256 sourceUrl deletedAt').sort({chapter_number: 1}).lean();
  const summaries = chapters.map(c => ({number: c.chapter_number, title: c.title, link: c.sourceUrl, deleted: !!c.deletedAt,
    hash: typeof c.content === 'string' ? bodyHash(c.content) : c.contentSha256}));
  return {book: Object.fromEntries(['title', 'author', 'sourceUrl', 'description', 'category', 'status'].map(key => [key, book[key]])), bookId: String(book._id), chapters: summaries};
}

export async function applyLibraryBatches(job, {send, emit}) {
  let cursor = 0, checked = 0, failure;
  // Read-only checks may overlap. Drain them all before writing or reporting a
  // failure. Commits for one book remain ordered to avoid transaction conflicts.
  await Promise.all(Array.from({length: Math.min(4, job.batches.length)}, async () => {
    while (!failure && cursor < job.batches.length) {
      const batch = job.batches[cursor++];
      try {
        await send({...batch, missingOnly: true}, true);
        emit({type: 'progress', stage: 'preflight', batch: ++checked, batches: job.batches.length, added: 0});
      } catch (error) { failure ||= error; }
    }
  }));
  if (failure) throw failure;
  if (job.mode === 'preflight') return {validated: true};
  let added = 0, bookId;
  for (const [index, batch] of job.batches.entries()) {
    const result = await send({...batch, missingOnly: true}, false);
    added += result.inserted || 0; bookId = result.bookId;
    emit({type: 'progress', stage: 'apply', batch: index + 1, batches: job.batches.length, added});
  }
  return {added, bookId};
}

// Executed through the existing SSH identity against the active release, like
// upload-cover.mjs. Credentials stay on the VPS; all writes use the import API.
async function remoteWorker(job, inspectBook, applyBatches) {
  const path = await import('node:path'), {pathToFileURL} = await import('node:url');
  const crypto = await import('node:crypto');
  process.chdir('/srv/test1/current/server');
  const load = name => import(pathToFileURL(path.resolve(name)).href);
  const emit = value => console.log(JSON.stringify(value));
  let mongoose, stage = '读取网站配置', quotaExceeded = false;
  const fail = (message, fatal = false) => { throw Object.assign(Error(message), {publicMessage: message, fatal}); };
  try {
    if (job.mode === 'inspect') {
      mongoose = (await load('node_modules/mongoose/index.js')).default;
      stage = '连接网站数据库';
      await (await load('database/index.js')).connectDatabase();
      const Book = (await load('models/Book.js')).default, Chapter = (await load('models/Chapter.js')).default;
      stage = '核对网站书籍';
      // The driver deliberately suppresses remote error details. Detect only
      // quota exhaustion here so a whole library does not hammer a blocked D1.
      const transport = mongoose.connection.transport;
      if (transport?.remote && transport.fetcher) {
        const fetcher = transport.fetcher;
        transport.fetcher = async (...args) => {
          const response = await fetcher(...args);
          if (!response.ok) {
            const data = await response.clone().json().catch(() => ({}));
            quotaExceeded ||= data.errors?.some(error => /exceeded.*daily.*(?:row|read|write).*limit/i.test(error.message || '')) || false;
          }
          return response;
        };
      }
      const result = await inspectBook(job, {Book, Chapter, bodyHash: content => crypto.createHash('sha256').update(content).digest('hex')});
      emit({type: 'result', result});
      return;
    }
    if (!['apply', 'preflight'].includes(job.mode) || !Array.isArray(job.batches) || !job.batches.length) fail('同步参数无效');
    if (process.env.WRITE_MODE !== 'readwrite') fail('网站处于只读维护状态，请稍后重试', true);
    const secret = process.env.IMPORT_SECRET;
    if (!secret || secret.length < 32) fail('服务器导入配置不可用', true);
    stage = '上传书籍';
    async function send(batch, dryRun) {
      for (let attempt = 0; attempt < 3; attempt++) {
        let response;
        try {
          response = await fetch('http://127.0.0.1:5000/api/admin/upload-book', {method: 'POST', headers: {'content-type': 'application/json', 'x-import-secret': secret},
            body: JSON.stringify({...batch, dryRun}), signal: AbortSignal.timeout(120000)});
        } catch {}
        if (response?.ok) return response.json();
        if (response && response.status < 500 && response.status !== 429) {
          const data = await response.json().catch(() => ({}));
          fail(`网站拒绝上传（HTTP ${response.status}）：${String(data.error || '请核对书籍和章节').slice(0, 300)}`, [401, 403].includes(response.status));
        }
        if (attempt === 2) fail('网站暂时无法写入，已成功的批次保留，再次上传可续传', true);
        await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
      }
    }
    emit({type: 'result', result: await applyBatches(job, {send, emit})});
  } catch (error) {
    const code = /^[A-Z_0-9]+$/.test(error.code || '') ? `（${error.code}）` : '';
    emit({type: 'error', fatal: quotaExceeded || !!error.fatal || !error.publicMessage, error: quotaExceeded ? '网站 D1 今日额度已用尽，本轮上传已停止；额度恢复后再次点击“上传书库”即可重试' : error.publicMessage || `${stage}失败${code}，请检查服务器连接和导入服务；已完成批次保留`});
    process.exitCode = 1;
  } finally { if (mongoose) await mongoose.disconnect(); }
}

export function createVpsLibraryTransport({host = 'ubuntu@51.79.242.0', identity = path.join(os.homedir(), '.ssh', 'ovh_website_ed25519'), spawnProcess = spawn} = {}) {
  if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*@[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(host)) throw Error('SSH 主机无效');
  return (job, {signal, onProgress = () => {}} = {}) => new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Error('上传已停止，已完成批次保留'));
    const command = 'sudo -n /opt/node-v22.23.2-linux-x64/bin/node --env-file=/etc/test1/api.env --input-type=module';
    const child = spawnProcess('ssh', ['-i', identity, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2', host, command], {stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true});
    let buffer = '', result, failure, timer, fatal = true;
    const abort = () => { failure = '上传已停止，已完成批次保留；再次上传会重新核对网站'; child.kill(); };
    const resetTimer = () => { clearTimeout(timer); timer = setTimeout(() => { failure = '网站响应超时，已完成批次保留；请再次上传核对'; child.kill(); }, 420000); };
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    signal?.addEventListener('abort', abort, {once: true}); resetTimer();
    child.stderr.resume(); // Never expose remote diagnostics or environment values.
    child.stdin.on('error', () => {});
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      resetTimer(); buffer += chunk;
      if (buffer.length > 32 * 1024 * 1024) { failure = '网站同步响应过大'; child.kill(); return; }
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        let message; try { message = JSON.parse(line); } catch { continue; }
        if (message.type === 'result') result = message.result;
        if (message.type === 'error') { failure = message.error; fatal = !!message.fatal; }
        if (message.type === 'progress') onProgress(message);
      }
    });
    child.once('error', () => { cleanup(); reject(Object.assign(Error('无法启动 SSH，请检查本机连接工具和网站密钥'), {fatal: true})); });
    child.once('close', code => { cleanup(); failure || code !== 0 || !result ? reject(Object.assign(Error(failure || '无法连接网站，请检查网络、SSH 密钥和服务器权限'), {fatal})) : resolve(result); });
    child.stdin.end(`(${remoteWorker.toString()})(${JSON.stringify(job)},${inspectLibraryBook.toString()},${applyLibraryBatches.toString()});`);
  });
}
