import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import iconv from 'iconv-lite';
import {acquire, sourcePlan, localBookState, validateSpec} from '../core.mjs';
import {chapterQuality, qualityReport, checkIdentity} from '../quality.mjs';
import {decode, makeClient} from '../http.mjs';
import {splitText} from '../adapters.mjs';
import {readJson, atomicWrite, withLock, hash} from '../storage.mjs';
import {prepareImport} from '../../../infra/import-plan.mjs';

function removeFixture(dir) {
  const resolved = path.resolve(dir);
  assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
  assert.match(path.basename(resolved), /^novel-(?:crawler|epub|lock)-/);
  fs.rmSync(resolved, {recursive: true, force: true});
}

async function fixture(t, handler) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-crawler-'));
  const counts = new Map();
  const server = http.createServer((req, res) => {
    counts.set(req.url, (counts.get(req.url) || 0) + 1);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    handler(req, res, counts);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    // This test owns exactly this mkdtemp directory.
    removeFixture(dir);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {base, counts, dir, options: {stateDir: path.join(dir, 'state'), outputDir: path.join(dir, 'downloads'), mode: 'download'}};
}

const heading = '<h1>合成小说</h1><p id="author">作者：测试作者</p>';
function specFor(base) {
  return {version: 1, kind: 'html', title: '合成小说', author: '测试作者', sourceUrl: base + '/book', delayMs: 200, retries: 0,
    metadata: {title: 'h1', author: {selector: '#author', pattern: '^作者：(.*)$'}},
    catalog: {links: '#catalog a', next: 'a.next-catalog'},
    chapter: {title: 'body > h1', content: '#content', remove: ['.ad'], next: 'a.next-page'},
  };
}
const prose = label => `${label}。山间的路从村庄一直通往远方，读者可以从这里出发。`;

test('paged catalogs preserve notices, volume resets and source order; resume and export protect user edits', async t => {
  const f = await fixture(t, (req, res) => {
    const pages = {
      '/book': heading + '<div id="catalog"><a href="/a">第一章 起点</a><a href="/b">请假条</a></div><a class="next-catalog" href="/catalog2">下一页</a>',
      '/catalog2': '<div id="catalog"><a href="/c">第一章 新卷</a></div>',
      '/a': `<h1>第一章 起点</h1><div id="content"><h1>第一章 起点</h1><p>${prose('开头')}</p><p>故事中的广告二字必须保留。</p><div class="ad">这是真实广告位</div></div><a class="next-page" href="/a-page2">下一页</a>`,
      '/a-page2': `<h1>第一章 起点</h1><div id="content"><p>${prose('后半页')}</p></div>`,
      '/b': '<h1>请假条</h1><div id="content">今天请假。</div>',
      '/c': `<h1>第一章 新卷</h1><div id="content">${prose('下一卷')}</div>`,
    };
    if (!pages[req.url]) {res.statusCode = 404; res.end('missing');} else res.end(pages[req.url]);
  });
  const spec = specFor(f.base);
  assert.equal(localBookState(spec, f.options).state, 'new');
  const partial = await acquire(spec, {...f.options, maxNew: 1});
  assert.equal(partial.completeAgainstSource, false);
  assert.equal(partial.exportFile, null);
  assert.equal(partial.downloaded, 1);
  assert.equal(localBookState(spec, f.options).state, 'partial');
  assert.equal(localBookState(spec, f.options).saved, 1);
  assert.equal(localBookState({...spec, variant: 'different-source-version'}, f.options).state, 'new');
  const complete = await acquire(spec, f.options);
  assert.equal(complete.completeAgainstSource, true);
  assert.equal(complete.structuralPass, true);
  const book = readJson(complete.exportFile);
  assert.deepEqual(book.chapters.map(c => c.title), ['第一章 起点', '请假条', '第一章 新卷']);
  assert.deepEqual(book.chapters.map(c => c.chapter_number), [1, 2, 3]);
  assert.equal(f.counts.get('/a'), 1);
  assert.match(book.chapters[0].content, /后半页/);
  assert.match(book.chapters[0].content, /故事中的广告二字必须保留/);
  assert.doesNotMatch(book.chapters[0].content, /这是真实广告位/);
  assert.equal(book.chapters[1].content, '今天请假。');
  assert.equal(prepareImport(book).length, 1);
  assert.equal(sourcePlan('下一本', '作者', f.options.stateDir).preferred[0].verifiedBooks, 1);
  assert.equal(localBookState(spec, f.options).state, 'complete');
  fs.appendFileSync(complete.exportFile, ' ');
  assert.equal(localBookState(spec, f.options).state, 'modified');
  const conflict = await acquire(spec, f.options);
  assert.equal(conflict.structuralPass, false);
  assert.match(conflict.failures.at(-1).error, /拒绝覆盖/);
  assert.ok(fs.readFileSync(complete.exportFile, 'utf8').endsWith(' '));
});

test('wrong author is rejected before any chapter is fetched', async t => {
  const f = await fixture(t, (_req, res) => res.end(heading.replace('测试作者', '同名作品作者') + '<div id="catalog"><a href="/a">第一章</a></div>'));
  const report = await acquire(specFor(f.base), f.options);
  assert.equal(report.structuralPass, false);
  assert.equal(f.counts.get('/a'), undefined);
  assert.match(report.failures[0].error, /身份不匹配/);
});

test('catalog mutation stops continuation and preserves accepted chapter checkpoints', async t => {
  let changed = false;
  const f = await fixture(t, (req, res) => {
    res.end(req.url === '/book' ? heading + `<div id="catalog"><a href="${changed ? '/new' : '/a'}">第一章</a></div>` : '<h1>第一章</h1><div id="content">完整的测试正文。</div>');
  });
  const good = await acquire(specFor(f.base), f.options);
  const before = fs.readFileSync(good.exportFile);
  changed = true;
  const bad = await acquire(specFor(f.base), f.options);
  assert.equal(bad.structuralPass, false);
  assert.match(bad.failures[0].error, /目录有删除、插入或改名/);
  assert.deepEqual(fs.readFileSync(good.exportFile), before);
});

test('a next-page link to another chapter cannot silently merge chapters', async t => {
  const f = await fixture(t, (req, res) => {
    res.end(req.url === '/book' ? heading + '<div id="catalog"><a href="/a">第一章</a><a href="/b">第二章</a></div>' : req.url === '/a' ? '<h1>第一章</h1><div id="content">第一页正文。</div><a class="next-page" href="/b">下一页</a>' : '<h1>第二章</h1><div id="content">第二章正文。</div>');
  });
  const report = await acquire(specFor(f.base), f.options);
  assert.equal(report.exportFile, null);
  assert.match(report.failures[0].error, /指向另一章/);
});

test('duplicate catalog links and cyclic catalog pagination are rejected', async t => {
  let cycle = false;
  const f = await fixture(t, (_req, res) => res.end(heading + '<div id="catalog"><a href="/a">第一章</a>' + (cycle ? '</div><a class="next-catalog" href="/book">下一页</a>' : '<a href="/a">第一章</a></div>')));
  const report = await acquire(specFor(f.base), f.options);
  assert.match(report.failures[0].error, /链接重复/);
  cycle = true;
  const cyclic = await acquire(specFor(f.base), f.options);
  assert.match(cyclic.failures[0].error, /翻页形成循环/);
});

test('quality checks flag duplicated bodies, title mismatch and decoding problems without deleting short notices', () => {
  const body = '甲乙丙丁戊己庚辛壬癸'.repeat(30);
  const chapters = [
    {title: '第一章', catalogTitle: '第一章', chapter_number: 1, link: 'a', content: body},
    {title: '第二章', catalogTitle: '第二章', chapter_number: 2, link: 'b', content: body},
    {title: '请假条', chapter_number: 3, link: 'c', content: '请假。'},
  ];
  const report = qualityReport(chapters, chapters);
  assert.ok(report.issues.some(i => i.code === 'duplicate-body'));
  assert.equal(report.downloaded, 3);
  assert.equal(report.structuralPass, false);
  assert.equal(chapterQuality(chapters[2]).length, 0);
  assert.ok(chapterQuality({...chapters[0], catalogTitle: '别的标题'}).some(i => i.code === 'title-mismatch'));
  const numbering = chapterQuality({...chapters[0], title: '第三百章 开始', catalogTitle: '第298章 开始'});
  assert.ok(numbering.some(i => i.code === 'numbering-difference' && i.level === 'info'));
  assert.ok(chapterQuality({...chapters[0], content: '\uFFFD'}).some(i => i.code === 'decode'));
});

test('TXT segmentation preserves volume resets and preamble; GB18030 decoding is explicit', () => {
  const input = '前言文字\n第一章 开始\n春天的故事。\n第二章 下雨\n雨后的故事。\n第一章 新卷\n新的故事。';
  const chapters = splitText(input, {});
  assert.deepEqual(chapters.map(c => c.title), ['前言', '第一章 开始', '第二章 下雨', '第一章 新卷']);
  const encoded = iconv.encode(input, 'gb18030');
  assert.equal(decode(encoded, '', 'gb18030'), input);
  assert.throws(() => decode(encoded), /替换字符/);
  assert.throws(() => splitText('没有分章标记', {}), /未识别章节/);
  assert.throws(() => checkIdentity({title: '小说', author: '甲'}, {title: '小说', author: '乙'}), /不匹配/);
});

test('TXT resources pass the real import contract and keep original resource hashes', async t => {
  const f = await fixture(t, (req, res) => res.end(req.url === '/book' ? heading : '第一章 开始\n合成正文第一段。\n第二章 终点\n合成正文第二段。'));
  const spec = {...specFor(f.base), catalog: undefined, kind: 'txt', resource: {url: f.base + '/book.txt', expectedCount: 2}};
  const report = await acquire(spec, f.options);
  assert.equal(report.structuralPass, true);
  assert.equal(report.completeAgainstSource, true);
  const book = readJson(report.exportFile);
  assert.equal(book.chapters.length, 2);
  assert.ok(book.chapters.every(c => c.provenance[0].hash.length === 64));
  assert.equal(prepareImport(book)[0].chapters.length, 2);
});

test('HTTP retries transient failures, caches successful bytes and rejects external redirects', async t => {
  const f = await fixture(t, (req, res, counts) => {
    if (req.url === '/retry' && counts.get(req.url) === 1) {res.statusCode = 503; res.end('busy');}
    else if (req.url === '/redirect') {res.statusCode = 302; res.setHeader('Location', 'http://unconfigured.test/secret'); res.end();}
    else res.end('success');
  });
  const client = makeClient({cacheDir: path.join(f.dir, 'cache'), allowedHosts: ['127.0.0.1'], delayMs: 1, retries: 1});
  assert.equal((await client.get(f.base + '/retry')).body.toString(), 'success');
  await client.get(f.base + '/retry');
  assert.equal(f.counts.get('/retry'), 2);
  assert.equal(client.stats.cacheHits, 1);
  await assert.rejects(client.get(f.base + '/redirect'), /域名范围/);
});

test('EPUB parser follows spine order and splits headings without remote dependencies', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-epub-'));
  t.after(() => removeFixture(dir));
  const file = path.join(dir, 'synthetic.epub');
  const python = process.env.NOVEL_CRAWLER_PYTHON || 'python';
  const generator = `import zipfile,sys\nz=zipfile.ZipFile(sys.argv[1],'w')\nz.writestr('META-INF/container.xml','<container><rootfile full-path="OEBPS/content.opf"/></container>')\nz.writestr('OEBPS/content.opf','<package><metadata><title>Test Book</title><creator>Author</creator></metadata><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/><item id="b" href="b.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="b"/><itemref idref="a"/></spine></package>')\nz.writestr('OEBPS/a.xhtml','<html><body><h1>Chapter 2</h1><p>Second chapter.</p></body></html>')\nz.writestr('OEBPS/b.xhtml','<html><body><h1>Chapter 1</h1><p>First paragraph.</p><p>Second paragraph.</p></body></html>')\nz.close()`;
  const made = spawnSync(python, ['-c', generator, file], {encoding: 'utf8', windowsHide: true});
  assert.equal(made.status, 0, made.stderr);
  const result = spawnSync(python, [fileURLToPath(new URL('../epub.py', import.meta.url)), file], {encoding: 'utf8', windowsHide: true});
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.deepEqual(parsed.chapters.map(c => c.title), ['Chapter 1', 'Chapter 2']);
  assert.equal(parsed.chapters[0].content, 'First paragraph.\nSecond paragraph.');
});

