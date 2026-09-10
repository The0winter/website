import {acquire} from '../core.mjs';

let paused = false, started = false, stopped = false;
const controller = new AbortController();
const send = value => { if (process.connected) process.send(value); };
process.on('message', async message => {
  if (message.type === 'pause') { paused = true; return; }
  if (message.type === 'stop') { paused = true; stopped = true; controller.abort(); return; }
  if (message.type !== 'start' || started) return;
  started = true;
  try {
    const options = {stateDir: message.stateDir, outputDir: message.outputDir, signal: controller.signal, shouldStop: () => paused, onProgress: progress => send({type: 'progress', ...progress}), onStatus: status => send({type: 'status', ...status})};
    send({type: 'phase', phase: 'probe'});
    let report = await acquire(message.spec, {...options, mode: 'probe'});
    if (!paused && report.structuralPass && !message.probeOnly) {
      send({type: 'phase', phase: 'download'});
      report = await acquire(message.spec, {...options, mode: 'download'});
    }
    send({type: 'done', report, paused: paused || report.paused, stopped});
  } catch (error) { send({type: 'error', error: error.message}); }
  finally { process.disconnect(); }
});
process.on('disconnect', () => { paused = true; controller.abort(); });
