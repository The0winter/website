import '../../test-env.cjs';
import path from 'node:path';
import {createDesktop} from '../desktop/server.mjs';
let app;
const book = (title, author = '合成作者', suffix = '') => ({title, author, url: `https://queue.example/book/${encodeURIComponent(title + suffix)}`, site: '合成来源'});
process.on('message', async message => {
  if (message.type === 'start') {
    app = await createDesktop({...message,
      loadSources: () => ({sites: [{id: 'queue', name: '合成来源', home: 'https://queue.example/', hosts: ['queue.example'], spec: {kind: 'html'}}], errors: []}),
      findBooks: async ({title}) => title === '同名书' ? [book(title, '甲作者', 'a'), book(title, '乙作者', 'b')] : [book(title)],
      prepareBook: async b => ({version: 1, kind: 'html', title: b.title, author: b.author, sourceUrl: b.url, metadata: {title: 'h1', author: 'b'}, catalog: {links: 'a'}, chapter: {title: 'h1', content: 'article'}, delayMs: 200}),
      bookWorker: path.resolve('tools/novel-crawler/tests/queue-fixture-worker.mjs')
    });
    process.send({url: app.url});
  }
  if (message.type === 'stop') { await app?.close(); process.disconnect(); }
});
process.on('disconnect', () => app?.close());