test('a live process lock prevents concurrent state writers', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-lock-'));
  t.after(() => removeFixture(dir));
  const file = path.join(dir, 'lock');
  atomicWrite(file, {pid: process.pid, token: 'other'});
  await assert.rejects(withLock(file, async () => assert.fail('must not execute')), /仍在运行/);
  assert.equal(readJson(file).token, 'other');
});

test('a TXT prefix can be checked against a public JSON catalog and completed from the same source', async t => {
  const f = await fixture(t, (req, res) => {
    if (req.url === '/book') res.end(heading);
    else if (req.url === '/list') {
      assert.equal(req.method, 'POST');
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({chapters: [{n: 1, name: '第1章 开始'}, {n: 2, name: '第2章 新卷'}, {n: 3, name: '附录'}]}));
    } else if (req.url === '/book.txt') res.end('这是保存到元数据的简介。\n第1章 开始\n第一章 开始\n第一章的完整正文。\n第2章 新卷\n第一章 新卷\n新一卷的完整正文。');
    else if (req.url === '/c3') res.end('<h1>附录</h1><div id="content">附录正文。</div>');
    else {res.statusCode = 404; res.end('missing');}
  });
  const spec = {...specFor(f.base), kind: 'txt', resource: {url: f.base + '/book.txt', preamble: 'metadata', headingPattern: '^(第[0-9]+章[^\\n]+)$', innerHeadingPattern: '^(第[一二三]+章.*)$'},
    catalog: {url: f.base + '/list', request: {method: 'POST', form: {id: 'test'}}, json: {items: 'chapters', title: 'name', order: 'n', linkTemplate: '/c{n}'}, expectedCount: 3}};
  const report = await acquire(spec, f.options);
  assert.equal(report.structuralPass, true, JSON.stringify(report.failures));
  assert.equal(report.completeAgainstSource, true);
  const book = readJson(report.exportFile);
  assert.deepEqual(book.chapters.map(c => c.link), ['/c1', '/c2', '/c3'].map(p => f.base + p));
  assert.deepEqual(book.chapters.map(c => c.title), ['第一章 开始', '第一章 新卷', '附录']);
  assert.equal(f.counts.get('/c1'), undefined);
  assert.equal(f.counts.get('/c3'), 1);
  assert.match(fs.readFileSync(path.join(f.options.stateDir, 'jobs', report.jobId, 'source-preamble.txt'), 'utf8'), /简介/);
});

