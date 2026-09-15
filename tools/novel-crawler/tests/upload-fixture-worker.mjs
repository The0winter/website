import '../../test-env.cjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {uploadLibrary} from '../desktop/upload.mjs';
import {atomicWrite, readJson} from '../storage.mjs';

// Synthetic website for browser integration tests. Never opens a real website.
const controller = new AbortController();
process.on('disconnect', () => controller.abort());
process.on('message', async message => {
  if (message.type === 'stop') return controller.abort();
  if (message.type !== 'start') return;
  const file = path.join(message.stateDir, 'synthetic-website.json');
  const transport = async (job, {signal, onProgress = () => {}} = {}) => {
    await new Promise(resolve => setTimeout(resolve, 150));
    if (signal.aborted) throw Error('stopped');
    if (fs.existsSync(path.join(message.stateDir, 'hold-upload'))) {
      await new Promise(resolve => signal.addEventListener('abort', resolve, {once: true}));
      throw Error('stopped');
    }
    const books = readJson(file, {}), book = books[job.sourceUrl];
    if (job.mode === 'inspect') return {book, bookId: 'fixture', chapters: (book?.chapters || []).map(c => ({number: c.chapter_number, title: c.title, link: c.link, hash: crypto.createHash('sha256').update(c.content).digest('hex')}))};
    let added = 0;
    for (const [index, batch] of job.batches.entries()) {
      const current = books[batch.sourceUrl] ||= {...batch, chapters: []};
      Object.assign(current, {...batch, chapters: current.chapters});
      for (const c of batch.chapters) if (!current.chapters.some(p => p.chapter_number === c.chapter_number)) { current.chapters.push(c); added++; }
      atomicWrite(file, books); onProgress({batch: index + 1, batches: job.batches.length, added});
    }
    return {added, bookId: 'fixture'};
  };
  try {
    const batch = await uploadLibrary({...message, signal: controller.signal, transport,
      onLibrary: batch => process.send?.({type: 'upload', batch}), onPhase: book => process.send?.({type: 'upload-phase', title: book.title})});
    process.send?.({type: 'upload-done', batch});
  } catch (error) { process.send?.({type: 'error', error: error.message}); }
  finally { process.disconnect(); }
});
