import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {acquire, localBookState} from '../core.mjs';
import {hash} from '../storage.mjs';

async function fixture(t, name = 'A1') {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-navigation-'));
  const state = {count: 8, recent: 3, blocked: null, next: {}, titles: {}, requests: []};
  // Nonmonotonic URL IDs prove that traversal follows links, never sorts URLs.
  const ids = [90, 12, 70, 21, 60, 31, 50, 41, 43, 44, 45, 46, 47, 48];
  const chapterPath = n => `/book/${name}-${ids[n - 1]}.html`;
  const title = n => state.titles[n] || `第${n <= 4 ? n : n - 4}章 场景${n}`;
  const anchor = n => `<li><div class="name"><a href="${chapterPath(n)}">${title(n)}</a></div></li>`;
  const text = n => Array.from({length: 60}, (_, i) => String.fromCodePoint(0x4e00 + n * 200 + i)).join('').repeat(5);
  const server = http.createServer((req, res) => {
    state.requests.push(req.url);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (req.url === `/book/${name}.html`) return res.end(`<h1>测试书</h1><b>甲作者</b><span id="count">${state.count}</span><ul id="prefix">${[1,2].map(anchor).join('')}</ul><ul id="recent">${Array.from({length:Math.min(state.recent,state.count)},(_,i)=>state.count-i).map(anchor).join('')}</ul>`);
    if (req.url === state.blocked) { res.statusCode=503; return res.end('暂不可用'); }
    const match = new RegExp(`^/book/${name}-([0-9]+)(-2)?\\.html$`).exec(req.url);
    const n = match ? ids.indexOf(Number(match[1])) + 1 : 0;
    if (!n || n > state.count) { res.statusCode=404;return res.end('not found'); }
    const next = Object.hasOwn(state.next, n) ? state.next[n] : n < state.count ? chapterPath(n + 1) : `/book/${name}.html`;
    res.end(`<h1>${title(n)}</h1><article><p>${text(n)}${match[2] ? '暮色' : '晨光'}</p></article><nav><a class="book" href="/book/${name}.html">目录</a>${match[2] ? `<a class="next-chapter" href="${next}">下一章</a>` : `<a class="next-page" href="${chapterPath(n).replace('.html','-2.html')}">下一页</a>`}</nav>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));assert.equal(path.dirname(path.resolve(stateDir)),path.resolve(os.tmpdir()));assert.ok(path.basename(stateDir).startsWith('novel-navigation-'));fs.rmSync(stateDir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;
  const spec={version:1,kind:'html',variant:'navigation-v1',title:'测试书',author:'甲作者',sourceUrl:base+`/book/${name}.html`,delayMs:200,retries:0,metadata:{title:'h1',author:'b'},catalog:{links:'#prefix a',count:'#count',walk:{next:'.next-chapter',bookLink:'.book',chapterPattern:`^/book/${name}-(?<chapterId>[0-9]+)(?:-(?<page>[0-9]+))?\\.html$`,recentLinks:'#recent a',recentReverse:true}},chapter:{title:'h1',content:'article',next:'.next-page'}};
  return {stateDir,outputDir:path.join(stateDir,'exports'),spec,state,chapterPath,base};
}

test('sequential download bridges a missing catalog, persists a pause, and resumes without rereading saved prose', async t=>{
  const f=await fixture(t), options={stateDir:f.stateDir,outputDir:f.outputDir};
  const probe=await acquire(f.spec,{...options,mode:'probe'});
  assert.equal(probe.structuralPass,true);assert.equal(probe.expected,8);assert.equal(probe.downloaded,2);assert.equal(probe.catalogComplete,false);assert.equal(probe.sampleScope,'opening-chapters');
  const partial=await acquire(f.spec,{...options,mode:'download',maxNew:2});
  assert.equal(partial.downloaded,4);assert.equal(partial.knownCatalog,4);assert.equal(partial.completeAgainstSource,false);assert.equal(partial.exportFile,null);
  assert.deepEqual([localBookState(f.spec,options).saved,localBookState(f.spec,options).total],[4,8]);
  f.state.requests=[];
  const done=await acquire(f.spec,{...options,mode:'download'});
  assert.equal(done.errors,0);assert.equal(done.completeAgainstSource,true);assert.equal(done.downloaded,8);assert.equal(done.catalogComplete,true);
  const book=JSON.parse(fs.readFileSync(done.exportFile));
  assert.deepEqual(book.chapters.map(c=>c.link),Array.from({length:8},(_,i)=>f.base+f.chapterPath(i+1)));
  assert.ok(book.chapters.every(c=>c.provenance.length===2));
  assert.ok(!f.state.requests.includes(f.chapterPath(1)));assert.ok(!f.state.requests.includes(f.chapterPath(4)));
  f.state.requests=[];
  const repeated=await acquire(f.spec,{...options,mode:'download'});
  assert.equal(repeated.reusedExport,true);assert.deepEqual(f.state.requests,['/book/A1.html']);
  f.state.count=10;
  // The desktop worker probes first, which persists the extended catalog before
  // the download revisits a checkpoint that used to be the final chapter.
  const updateProbe=await acquire(f.spec,{...options,mode:'probe',samples:2});
  assert.equal(updateProbe.structuralPass,true);assert.equal(updateProbe.knownCatalog,10);
  f.state.requests=[];
  const update=await acquire(f.spec,{...options,mode:'download'});
  assert.equal(update.completeAgainstSource,true);assert.equal(update.downloaded,10);
  assert.deepEqual(f.state.requests,['/book/A1.html',f.chapterPath(9),f.chapterPath(9).replace('.html','-2.html'),f.chapterPath(10),f.chapterPath(10).replace('.html','-2.html')]);
  f.state.requests=[];
  const stable=await acquire(f.spec,{...options,mode:'download'});
  assert.equal(stable.completeAgainstSource,true);assert.equal(stable.reusedExport,true);assert.deepEqual(f.state.requests,['/book/A1.html']);
  f.state.count=11;
  const another=await acquire(f.spec,{...options,mode:'download'});
  assert.equal(another.completeAgainstSource,true);assert.equal(another.downloaded,11);
});

test('an update beyond the recent list refreshes only the old ending navigation and walks the gap', async t=>{
  const f=await fixture(t,'B2'),options={stateDir:f.stateDir,outputDir:f.outputDir,mode:'download'};
  f.state.count=4;f.state.recent=2;
  const old=await acquire(f.spec,options);assert.equal(old.completeAgainstSource,true);
  f.state.count=9;f.state.requests=[];
  const update=await acquire(f.spec,options);
  assert.equal(update.errors,0);assert.equal(update.downloaded,9);assert.equal(update.completeAgainstSource,true);
  assert.ok(!f.state.requests.includes(f.chapterPath(4)));
  assert.equal(f.state.requests.filter(url=>url===f.chapterPath(4).replace('.html','-2.html')).length,1);
  f.state.requests=[];
  const stable=await acquire(f.spec,options);
  assert.equal(stable.completeAgainstSource,true);assert.equal(stable.reusedExport,true);assert.deepEqual(f.state.requests,['/book/B2.html']);
});

test('sequential failures retain earlier checkpoints and resume from the failed chapter', async t=>{
  const f=await fixture(t),options={stateDir:f.stateDir,outputDir:f.outputDir,mode:'download'};
  f.state.blocked=f.chapterPath(4);
  const failed=await acquire(f.spec,options);assert.equal(failed.downloaded,3);assert.equal(failed.errors,1);assert.equal(failed.exportFile,null);
  f.state.blocked=null;f.state.requests=[];
  const resumed=await acquire(f.spec,options);assert.equal(resumed.completeAgainstSource,true);assert.equal(resumed.downloaded,8);
  assert.ok(!f.state.requests.includes(f.chapterPath(3)));assert.ok(f.state.requests.includes(f.chapterPath(4)));
});

test('pausing after discovery preserves the source total and resumes the same link chain', async t=>{
  const f=await fixture(t),options={stateDir:f.stateDir,outputDir:f.outputDir,mode:'download'};
  let stop=false;
  const paused=await acquire(f.spec,{...options,shouldStop:()=>stop,onProgress:progress=>{if(progress.downloaded===3)stop=true;}});
  assert.equal(paused.paused,true);assert.equal(paused.downloaded,3);assert.equal(paused.expected,8);assert.equal(paused.undiscovered,5);assert.equal(paused.exportFile,null);
  f.state.requests=[];
  const done=await acquire(f.spec,options);
  assert.equal(done.completeAgainstSource,true);assert.equal(done.downloaded,8);assert.ok(!f.state.requests.includes(f.chapterPath(3)));
  f.state.count=7;
  const shortened=await acquire(f.spec,options);
  assert.equal(shortened.structuralPass,false);assert.equal(shortened.exportFile,null);assert.match(shortened.failures[0].error,/总数/);
  assert.equal(JSON.parse(fs.readFileSync(done.exportFile)).chapters.length,8);
});

test('loops, premature endings, foreign books and corrupt next-link checkpoints never produce a complete export', async t=>{
  for (const next of ['/book/A1-90.html','/book/A1.html','/book/OTHER-1.html','https://foreign.example/book/A1-1.html','/book/A1-60-2.html']) {
    const f=await fixture(t), options={stateDir:f.stateDir,outputDir:f.outputDir,mode:'download'};
    f.state.next[3]=next;
    const result=await acquire(f.spec,options);assert.equal(result.structuralPass,false,next);assert.equal(result.exportFile,null);assert.ok(result.downloaded<=3);
  }
  const f=await fixture(t),options={stateDir:f.stateDir,outputDir:f.outputDir,mode:'download'};
  const partial=await acquire(f.spec,{...options,maxNew:3});
  const file=path.join(f.stateDir,'jobs',partial.jobId,'chapters',hash(f.base+f.chapterPath(3))+'.json');
  const saved=JSON.parse(fs.readFileSync(file));saved.chapter.nextChapterUrl=f.base+f.chapterPath(7);fs.writeFileSync(file,JSON.stringify(saved));
  const result=await acquire(f.spec,options);assert.equal(result.structuralPass,false);assert.equal(result.exportFile,null);assert.match(result.failures[0].error,/检查点损坏/);
});

test('changed recent metadata and manually edited exports remain protected', async t=>{
  const f=await fixture(t),options={stateDir:f.stateDir,outputDir:f.outputDir,mode:'download'};
  const done=await acquire(f.spec,options);assert.equal(done.completeAgainstSource,true);
  f.state.titles[7]='另一章';
  const conflict=await acquire(f.spec,options);assert.equal(conflict.structuralPass,false);assert.match(conflict.failures[0].error,/改名/);
  delete f.state.titles[7];
  fs.appendFileSync(done.exportFile,' ');
  const edited=await acquire(f.spec,options);assert.equal(edited.structuralPass,false);assert.match(edited.failures[0].error,/拒绝覆盖/);
});