test('a mismatched resource prefix cannot be merged into a reference catalog', async t => {
  const f = await fixture(t, (req, res) => {
    if (req.url === '/book') res.end(heading + '<div id="catalog"><a href="/a">第1章 正确目录</a></div>');
    else res.end('第1章 另一个版本\n此处是另一个版本的内容。');
  });
  const spec = {...specFor(f.base), kind: 'txt', resource: {url: f.base + '/book.txt'}};
  const report = await acquire(spec, f.options);
  assert.equal(report.structuralPass, false);
  assert.match(report.failures[0].error, /标题不同/);
  assert.equal(report.exportFile, null);
});

test('a browser-rendered chapter is supported without reading text into the model', async t => {
  if (!fs.existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe') && !process.env.NOVEL_CRAWLER_BROWSER) {t.skip('No configured browser in this environment'); return;}
  const f = await fixture(t, (req, res) => res.end(req.url === '/book' ? heading + '<div id="catalog"><a href="/a">第一章</a></div>' : '<html><body><script>document.body.innerHTML="<h1>第一章</h1><div id=content>浏览器渲染的合成正文。</div>";</script></body></html>'));
  const spec = specFor(f.base);
  spec.chapter.transport = 'browser';
  const report = await acquire(spec, f.options);
  assert.equal(report.structuralPass, true, JSON.stringify(report.failures));
  assert.equal(readJson(report.exportFile).chapters[0].content, '浏览器渲染的合成正文。');
});

test('browser navigation reuses one tab and closes extra popup pages', async t => {
  const f = await fixture(t, (req, res) => {
    if (req.url === '/first') res.end(`<div id="content"></div><script>
      sessionStorage.setItem('collector-tab', 'same-tab');
      const popup = window.open('about:blank');
      const timer = setInterval(() => {
        if (popup?.closed) { document.querySelector('#content').textContent = 'popup-closed'; clearInterval(timer); }
      }, 30);
      </script>`);
    else res.end(`<div id="content"></div><script>document.querySelector('#content').textContent = sessionStorage.getItem('collector-tab');</script>`);
  });
  const client = makeClient({cacheDir: path.join(f.dir, 'one-tab'), allowedHosts: ['127.0.0.1'], delayMs: 200, timeoutMs: 3000});
  try {
    const first = await client.get(f.base + '/first', {render: true, readySelector: '#content:not(:empty)'});
    assert.match(first.body.toString(), /id="content">popup-closed/);
    const second = await client.get(f.base + '/second', {render: true, readySelector: '#content:not(:empty)'});
    assert.match(second.body.toString(), /id="content">same-tab/);
  } finally { await client.close(); }
});

test('stop aborts a hung browser navigation and closes its connection promptly', async t => {
  let arrived, disconnected;
  const waiting = new Promise(resolve => { arrived = resolve; });
  const closed = new Promise(resolve => { disconnected = resolve; });
  const f = await fixture(t, (req, res) => { res.once('close', disconnected); arrived(); });
  const controller = new AbortController();
  const client = makeClient({cacheDir: path.join(f.dir, 'stop-browser'), allowedHosts: ['127.0.0.1'], delayMs: 200, timeoutMs: 20000, signal: controller.signal});
  try {
    const rejected = assert.rejects(client.get(f.base + '/hang', {render: true}), error => error.stopSource && /已停止/.test(error.message));
    await waiting;
    const start = Date.now();
    controller.abort();
    await rejected;
    await client.close();
    await closed;
    assert.ok(Date.now() - start < 3000, 'stop must not wait for the navigation timeout');
  } finally { controller.abort(); await client.close(); }
});

test('browser source mode uses the full catalog and preserves server text despite DOM translation', async t => {
  const f = await fixture(t, (req, res) => {
    if (req.url === '/book') res.end('<h1>合成小說</h1><p id="author">作者：測試作者</p><div id="catalog"><a href="/a">第一章</a></div><script>document.querySelector("h1").textContent="页面改过的标题"</script>');
    else if (req.url === '/full-catalog') res.end('<ul><li data-num="2"><a href="/b">第二章</a></li><li data-num="1"><a href="/a">第一章</a></li></ul><script>document.querySelector("li").remove()</script>');
    else if (req.url === '/denied') { res.statusCode = 403; res.end('<div id="content">Do not accept this error page.</div>'); }
    else if (req.url === '/retry' && f.counts.get('/retry') === 1) { res.statusCode = 429; res.setHeader('Retry-After', '0'); res.end('Too many requests'); }
    else if (req.url === '/later') { res.statusCode = 429; res.setHeader('Retry-After', '3600'); res.end('Try later'); }
    else res.end(`<h1>${req.url === '/a' ? '第一章' : '第二章'}</h1><div id="content">${req.url === '/a' ? '古樹環繞著安靜的山村。' : '清晨的碼頭傳來船笛聲。'}</div><script>document.getElementById('content').textContent='页面转换后的内容'</script>`);
  });
  const spec = {...specFor(f.base), transport: 'browser', browser: {responseMode: 'source'}, identityNormalization: 'chinese-simplified'};
  spec.catalog = {url: f.base + '/full-catalog', links: 'li a', orderAncestor: 'li', orderAttribute: 'data-num'};
  const report = await acquire(spec, f.options);
  assert.equal(report.completeAgainstSource, true, JSON.stringify(report.failures));
  const book = readJson(report.exportFile);
  assert.deepEqual(book.chapters.map(c => c.title), ['第一章', '第二章']);
  assert.equal(book.chapters[0].content, '古樹環繞著安靜的山村。');
  assert.equal(book.chapters[1].content, '清晨的碼頭傳來船笛聲。');
  const client = makeClient({allowedHosts: ['127.0.0.1'], cacheDir: path.join(f.options.stateDir, 'cache'), delayMs: 200});
  try {
    const dom = await client.get(f.base + '/a', {render: true, readySelector: '#content'});
    assert.match(dom.body.toString('utf8'), /id="content">页面转换后的内容/);
    assert.equal(f.counts.get('/a'), 2);
    await assert.rejects(client.get(f.base + '/denied', {render: true, readySelector: '#content'}), /HTTP 403/);
    const retried = await client.get(f.base + '/retry', {render: true, readySelector: '#content'});
    assert.match(retried.body.toString('utf8'), /id="content"/);
    assert.equal(f.counts.get('/retry'), 2);
    assert.equal(client.stats.retries, 1);
    await assert.rejects(client.get(f.base + '/later', {render: true, readySelector: '#content'}), error => error.stopSource === true && /服务器要求稍后再试/.test(error.message));
    assert.equal(f.counts.get('/later'), 1);
  } finally { await client.close(); }
});

test('sparse probes stop after three failed requests instead of requiring adjacent chapter numbers', async t => {
  const f = await fixture(t, (req, res) => {
    if (req.url === '/book') res.end(heading + `<div id="catalog">${Array.from({length: 100}, (_, i) => `<a href="/a${i + 1}">第${i + 1}章</a>`).join('')}</div>`);
    else { res.statusCode = 403; res.end('forbidden'); }
  });
  const report = await acquire(specFor(f.base), {...f.options, mode: 'probe', samples: 4});
  assert.equal(report.structuralPass, false);
  assert.equal(report.failures.length, 3);
  assert.equal([...f.counts.keys()].filter(url => /^\/a\d+$/.test(url)).length, 3);
  assert.ok(report.failures[2].chapter > report.failures[1].chapter + 1);
});

test('manual verification waits for an external completion and supports cancellation and timeout', async t => {
  let completed = false;
  const f = await fixture(t, (req, res) => {
    if (req.url === '/verified' && completed) res.end('<h1>确认完成</h1><div id="content">合成测试正文。</div>');
    else {
      res.statusCode = 403; res.setHeader('cf-mitigated', 'challenge');
      res.end('<h1>测试等待页</h1>' + (req.url === '/start' ? '<meta http-equiv="refresh" content="0.5;url=/verified">' : ''));
    }
  });
  const statuses = []; let stop = false;
  const client = makeClient({cacheDir: path.join(f.dir, 'manual-cache'), allowedHosts: ['127.0.0.1'], delayMs: 200, browser: {responseMode: 'source', manualVerificationMs: 1000}, shouldStop: () => stop, onStatus: status => { statuses.push(status); if (status.kind === 'verification') completed = true; }});
  try {
    const response = await client.get(f.base + '/start', {render: true, readySelector: '#content'});
    assert.equal(response.url, f.base + '/verified');
    assert.match(response.body.toString('utf8'), /合成测试正文/);
    assert.deepEqual(statuses.map(s => s.kind), ['verification', 'active']);
    assert.equal(client.stats.retries, 0);
    await assert.rejects(client.get(f.base + '/timeout', {render: true}), e => e.stopSource === true && /验证超时/.test(e.message));
    const pending = client.get(f.base + '/cancel', {render: true});
    const timer = setTimeout(() => { stop = true; }, 300);
    try { await assert.rejects(pending, /已暂停/); } finally { clearTimeout(timer); }
  } finally { await client.close(); }
});

test('changing pacing and manual verification options preserves existing chapter checkpoints', async t => {
  const f = await fixture(t, (req, res) => res.end(req.url === '/book' ? heading + '<div id="catalog"><a href="/a">第一章</a></div>' : '<h1>第一章</h1><div id="content">合成正文。</div>'));
  const spec = {...specFor(f.base), browser: {responseMode: 'source'}};
  const first = await acquire(spec, {...f.options, mode: 'probe'});
  assert.equal(first.structuralPass, true);
  const updated = {...spec, delayMs: 300, browser: {...spec.browser, manualVerificationMs: 180000, resourceHosts: ['cdn.example'], manualLogin: {selector: '.login-required', timeoutMs: 600000}}};
  assert.equal(localBookState(updated, f.options).state, 'partial');
  const second = await acquire(updated, {...f.options, mode: 'probe'});
  assert.equal(second.structuralPass, true, JSON.stringify(second.failures));
  assert.equal(f.counts.get('/a'), 1);
});

test('manual login opens a working form, ignores cached previews and keeps the session from probe to download', async t => {
  let externalLoginCompleted = false, formOpened = false, lockedRequests = 0;
  const f = await fixture(t, (req, res) => {
    const loggedIn = req.headers.cookie === 'fixture-session=valid';
    if (req.url === '/book') return res.end(heading + '<div id="catalog"><a href="/a">第一章</a><a href="/b">第二章</a></div>');
    if (req.url === '/login-helper.js') {
      res.setHeader('Content-Type', 'application/javascript');
      return res.end(`document.querySelector('.login-link').onclick = () => { document.querySelector('#login-form').hidden = false; fetch('/form-opened'); }; setInterval(async () => { if (await (await fetch('/session')).text() === 'ready') location.reload(); }, 100);`);
    }
    if (req.url === '/form-opened') { formOpened = true; return res.end('ok'); }
    if (req.url === '/session') {
      if (externalLoginCompleted && formOpened) { res.setHeader('Set-Cookie', 'fixture-session=valid; Path=/; SameSite=Lax'); return res.end('ready'); }
      return res.end('waiting');
    }
    if (!['/a', '/b'].includes(req.url)) { res.statusCode = 404; return res.end('missing fixture route'); }
    if (!loggedIn) {
      lockedRequests++;
      return res.end(`<h1>第一章</h1><div id="content"><div class="login-required"><button class="login-link">登录</button></div>合成预览</div><form id="login-form" hidden><input name="fixture-user"></form><script src="http://localhost:${new URL(f.base).port}/login-helper.js"></script>`);
    }
    res.end(`<h1>${req.url === '/a' ? '第一章' : '第二章'}</h1><div id="content">${req.url === '/a' ? '合成完整第一章。' : '合成完整第二章。'}</div>`);
  });
  const browser = {headless: false, minimized: true, responseMode: 'source', resourceHosts: ['localhost'], manualLogin: {selector: '.login-required', openSelector: '.login-link', timeoutMs: 5000}};
  const cacheDir = path.join(f.dir, 'login-cache'), url = f.base + '/a';
  const preview = Buffer.from('<h1>第一章</h1><div id="content"><div class="login-required">过期的合成预览</div></div>');
  const key = hash({url, request: undefined, render: true, browser});
  atomicWrite(path.join(cacheDir, key + '.bin'), preview);
  atomicWrite(path.join(cacheDir, key + '.json'), {url, original: url, hash: hash(preview), fetchedAt: new Date().toISOString()});
  const statuses = [];
  const client = makeClient({cacheDir, allowedHosts: ['127.0.0.1'], delayMs: 200, browser, onStatus: status => { statuses.push(status.kind); if (status.kind === 'login') externalLoginCompleted = true; }});
  const spec = {...specFor(f.base), transport: 'browser', browser};
  try {
    const probe = await acquire(spec, {...f.options, client, mode: 'probe', maxNew: 1});
    assert.equal(probe.structuralPass, true, JSON.stringify(probe.failures));
    assert.equal(probe.downloaded, 1);
    assert.equal(formOpened, true, 'the external login script and openSelector must work');
    assert.equal(lockedRequests, 1, 'cached preview must be refreshed before waiting');
    assert.deepEqual(statuses, ['login', 'active']);
    assert.equal(client.stats.cacheHits, 0);
    const report = await acquire(spec, {...f.options, client, mode: 'download'});
    assert.equal(report.completeAgainstSource, true, JSON.stringify(report.failures));
    assert.deepEqual(readJson(report.exportFile).chapters.map(c => c.content), ['合成完整第一章。', '合成完整第二章。']);
    assert.deepEqual(statuses, ['login', 'active'], 'the same session must serve subsequent phases and chapters');
    assert.equal(lockedRequests, 1);
    assert.throws(() => client.assertUrl(f.base.replace('127.0.0.1', 'localhost') + '/a'), /域名范围/, 'resource hosts must not become book hosts');
    assert.equal(readJson(path.join(cacheDir, key + '.json')).hash, hash(fs.readFileSync(path.join(cacheDir, key + '.bin'))));
    assert.doesNotMatch(fs.readFileSync(path.join(cacheDir, key + '.bin'), 'utf8'), /login-required/);
  } finally { await client.close(); }
});

test('manual login does not accept a hidden overlay and can time out or stop without caching a preview', async t => {
  const f = await fixture(t, (req, res) => res.end('<h1>第一章</h1><div id="content"><div class="login-required">合成限制</div></div><script>document.querySelector(".login-required").remove()</script>'));
  const controller = new AbortController(), statuses = [];
  const cacheDir = path.join(f.dir, 'login-timeout');
  let cancel = false;
  const client = makeClient({cacheDir, allowedHosts: ['127.0.0.1'], delayMs: 200, browser: {responseMode: 'source', manualLogin: {selector: '.login-required', timeoutMs: 1000}}, signal: controller.signal, onStatus: status => { statuses.push(status.kind); if (cancel && status.kind === 'login') controller.abort(); }});
  try {
    await assert.rejects(client.get(f.base + '/timeout', {render: true, readySelector: '#content'}), e => e.stopSource === true && /手动登录超时/.test(e.message));
    assert.equal(fs.existsSync(cacheDir), false, 'restricted responses must not be written as successful cache entries');
    cancel = true;
    const started = Date.now();
    await assert.rejects(client.get(f.base + '/stop', {render: true, readySelector: '#content'}), /已停止/);
    assert.ok(Date.now() - started < 3000);
    assert.deepEqual(statuses, ['login', 'login']);
  } finally { await client.close(); }
});

test('login configuration validates time bounds and exact resource host names', () => {
  const spec = specFor('https://books.example');
  for (const manualLogin of [{selector: '', timeoutMs: 1000}, {selector: '.login', timeoutMs: 0}, {selector: '.login', timeoutMs: 600001}, {selector: '.login', openSelector: {}, timeoutMs: 1000}]) {
    assert.throws(() => validateSpec({...spec, browser: {manualLogin}}), /manualLogin/);
  }
  for (const resourceHosts of ['cdn.example', ['https://cdn.example'], ['*.example'], ['.example']]) {
    assert.throws(() => validateSpec({...spec, browser: {resourceHosts}}), /resourceHosts/);
  }
});

test('a long server cooldown stops the entire book before requesting other chapters', async t => {
  const f = await fixture(t, (req, res) => {
    if (req.url === '/book') res.end(heading + '<div id="catalog"><a href="/a">第一章</a><a href="/b">第二章</a></div>');
    else { res.statusCode = 429; res.setHeader('Retry-After', '3600'); res.end('Try later'); }
  });
  const report = await acquire(specFor(f.base), {...f.options, mode: 'probe'});
  assert.equal(report.structuralPass, false);
  assert.equal(report.failures.length, 1);
  assert.match(report.failures[0].error, /服务器要求稍后再试/);
  assert.equal(f.counts.get('/a'), 1);
  assert.equal(f.counts.has('/b'), false);
});

test('ZIP resources decode the selected TXT and do not extract unrelated archive files', async t => {
  let zipped;
  const f = await fixture(t, (req, res) => {
    if (req.url === '/book') res.end(heading);
    else {res.setHeader('Content-Type', 'application/zip'); res.end(zipped);}
  });
  const file = path.join(f.dir, 'book.zip');
  const generator = `import zipfile,sys\nz=zipfile.ZipFile(sys.argv[1],'w')\nz.writestr('book.txt','\\u7b2c1\\u7ae0 \\u5f00\\u59cb\\n\\u5408\\u6210\\u6d4b\\u8bd5\\u6b63\\u6587\\u3002'.encode('gb18030'))\nz.writestr('../unwanted.exe','never execute or extract this')\nz.close()`;
  const made = spawnSync(process.env.NOVEL_CRAWLER_PYTHON || 'python', ['-c', generator, file], {encoding: 'utf8', windowsHide: true});
  assert.equal(made.status, 0, made.stderr);
  zipped = fs.readFileSync(file);
  const spec = {...specFor(f.base), kind: 'txt', catalog: undefined, resource: {url: f.base + '/book.zip', compression: 'zip', encoding: 'gb18030'}};
  const report = await acquire(spec, f.options);
  assert.equal(report.completeAgainstSource, true, JSON.stringify(report.failures));
  assert.equal(readJson(report.exportFile).chapters[0].content, '合成测试正文。');
  assert.equal(fs.existsSync(path.join(f.dir, 'unwanted.exe')), false);
});
