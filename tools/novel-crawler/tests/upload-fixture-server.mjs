import '../../test-env.cjs';
import fs from 'node:fs';
import path from 'node:path';
import {createDesktop} from '../desktop/server.mjs';
let app;
process.on('message', async message => {
  if (message.type === 'start') {
    const rename = fs.renameSync;
    fs.renameSync = (from, to) => {
      if (to === path.join(message.stateDir, 'desktop-last-task.json') && fs.existsSync(path.join(message.stateDir, 'hold-summary-save'))) {
        throw Object.assign(Error('synthetic summary sharing violation'), {code: 'EPERM'});
      }
      return rename(from, to);
    };
    app = await createDesktop({...message, uploadWorker: path.resolve('tools/novel-crawler/tests/upload-fixture-worker.mjs')});
    process.send({url: app.url});
  }
  if (message.type === 'stop') { await app?.close(); process.disconnect(); }
});
process.on('disconnect', () => app?.close());
