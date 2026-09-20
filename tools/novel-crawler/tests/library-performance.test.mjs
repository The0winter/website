import '../../test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import puppeteer from 'puppeteer';
import {acquire, bindReadingEdition} from '../core.mjs';
import {hash, atomicWrite, readJson} from '../storage.mjs';
import {makeClient} from '../http.mjs';
import {qualityReport} from '../quality.mjs';
import {planLibrary, updateLibrary} from '../desktop/library.mjs';
import {createLibraryControl} from '../desktop/library-control.mjs';
import {createDesktop} from '../desktop/server.mjs';
import {specForBook} from '../desktop/sources.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise, resolve}; };
const title = n => `第${n}章 山中故事${n}`;
const body = n => Array.from({length: 450}, (_,i) => String.fromCodePoint(0x4e00 + n * 500 + i)).join('').repeat(2);
function fixture(t, hosts = ['a.example', 'mirror.a.example', 'b.example', 'c.example']) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-speed-')), outputDir = path.join(stateDir, 'downloads');
  t.after(() => {
    assert.equal(path.dirname(stateDir), os.tmpdir()); assert.ok(path.basename(stateDir).startsWith('novel-speed-'));
    fs.rmSync(stateDir, {recursive: true, force: true});
  });
  const sites = [['a.example', 'mirror.a.example'], ['b.example'], ['c.example']].map((hosts, i) => ({id: `site${i}`, hosts,
    book: {urlPattern: '^/(?<bookId>[0-9]+)/$', metadata: {title: 'h1', author: 'b'}},
    spec: {version: 1, kind: 'html', variant: 'speed-v1', title: '${title}', author: '${author}', sourceUrl: '${sourceUrl}',
      delayMs: 200, retries: 0, metadata: {title: 'h1', author: 'b'}, catalog: {links: 'nav a'}, chapter: {title: 'h1', content: 'article'}}}));
  const books = hosts.map((host, i) => ({title: `故事${i}`, author: '测试作者', sourceUrl: `https://${host}/${i}/`,
    chapters: [1,2,3].map(n => ({title: title(n), content: body(n), chapter_number: n, link: `https://${host}/${i}/${n}.html`}))}));
  const files = books.map((book, i) => { const file = path.join(outputDir, `${i}.json`); atomicWrite(file, book); return file; });
  const specs = books.map(book => specForBook({...book, url: book.sourceUrl}, sites));
  const state = {requests: [], count: 4, hold: null};
  function client(options) {
    const stats = {requests: 0, cacheHits: 0, retries: 0, bytes: 0};
    return {stats, close: async () => {}, assertUrl: url => {
      assert.ok(options.allowedHosts.includes(new URL(url).hostname)); return url;
    }, get: async url => {
      state.requests.push(url); stats.requests++;
      await sleep(10);
      if (state.hold) await state.hold(url);
      const book = books.find(book => url.startsWith(book.sourceUrl));
      const n = Number(/\/(\d+)\.html$/.exec(url)?.[1]);
      const html = n ? `<h1>${title(n)}</h1><article>${body(n)}</article>` : `<h1>${book.title}</h1><b>${book.author}</b><nav>${Array.from({length: state.count}, (_,i) => `<a href="${book.sourceUrl}${i+1}.html">${title(i+1)}</a>`).join('')}</nav>`;
      const buffer = Buffer.from(html); stats.bytes += buffer.length;
      return {url, body: buffer, hash: hash(buffer), fetchedAt: new Date().toISOString(), contentType: 'text/html; charset=utf-8'};
    }};
  }
  return {options: {stateDir, outputDir, sites}, books, files, specs, state, client};
}

test('real collection overlaps independent sources, serializes aliases, and preserves old chapters', async t => {
  const f = fixture(t), clients = new Set(), domains = new Set(); let maximum = 0;
  const createClient = options => {
    const domain = options.allowedHosts.includes('a.example') ? 'a' : options.allowedHosts[0];
    assert.equal(domains.has(domain), false, 'source aliases must share one lane');
    domains.add(domain); const client = f.client(options); clients.add(client); maximum = Math.max(maximum, clients.size);
    client.close = async () => { clients.delete(client); domains.delete(domain); };
    return client;
  };
  const result = await updateLibrary({...f.options, createClient, onFailure: item => assert.fail(item.message)});
  assert.equal(maximum, 2); assert.equal(clients.size, 0); assert.equal(result.updated, 4); assert.equal(result.added, 4);
  f.files.forEach((file,i) => assert.deepEqual(readJson(file).chapters.slice(0,3), f.books[i].chapters));
  assert.ok(result.items.every(item => item.state === 'updated'));
  f.state.requests = [];
  const next = await updateLibrary({...f.options, createClient, onFailure: item => assert.fail(item.message)});
  assert.equal(next.unchanged, 4); assert.equal(next.added, 0);
  assert.equal(f.state.requests.length, 4, 'no unchanged chapter is downloaded again');
});

