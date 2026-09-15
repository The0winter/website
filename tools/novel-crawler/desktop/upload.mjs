import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {prepareImport} from '../../../infra/import-plan.mjs';
import {createVpsLibraryTransport} from '../../../infra/library-sync-vps.mjs';
import {planLibrary} from './library.mjs';
import {hash, atomicWrite} from '../storage.mjs';

const bodyHash = content => crypto.createHash('sha256').update(content).digest('hex');
const normalize = value => String(value || '').normalize('NFKC').trim();
const metadataKeys = ['sourceUrl', 'title', 'author', 'authorSourceUrl', 'category', 'description', 'status'];

export function planUpload(book, remote) {
  const batches = prepareImport(book), chapters = batches.flatMap(batch => batch.chapters);
  // Covers have their own verified upload workflow. Absent or stale crawler
  // cover fields must never replace a managed website cover.
  const metadata = Object.fromEntries(metadataKeys.filter(key => book[key] !== undefined).map(key => [key, book[key]]));
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
    if (chapter.link && !previous.link) pending.push(chapter);
  }
  const metadataChanged = !!remote.book && ['description', 'category', 'status'].some(key => metadata[key] !== undefined && metadata[key] !== remote.book[key]);
  const uploads = [];
  for (let i = 0; i < pending.length; i += 20) uploads.push({...metadata, chapters: pending.slice(i, i + 20)});
  if (!uploads.length && metadataChanged) uploads.push({...metadata, chapters: []});
  return {batches: uploads, newBook: !remote.book, expectedAdded: chapters.filter(c => !existing.has(c.chapter_number)).length};
}

export async function uploadLibrary({stateDir, outputDir, signal, shouldStop = () => false, onLibrary = () => {}, onPhase = () => {}, transport = createVpsLibraryTransport()}) {
  const items = planLibrary({stateDir, outputDir, forUpload: true});
  let blockedReason;
  const startedAt = new Date().toISOString(), runId = 'upload-' + crypto.randomUUID();
  const stopped = () => !!signal?.aborted || shouldStop();
  const snapshot = () => ({kind: 'upload', startedAt, total: items.length,
    checked: items.filter(item => ['uploaded', 'unchanged', 'failed'].includes(item.state)).length,
    uploaded: items.filter(item => item.state === 'uploaded').length, newBooks: items.filter(item => item.state === 'uploaded' && item.newBook).length,
    unchanged: items.filter(item => item.state === 'unchanged').length, failed: items.filter(item => item.state === 'failed').length,
    added: items.reduce((sum, item) => sum + (item.added || 0), 0),
    items: items.map(({file, title, author, url, state, message, added, newBook, bookId}) => ({file, title, author, url, state, message, added, newBook, bookId}))});
  // The desktop persists live progress. Write the per-run report once at the
  // end, avoiding repeated Windows file replacement for every progress event.
  const publish = () => onLibrary(snapshot());
  publish();
  for (const item of items) {
    if (stopped()) break;
    const blocked = item.state === 'blocked' ? item.message : null;
    item.state = 'running'; item.message = '正在核对网站已有书籍和章节…'; onPhase(item); publish();
    try {
      if (blocked) throw Error(blocked);
      const file = path.resolve(outputDir, item.file), stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) throw Error('下载文件必须是书库中的普通文件');
      const bytes = fs.readFileSync(file);
      if (hash(bytes) !== item.hash) throw Error('排队期间文件被修改，请再次上传重新检查');
      const book = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
      prepareImport(book);
      const identity = Object.fromEntries(['sourceUrl', 'title', 'author'].map(key => [key, book[key]]));
      const remote = await transport({mode: 'inspect', ...identity}, {signal});
      if (stopped()) break;
      const plan = planUpload(book, remote);
      item.newBook = plan.newBook; item.bookId = remote.bookId;
      if (!plan.batches.length) { item.state = 'unchanged'; item.message = '网站已同步'; publish(); continue; }
      item.message = `正在上传${plan.newBook ? '新书' : '新增内容'}，共 ${plan.expectedAdded} 章…`; publish();
      const result = await transport({mode: 'apply', batches: plan.batches}, {signal, onProgress: progress => {
        item.added = progress.added; item.message = progress.stage === 'preflight' ? `上传前检查 ${progress.batch} / ${progress.batches} 批` : `已上传 ${progress.batch} / ${progress.batches} 批，新增 ${progress.added} 章`; publish();
      }});
      item.added = result.added; item.bookId = result.bookId;
      if (stopped()) break;
      item.message = '正在回读网站核验上传结果…'; publish();
      const verified = await transport({mode: 'inspect', ...identity}, {signal});
      if (planUpload(book, verified).batches.length) throw Error('网站回读尚未确认完整同步，请再次上传核对；已完成批次保留');
      item.state = 'uploaded'; item.message = plan.newBook ? `新书已上传，新增 ${item.added} 章` : item.added ? `已同步新增 ${item.added} 章` : '书籍信息已同步';
    } catch (error) {
      if (stopped()) break;
      item.state = 'failed'; item.message = error.message;
      if (error.fatal) { blockedReason = error.message; break; }
    }
    publish();
  }
  for (const item of items) if (['pending', 'blocked', 'running'].includes(item.state)) { item.state = 'stopped'; item.message = blockedReason ? '网站暂不可用，尚未上传；恢复后再次点击即可重试' : '上传已停止，再次点击会核对网站并续传；已完成批次保留'; }
  const result = {...snapshot(), blockedReason, stopped: stopped(), finishedAt: new Date().toISOString()};
  atomicWrite(path.join(stateDir, 'uploads', runId + '.json'), result); onLibrary(result);
  return result;
}
