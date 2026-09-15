// One private SSH session per desktop run; credentials never leave the VPS.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {createInterface} from 'node:readline';
import mongoose from '../server/node_modules/mongoose/index.js';
import {connectDatabase} from '../server/database/index.js';
import Book from '../server/models/Book.js';
import Chapter from '../server/models/Chapter.js';
import {inspectLibraryHeaders, inspectVersionedLibraryBook} from './library-sync-inspect.mjs';
import {applyLibraryBatches} from './library-sync-vps.mjs';

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
process.chdir(fs.realpathSync(new URL('../server/', import.meta.url)));
const scope = digest(JSON.stringify([1, fs.realpathSync(new URL('..', import.meta.url)),
  process.env.DATABASE_URL || process.env.MONGO_URI, process.env.D1_DATABASE_ID, process.env.LIBRARY_SYNC_EPOCH || '']));
const models = {Book, Chapter, bodyHash: digest};
let connected = false;
const fail = (message, fatal = false) => { throw Object.assign(Error(message), {publicMessage: message, fatal}); };
async function send(batch, dryRun) {
  const secret = process.env.IMPORT_SECRET;
  if (process.env.WRITE_MODE !== 'readwrite') fail('网站处于只读维护状态，请稍后重试', true);
  if (!secret || secret.length < 32) fail('服务器导入配置不可用', true);
  for (let attempt = 0; attempt < 3; attempt++) {
    let response;
    try { response = await fetch('http://127.0.0.1:5000/api/admin/upload-book', {method: 'POST',
      headers: {'content-type': 'application/json', 'x-import-secret': secret}, body: JSON.stringify({...batch, dryRun}), signal: AbortSignal.timeout(120000)}); } catch {}
    if (response?.ok) return response.json();
    if (response && response.status < 500 && response.status !== 429) {
      const data = await response.json().catch(() => ({}));
      fail(`网站拒绝上传（HTTP ${response.status}）：${String(data.error || '请核对书籍和章节').slice(0, 300)}`, [401, 403].includes(response.status));
    }
    if (attempt === 2) fail('网站暂时无法写入，已成功的批次保留，再次上传可续传', true);
    await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
  }
}

const lines = createInterface({input: process.stdin, crlfDelay: Infinity});
try {
  for await (const line of lines) {
    let id;
    const emit = value => process.stdout.write(JSON.stringify({protocol: 1, id, ...value}) + '\n');
    try {
      const message = JSON.parse(line); id = message.id;
      if (message.protocol !== 1 || !Number.isSafeInteger(id)) fail('同步协议不兼容，请更新采集窗口', true);
      const job = message.job;
      let result;
      if (['headers', 'inspect'].includes(job?.mode)) {
        if (!connected) { await connectDatabase(); connected = true; }
        result = job.mode === 'headers' ? {headers: await inspectLibraryHeaders(job.identities, models)} : await inspectVersionedLibraryBook(job, models);
      } else if (['apply', 'preflight'].includes(job?.mode) && Array.isArray(job.batches) && job.batches.length) {
        result = await applyLibraryBatches(job, {send, emit});
      } else fail('同步参数无效');
      emit({type: 'result', result: {...result, scope}});
    } catch (error) {
      emit({type: 'error', fatal: !!error.fatal || !error.publicMessage,
        error: error.publicMessage || '网站核对失败，请检查服务器连接和数据库；已完成批次保留'});
      if (!error.publicMessage || error.fatal) break;
    }
  }
} finally { lines.close(); await mongoose.disconnect(); }
