import {acquire, validateSpec} from '../core.mjs';
import path from 'node:path';
import {makeClient} from '../http.mjs';
import {failureDetails} from '../diagnostics.mjs';

let paused = false, started = false, stopped = false, client;
const controller = new AbortController();
const send = value => { if (process.connected) process.send(value); };
process.on('message', async message => {
  if (message.type === 'show-browser') {
    try { if (!client) throw Error('当前没有等待操作的采集窗口'); await client.showBrowser(); send({type: 'browser-shown', requestId: message.requestId}); }
    catch (error) { send({type: 'browser-shown', requestId: message.requestId, error: error.message}); }
    return;
  }
  if (message.type === 'pause') { paused = true; return; }
  if (message.type === 'stop') { paused = true; stopped = true; controller.abort(); return; }
  if (message.type !== 'start' || started) return;
  started = true;
  try {
    const options = {stateDir: message.stateDir, outputDir: message.outputDir, signal: controller.signal, shouldStop: () => paused, onProgress: progress => send({type: 'progress', ...progress}), onStatus: status => send({type: 'status', ...status})};
    const spec = validateSpec(message.spec);
    client = makeClient({cacheDir: path.join(message.stateDir, 'cache'), allowedHosts: spec.allowedHosts, delayMs: spec.delayMs, retries: spec.retries, timeoutMs: spec.timeoutMs, browser: spec.browser, onStatus: options.onStatus, shouldStop: options.shouldStop, signal: controller.signal});
    options.client = client;
    send({type: 'phase', phase: 'probe'});
    let report = await acquire(spec, {...options, mode: 'probe'});
    if (!paused && report.structuralPass && !message.probeOnly) {
      send({type: 'phase', phase: 'download'});
      report = await acquire(spec, {...options, mode: 'download'});
    }
    send({type: 'done', report, paused: paused || report.paused, stopped});
  } catch (error) { send({type: 'error', error: error.message, failure: failureDetails(error)}); }
  finally { await client?.close(); process.disconnect(); }
});
process.on('disconnect', () => { paused = true; controller.abort(); });
