import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {prepareImport} from '../../../infra/import-plan.mjs';
import {createVpsLibrarySession} from '../../../infra/library-sync-session.mjs';
import {planLibrary} from './library.mjs';
import {hash, atomicWrite} from '../storage.mjs';
import {fileFingerprint, uploadCheckpoints} from './upload-cache.mjs';
import {hasBookCategory, normalizeBookCategory} from '../categories.mjs';
import {reviewedUploadIdentity} from './upload-identity.mjs';

const bodyHash = content => crypto.createHash('sha256').update(content).digest('hex');
const normalize = value => String(value || '').normalize('NFKC').trim();
const metadataKeys = ['sourceUrl', 'title', 'author', 'authorSourceUrl', 'category', 'description', 'status'];

export const uploadBatchLimits = {chapters: 200, bytes: 4 * 1024 * 1024};

export function planUpload(book, remote, prepared = prepareImport(book)) {
  const chapters = prepared.flatMap(batch => batch.chapters);
  // Covers have their own verified upload workflow. Absent or stale crawler
  // cover fields must never replace a managed website cover.
  const metadata = Object.fromEntries(metadataKeys.filter(key => book[key] !== undefined).map(key => [key, book[key]]));
  // Routine uploads fill missing categories. A changed existing category needs
  // explicit metadata review, including when a stale local file says 未分类.
  const category = normalizeBookCategory(metadata.category);
  if (hasBookCategory(remote.book?.category) || !category) delete metadata.category;
  else metadata.category = category;
  if (remote.book && ['sourceUrl', 'title', 'author'].some(key => normalize(remote.book[key]) !== normalize(book[key]))) throw Error('网站书籍身份与本地文件不一致，请核对书名、作者和稳定来源');
  const existing = new Map(remote.chapters.map(chapter => [chapter.number, chapter]));
  if (existing.size !== remote.chapters.length) throw Error('网站存在重复章号，请先核对');
  const pending = [];
  for (const chapter of chapters) {
    const previous = existing.get(chapter.chapter_number);
    if (!previous) { pending.push(chapter); continue; }
    if (previous.deleted || previous.title !== chapter.title || previous.hash !== bodyHash(chapter.content) || (previous.link && chapter.link && previous.link !== chapter.link)) {
      throw Error(`第 ${chapter.chapter_number} 章与网站已有内容冲突或已下架，已保留网站原章节`);
    }
  }
  const metadataChanged = !!remote.book && ['description', 'category', 'status'].some(key => metadata[key] !== undefined && metadata[key] !== remote.book[key]);
  const uploads = [];
  const overhead = Buffer.byteLength(JSON.stringify({...metadata, chapters: [], missingOnly: true, dryRun: false}));
  let current = [], bytes = overhead;
  for (const chapter of pending) {
    const size = Buffer.byteLength(JSON.stringify(chapter)) + 1;
    if (current.length && (current.length >= uploadBatchLimits.chapters || bytes + size > uploadBatchLimits.bytes)) {
      uploads.push({...metadata, chapters: current}); current = []; bytes = overhead;
    }
    current.push(chapter); bytes += size;
  }
  if (current.length) uploads.push({...metadata, chapters: current});
  if (!uploads.length && metadataChanged) uploads.push({...metadata, chapters: []});
  return {batches: uploads, newBook: !remote.book, expectedAdded: chapters.filter(c => !existing.has(c.chapter_number)).length};
}

