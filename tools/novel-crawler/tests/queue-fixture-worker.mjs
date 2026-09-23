import '../../test-env.cjs';
import fs from 'node:fs';
import path from 'node:path';
let stopped = false, paused = false;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const send = value => new Promise(resolve => process.connected ? process.send(value, resolve) : resolve());
process.on('message', async message => {
  if (message.type === 'stop') { stopped = true; return; }
  if (message.type === 'pause') { paused = true; return; }
  if (message.type !== 'start') return;
  const {stateDir, spec} = message, title = spec.title;
  const log = event => fs.appendFileSync(path.join(stateDir, 'events.jsonl'), JSON.stringify({event, title}) + '\n');
  const lease = path.join(stateDir, 'fixture-active-worker');
  try {
    fs.writeFileSync(lease, title, {flag: 'wx'}); log('start');
    await send({type: 'phase', phase: 'download'});
    await send({type: 'progress', downloaded: 1, total: 4, mode: 'download'});
    while (fs.existsSync(path.join(stateDir, 'hold-' + title)) && !stopped && !paused) await sleep(20);
    const failure = path.join(stateDir, 'fail-once-' + title);
    if (fs.existsSync(failure)) { fs.unlinkSync(failure); await send({type: 'error', error: '合成来源暂时失败'}); }
    else await send({type: 'done', paused, stopped, report: {title, author: spec.author, structuralPass: true, downloaded: stopped || paused ? 1 : 4, expected: 4, failures: [], ...(stopped || paused || message.probeOnly ? {} : {exportFile: path.join(stateDir, title + '.json')})}});
    log('done');
    // A result is not a released browser profile. The next worker must wait.
    await sleep(120); fs.unlinkSync(lease); log('closed');
  } catch (error) { await send({type: 'error', error: error.message}); }
  finally { if (process.connected) process.disconnect(); }
});
process.on('disconnect', () => { stopped = true; });
