import '../../test-env.cjs';
import path from 'node:path';
import {createDesktop} from '../desktop/server.mjs';
let app;
process.on('message', async message => {
  if (message.type === 'start') {
    app = await createDesktop({...message, uploadWorker: path.resolve('tools/novel-crawler/tests/upload-fixture-worker.mjs')});
    process.send({url: app.url});
  }
  if (message.type === 'stop') { await app?.close(); process.disconnect(); }
});
process.on('disconnect', () => app?.close());