test('parallel raw acquisitions keep both source registry entries', async t => {
  const f = fixture(t, ['a.example', 'b.example']);
  for (const file of f.files) fs.unlinkSync(file);
  const results = await Promise.all(f.specs.map(spec => acquire(spec, {...f.options, mode: 'download', client: f.client(spec)})));
  assert.ok(results.every(r => r.exportFile));
  const registry = readJson(path.join(f.options.stateDir, 'sources.json'));
  assert.equal(Object.keys(registry.sites).length, 2);
});

test('planning reads each export and reading map once, and rereads hashes on the next plan', async t => {
  const f = fixture(t, ['a.example']); fs.unlinkSync(f.files[0]);
  const spec = f.specs[0], report = await acquire(spec, {...f.options, mode: 'download', client: f.client(spec)});
  const book = readJson(report.exportFile), reviewed = {...book, chapters: book.chapters.map(c => ({...c, sourceChapterNumber: c.chapter_number, sourceChapterUrl: c.link}))};
  const output = path.join(f.options.outputDir, 'reading.json'); atomicWrite(output, reviewed);
  await bindReadingEdition(spec, output, f.options);
  const originalRead = fs.readFileSync, counts = new Map();
  fs.readFileSync = function(file, ...args) { const key = String(file); counts.set(key, (counts.get(key) || 0) + 1); return originalRead.call(this, file, ...args); };
  let plans;
  try { plans = planLibrary(f.options); } finally { fs.readFileSync = originalRead; }
  assert.equal(plans[0].state, 'pending'); assert.equal(counts.get(output), 1); assert.equal(counts.get(report.exportFile), 1);
  assert.equal([...counts].find(([file]) => file.endsWith('reading-edition.json'))[1], 1);
  fs.appendFileSync(output, '\n');
  assert.equal(planLibrary(f.options)[0].state, 'blocked');
});

test('a waiting book retains UI focus, drains in-flight work and blocks new dispatch until skipped', async t => {
  const f = fixture(t, ['a.example', 'b.example', 'c.example']);
  const control = createLibraryControl(), failed = deferred(), releaseSecond = deferred(), secondFinished = deferred();
  const started = [], phases = []; let snapshot;
  const work = updateLibrary({...f.options, control, createClient: f.client, onLibrary: batch => { snapshot = batch; },
    onPhase: (phase, item) => phases.push([phase,item.title]),
    collect: async spec => {
      const index = f.specs.findIndex(s => s.sourceUrl === spec.sourceUrl); started.push(index);
      if (index === 0) { await failed.promise; throw Error('需核对正文'); }
      if (index === 1) { failed.resolve(); await releaseSecond.promise; secondFinished.resolve(); }
      return {exportFile: f.files[index], expected: 3, structuralPass: true, completeAgainstSource: true, reusedExport: true};
    }});
  while (!snapshot?.items.some(item => item.state === 'waiting')) await sleep(5);
  const first = snapshot.items[0]; assert.equal(snapshot.currentControlId, first.controlId);
  releaseSecond.resolve(); await secondFinished.promise; await sleep(20);
  assert.deepEqual(started, [0,1]); assert.equal(snapshot.currentControlId, first.controlId);
  assert.deepEqual(phases.at(-1), ['library-wait', first.title]);
  assert.equal(control.act(first.controlId, 'skip'), true);
  const result = await work; assert.deepEqual(started, [0,1,2]); assert.equal(result.skipped, 1); assert.equal(result.unchanged, 2);
  assert.equal(control.act(first.controlId, 'skip'), false);
});

test('stop aborts every in-flight source and starts no queued books', async t => {
  const f = fixture(t, ['a.example', 'b.example', 'c.example']), controller = new AbortController();
  let starts = 0, aborted = 0, closed = 0;
  const result = await updateLibrary({...f.options, signal: controller.signal,
    createClient: () => ({close: async () => { closed++; }}),
    collect: async (_spec, options) => {
      starts++;
      const done = new Promise(resolve => options.signal.addEventListener('abort', () => { aborted++; resolve({paused:true}); }, {once:true}));
      if (starts === 2) controller.abort();
      return done;
    }});
  assert.equal(starts, 2); assert.equal(aborted, 2); assert.equal(closed, 2); assert.equal(result.stopped, true);
  assert.ok(result.items.every(item => item.state === 'stopped'));
});

test('shared source pacing uses elapsed time and retains Retry-After across clients', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-pacing-')), times = []; let limited = false;
  const server = http.createServer((_req,res) => { times.push(Date.now()); if (limited) { res.writeHead(429, {'Retry-After':'1'}); } res.end('ok'); });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(r=>server.close(r)); assert.equal(path.dirname(dir),os.tmpdir()); fs.rmSync(dir,{recursive:true,force:true}); });
  const base = `http://127.0.0.1:${server.address().port}`, pacing = {lastRequest:Date.now()-1000};
  const options = {cacheDir:dir,allowedHosts:['127.0.0.1'],delayMs:200,retries:0,pacing};
  let client = makeClient(options); const started = Date.now(); await client.get(base+'/a',{fresh:true}); await client.close();
  assert.ok(times[0]-started<180,'an already elapsed interval is not charged again');
  client=makeClient(options); await client.get(base+'/b',{fresh:true}); await client.close();
  assert.ok(times[1]-times[0]>=180,'new clients share the same site interval');
  limited=true; client=makeClient(options); await assert.rejects(client.get(base+'/c',{fresh:true}),/429/); await client.close();
  limited=false; client=makeClient(options); await client.get(base+'/d',{fresh:true}); await client.close();
  assert.ok(times[3]-times[2]>=950,'skipping/closing a client must not clear server backoff');
});