export async function uploadLibrary({stateDir, outputDir, signal, shouldStop = () => false, onLibrary = () => {}, onPhase = () => {}, transport = createVpsLibrarySession(), forceFull = false}) {
  const items = planLibrary({stateDir, outputDir, forUpload: true, forceFull});
  const checkpoints = uploadCheckpoints({stateDir, outputDir, forceFull}), headers = new Map();
  const metrics = {headerBatches: 0, fastSkipped: 0, reusedDirectories: 0, fullInspections: 0, deltaInspections: 0};
  let blockedReason;
  const startedAt = new Date().toISOString(), runId = 'upload-' + crypto.randomUUID();
  const stopped = () => !!signal?.aborted || shouldStop();
  const snapshot = () => ({kind: 'upload', startedAt, total: items.length, metrics: {...metrics},
    checked: items.filter(item => ['uploaded', 'unchanged', 'failed', 'completed'].includes(item.state)).length,
    uploaded: items.filter(item => item.state === 'uploaded').length, newBooks: items.filter(item => item.state === 'uploaded' && item.newBook).length,
    unchanged: items.filter(item => item.state === 'unchanged').length, failed: items.filter(item => item.state === 'failed').length,
    completed: items.filter(item => item.state === 'completed').length,
    added: items.reduce((sum, item) => sum + (item.added || 0), 0),
    items: items.map(({file, title, author, url, state, message, added, newBook, bookId}) => ({file, title, author, url, state, message, added, newBook, bookId}))});
  // The desktop persists live progress. Write the per-run report once at the
  // end, avoiding repeated Windows file replacement for every progress event.
  const publish = () => onLibrary(snapshot());
  const inspect = async (identity, extra = {}) => {
    const result = await transport({mode: 'inspect', ...identity, ...extra}, {signal});
    metrics[result.partial ? 'deltaInspections' : 'fullInspections']++;
    return result;
  };
  try {
  // Classify all completed receipts before batching remote headers, so even a
  // completed book later in the queue is excluded from network scans.
  for (const item of items) {
    if (stopped()) break;
    if (item.state !== 'pending') continue;
    try {
      const receipt = checkpoints.completed(item);
      if (receipt && fileFingerprint(path.resolve(outputDir, item.file)) === item.fingerprint) {
        item.state = 'completed'; item.bookId = receipt.bookId;
        item.message = '已完结且已同步，本地未变化，本轮跳过';
      }
    } catch { /* Report missing or changed files in the per-book error handler. */ }
  }
  publish();
  for (const [index, item] of items.entries()) {
    if (index % 20 === 0) await new Promise(resolve => setImmediate(resolve));
    if (stopped()) break;
    if (item.state === 'completed') {
      try {
        if (fileFingerprint(path.resolve(outputDir, item.file)) === item.fingerprint) continue;
      } catch { /* A removed export also needs a fresh plan. */ }
      item.state = 'blocked'; item.message = '排队期间文件被修改或移走，请再次上传重新检查';
    }
    const blocked = item.state === 'blocked' ? item.message : null;
    item.state = 'running'; item.message = '正在核对网站已有书籍和章节…'; onPhase(item); publish();
    try {
      if (blocked) throw Error(blocked);
      if (transport.batchHeaders && !headers.has(item.sourceUrl) && typeof item.sourceUrl === 'string') {
        const identities = items.slice(index, index + 200).filter(row => row === item || row.state === 'pending')
          .filter(row => typeof row.sourceUrl === 'string').map(({sourceUrl, title, author}) => ({sourceUrl, title, author}));
        const batch = await transport({mode: 'headers', identities}, {signal}); metrics.headerBatches++;
        if (!batch.scope || batch.headers?.length !== identities.length) throw Object.assign(Error('网站批量核对结果不完整，请再次上传核对'), {fatal: true});
        for (const row of batch.headers) headers.set(row.sourceUrl, {...row, scope: batch.scope});
      }
      if (stopped()) break;
      const file = path.resolve(outputDir, item.file), fingerprint = fileFingerprint(file);
      if (item.fingerprint && fingerprint !== item.fingerprint) throw Error('排队期间文件被修改，请再次上传重新检查');
      const checkpoint = checkpoints.get(item, headers.get(item.sourceUrl));
      if (checkpoint?.fileHash === item.hash && item.fingerprint) {
        item.bookId = checkpoint.bookId; item.state = 'unchanged'; item.message = '本地与网站版本均未变化，已快速核对';
        metrics.fastSkipped++; publish(); continue;
      }
      const bytes = fs.readFileSync(file);
      if (hash(bytes) !== item.hash || fileFingerprint(file) !== fingerprint) throw Error('排队期间文件被修改，请再次上传重新检查');
      const book = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
      const prepared = prepareImport(book);
      const identity = Object.fromEntries(['sourceUrl', 'title', 'author'].map(key => [key, book[key]]));
      const cached = checkpoint && checkpoints.remote(item, checkpoint);
      const remote = cached || await inspect(identity);
      if (cached) metrics.reusedDirectories++;
      if (stopped()) break;
      const uploadBook = reviewedUploadIdentity(book, remote, stateDir);
      const plan = planUpload(uploadBook, remote, prepared);
      item.newBook = plan.newBook; item.bookId = remote.bookId;
      if (!plan.batches.length) {
        checkpoints.save(item, remote, cached ? checkpoint.verifiedAt : undefined);
        item.state = 'unchanged'; item.message = '网站已同步'; publish(); continue;
      }
      item.message = `正在上传${plan.newBook ? '新书' : '新增内容'}，共 ${plan.expectedAdded} 章…`; publish();
      const result = await transport({mode: 'apply', batches: plan.batches, expectedToken: remote.token}, {signal, onProgress: progress => {
        item.added = progress.added; item.message = progress.stage === 'preflight' ? `上传前检查 ${progress.batch} / ${progress.batches} 批` : `已上传 ${progress.batch} / ${progress.batches} 批，新增 ${progress.added} 章`; publish();
      }});
      item.added = result.added; item.bookId = result.bookId;
      if (stopped()) break;
      item.message = '正在回读网站核验上传结果…'; publish();
      const numbers = plan.batches.flatMap(batch => batch.chapters.map(chapter => chapter.chapter_number));
      let verified = await inspect(identity, remote.book && result.verifiedToken && result.scope === remote.scope ? {knownToken: result.verifiedToken, numbers} : {});
      const partial = verified.partial;
      if (partial) {
        if (verified.token !== result.verifiedToken || verified.scope !== remote.scope) throw Error('网站核对版本不一致，请再次上传核对');
        const merged = new Map(remote.chapters.map(chapter => [chapter.number, chapter]));
        for (const number of numbers) merged.delete(number);
        for (const chapter of verified.chapters) merged.set(chapter.number, chapter);
        verified = {...verified, partial: false, chapters: [...merged.values()].sort((a, b) => a.number - b.number)};
      }
      if (planUpload(reviewedUploadIdentity(book, verified, stateDir), verified, prepared).batches.length) throw Error('网站回读尚未确认完整同步，请再次上传核对；已完成批次保留');
      checkpoints.save(item, verified, partial && cached ? checkpoint.verifiedAt : undefined);
      item.state = 'uploaded'; item.message = plan.newBook ? `新书已上传，新增 ${item.added} 章` : item.added ? `已同步新增 ${item.added} 章` : '书籍信息已同步';
    } catch (error) {
      if (stopped()) break;
      item.state = 'failed'; item.message = error.message;
      if (error.fatal) { blockedReason = error.message; break; }
    }
    publish();
  }
  } finally { await transport.close?.(); }
  for (const item of items) if (['pending', 'blocked', 'running'].includes(item.state)) { item.state = 'stopped'; item.message = blockedReason ? '网站暂不可用，尚未上传；恢复后再次点击即可重试' : '上传已停止，再次点击会核对网站并续传；已完成批次保留'; }
  const result = {...snapshot(), blockedReason, stopped: stopped(), finishedAt: new Date().toISOString()};
  atomicWrite(path.join(stateDir, 'uploads', runId + '.json'), result); onLibrary(result);
  return result;
}
