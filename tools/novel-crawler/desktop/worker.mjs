import {acquire, validateSpec} from '../core.mjs';
import path from 'node:path';
import {makeClient} from '../http.mjs';
import {failureDetails} from '../diagnostics.mjs';
import {browserProfile} from '../browser-session.mjs';
import {updateLibrary} from './library.mjs';
import {createLibraryControl} from './library-control.mjs';
import {uploadLibrary} from './upload.mjs';
import retention from '../../storage-maintenance.cjs';

let paused = false, started = false, stopped = false, client, libraryControl;
const controller = new AbortController();
const send = value => { if (process.connected) process.send(value); };
process.on('message', async message => {
  if (message.type === 'library-action') {
    const accepted = libraryControl?.act(message.controlId, message.action) === true;
    send({type: 'library-action-done', requestId: message.requestId, error: accepted ? null : '这本书的状态已变化，请查看当前进度后再操作'});
    return;
  }
  if (message.type === 'show-browser') {
    try { if (!client) throw Error('当前没有等待操作的采集窗口'); await client.showBrowser(); send({type: 'browser-shown', requestId: message.requestId}); }
    catch (error) { send({type: 'browser-shown', requestId: message.requestId, error: error.message}); }
    return;
  }
  if (message.type === 'pause') { paused = true; libraryControl?.interrupt(); return; }
  if (message.type === 'stop') { paused = true; stopped = true; controller.abort(); return; }
  if (message.type !== 'start' || started) return;
  started = true;
  try {
    if (message.upload) {
      let lastBatch = 0, lastPhase = 0;
      const batch = await uploadLibrary({stateDir: message.stateDir, outputDir: message.outputDir, signal: controller.signal, shouldStop: () => paused,
        onLibrary: batch => { if (batch.finishedAt || Date.now() - lastBatch >= 200) { lastBatch = Date.now(); send({type: 'upload', batch}); } },
        onPhase: book => { if (Date.now() - lastPhase >= 200) { lastPhase = Date.now(); send({type: 'upload-phase', title: book.title, author: book.author}); } }});
      send({type: 'upload-done', batch});
      return;
    }
    if (message.library) {
      libraryControl = createLibraryControl({signal: controller.signal, shouldStop: () => paused});
      const result = await updateLibrary({stateDir: message.stateDir, outputDir: message.outputDir, sites: message.sites,
        control: libraryControl,
        signal: controller.signal, shouldStop: () => paused,
        onClient: value => { client = value; },
        onLibrary: batch => send({type: 'library', batch}),
        onPhase: (phase, book) => send({type: 'library-phase', phase, title: book.title, author: book.author, sourceUrl: book.url}),
        onProgress: progress => send({type: 'progress', ...progress}),
        onStatus: status => send({type: 'status', ...status})});
      send({type: 'library-done', batch: result, stopped, paused});
      return;
    }
    const options = {stateDir: message.stateDir, outputDir: message.outputDir, continuation: message.continuation, signal: controller.signal, shouldStop: () => paused, onProgress: progress => send({type: 'progress', ...progress}), onStatus: status => send({type: 'status', ...status})};
    const spec = validateSpec(message.spec);
    client = makeClient({cacheDir: path.join(message.stateDir, 'cache'), profileDir: browserProfile(message.stateDir, spec.sourceUrl), allowedHosts: spec.allowedHosts, delayMs: spec.delayMs, retries: spec.retries, timeoutMs: spec.timeoutMs, browser: spec.browser, onStatus: options.onStatus, shouldStop: options.shouldStop, signal: controller.signal});
    options.client = client;
    send({type: 'phase', phase: 'probe'});
    let report = await acquire(spec, {...options, mode: 'probe'});
    if (!paused && report.structuralPass && !message.probeOnly) {
      send({type: 'phase', phase: 'download'});
      report = await acquire(spec, {...options, mode: 'download'});
    }
    // Flush login state and release the source profile before another task starts.
    await client.close(); client = null;
    send({type: 'done', report, paused: paused || report.paused, stopped});
  } catch (error) { send({type: 'error', error: error.message, failure: failureDetails(error)}); }
  finally {
    libraryControl?.close(); libraryControl = null;
    try { await client?.close(); }
    catch (error) { send({type: 'error', error: error.message, failure: failureDetails(error)}); }
    // All clients have flushed their sessions and released cache leases.
    if (message.stateDir === path.resolve('.novel-crawler')) retention.queueAutomatic();
    process.disconnect();
  }
});
process.on('disconnect', () => { paused = true; controller.abort(); });