test('cached quality signatures give identical findings after content, order and title changes', () => {
  const chapters=[1,2,3].map(n=>({title:title(n),content:body(n),chapter_number:n,link:`https://a.example/${n}`})), signatureCache=new Map();
  qualityReport(chapters,chapters,[],'download',{signatureCache});
  const changed=[chapters[2],{...chapters[1],content:chapters[0].content},{...chapters[0],title:'另一个标题',chapter_number:4,link:'https://a.example/4'}];
  assert.deepEqual(qualityReport(changed,changed,[],'download',{signatureCache}),qualityReport(changed,changed));
  assert.ok(qualityReport(changed,changed).issues.some(i=>i.code==='duplicate-body'));
});

test('unchanged updates preserve partial file bytes and timestamp, corrupted partials are repaired', async t => {
  const f=fixture(t,['a.example']);fs.unlinkSync(f.files[0]);
  const spec=f.specs[0], options={...f.options,mode:'download',client:f.client(spec)};
  const initial=await acquire(spec,options), partial=path.join(f.options.stateDir,'jobs',initial.jobId,'partial.json');
  const before=fs.readFileSync(partial), stamp=fs.statSync(partial).mtimeMs;
  await acquire(spec,{...options,client:f.client(spec)});
  assert.deepEqual(fs.readFileSync(partial),before);assert.equal(fs.statSync(partial).mtimeMs,stamp);
  fs.writeFileSync(partial,'broken');await acquire(spec,{...options,client:f.client(spec)});
  assert.deepEqual(fs.readFileSync(partial),before);
});

test('desktop parallel worker keeps a later failing row selected while another source is in flight', async t => {
  const f=fixture(t,['a.example','b.example','c.example']), requests=[]; let held;
  const server=http.createServer((req,res)=>{
    requests.push(req.url); res.setHeader('Content-Type','text/html; charset=utf-8');
    const [,index,last]=req.url.split('/'), n=Number(last?.replace('.html',''));
    if(index==='0' && n===4){held=()=>res.end(`<h1>${title(n)}</h1><article>${body(n)}</article>`);return;}
    if(index==='1' && n===4)return res.end('<h1>第4章 山中故事4</h1><article></article>');
    if(n)return res.end(`<h1>${title(n)}</h1><article>${body(n)}</article>`);
    res.end(`<h1>故事${index}</h1><b>测试作者</b><nav>${[1,2,3,4].map(n=>`<a href="/${index}/${n}.html">${title(n)}</a>`).join('')}</nav>`);
  });
  await new Promise(resolve=>server.listen(0,'0.0.0.0',resolve));
  const port=server.address().port;
  f.books.forEach((book,i)=>{
    const host=`127.0.0.${i+1}`,sourceUrl=`http://${host}:${port}/${i}/`;
    book.sourceUrl=sourceUrl;book.chapters.forEach(c=>{c.link=sourceUrl+c.chapter_number+'.html';});atomicWrite(f.files[i],book);
    Object.assign(f.options.sites[i],{hosts:[host],home:`http://${host}:${port}/`,name:`测试来源${i}`});
  });
  const app=await createDesktop({...f.options,loadSources:()=>({sites:f.options.sites,errors:[]})});
  const browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  try {
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(app.url);await page.waitForSelector('#update-library');await page.click('#update-library');
    await page.waitForSelector('#library-help',{visible:true,timeout:20000});
    assert.equal(app.state().batch.concurrency,2);assert.equal(app.state().phase,'library-wait');
    assert.equal(app.state().title,'故事1');assert.equal(app.state().batch.items[0].state,'running');assert.ok(held);
    assert.equal(requests.includes('/2/'),false);assert.match(await page.$eval('#library-help',el=>el.textContent),/故事1/);
    const waiting=app.state().batch.items[1];assert.equal(app.state().batch.currentControlId,waiting.controlId);
    await page.setViewport({width:390,height:920});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const image=path.resolve('.runtime/task-artifacts/crawler-update-audit-20260920/verified-parallel-wait.png');fs.mkdirSync(path.dirname(image),{recursive:true});
    await page.screenshot({path:image,fullPage:true});
    await page.click('#library-skip');held();
    await page.waitForFunction(()=>document.querySelector('#phase').textContent==='已完成',{timeout:20000});
    assert.equal(app.state().batch.skipped,1);assert.equal(app.state().batch.updated,2);
    assert.equal(readJson(f.files[0]).chapters.length,4);assert.equal(readJson(f.files[1]).chapters.length,3);assert.equal(readJson(f.files[2]).chapters.length,4);
    assert.deepEqual(errors,[]);
  } finally {await browser.close();await app.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
