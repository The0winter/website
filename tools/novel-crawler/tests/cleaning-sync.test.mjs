import '../../test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../storage.mjs';
import {main,planCleaningSync} from '../../../infra/sync-cleaned-library.mjs';
import {mergeCleaningReports} from '../clean-library.mjs';
import {getCatalog} from '../adapters.mjs';
import {cleanBookForReading} from '../../../shared/reading-cleanup.mjs';

test('an explicitly verified online title cannot apply to a whole library', async () => {
  await assert.rejects(main(['--online-title=已核实的新书名']),/单本书/);
  await assert.rejects(main(['--file=book.json','--online-title=']),/单本书/);
});

test('historical sync verifies the baseline, handles a retry and preserves chapter identity', () => {
  const chapter={chapter_number:3,title:'第三章',link:'https://example.test/3',content:'正文',volume_title:'第一卷',volume_number:1};
  const change={number:3,title:chapter.title,link:chapter.link,beforeHash:hash('广告\n正文'),afterHash:hash(chapter.content),beforeVolume:{},afterVolume:{volume_title:'第一卷',volume_number:1}};
  const report={changes:[change]},book={chapters:[chapter]},prior={id:'1',number:3,title:chapter.title,link:chapter.link,hash:change.beforeHash};
  const plan=planCleaningSync(book,report,{chapters:[prior]});
  assert.equal(plan.changed,1);assert.equal(plan.batches[0][0].id,'1');
  assert.equal(planCleaningSync(book,report,{chapters:[{...prior,hash:change.afterHash,...change.afterVolume}]}).changed,0);
  assert.throws(()=>planCleaningSync(book,report,{chapters:[{...prior,hash:hash('其他正文')}]}),/已变化/);
  assert.throws(()=>planCleaningSync(book,report,{chapters:[{...prior,title:'别的章节'}]}),/身份/);
  assert.deepEqual(planCleaningSync(book,report,{chapters:[]}).missing,[3]);
  const a={file:'book.json',title:'书',sourceUrl:'url',beforeHash:'a',afterHash:'b',changes:[{...change,afterHash:'middle',reasons:['title'],removedCharacters:3}]};
  const b={...a,beforeHash:'b',afterHash:'c',changes:[{...change,beforeHash:'middle',beforeVolume:change.afterVolume,reasons:['ad'],removedCharacters:2}]};
  const merged=mergeCleaningReports(a,b);assert.equal(merged.beforeHash,'a');assert.equal(merged.changes[0].beforeHash,change.beforeHash);assert.equal(merged.changes[0].removedCharacters,5);
  assert.throws(()=>mergeCleaningReports(a,{...b,beforeHash:'unrelated'}),/连续/);
});

test('explicit HTML volume boundaries survive repeated names and pagination', async () => {
  const url='https://example.test/book';
  const pages=new Map([[url,'<h1>测试书</h1><b>作者</b><div class="toc"><a href="/0">序言</a><h2>第一部</h2><a href="/1">第一章</a><h2>第一部</h2><a href="/2">第二章</a></div><a class="next" href="/page2">下页</a>'],['https://example.test/page2','<div class="toc"><a href="/3">第三章</a><h2>第二部</h2><a href="/4">第四章</a></div>']]);
  const spec={sourceUrl:url,title:'测试书',author:'作者',metadata:{title:'h1',author:'b'},catalog:{links:'.toc a',volumeSelector:'.toc h2',next:'.next'}};
  const client={assertUrl:url=>url,get:async url=>({url,body:Buffer.from(pages.get(url)),contentType:'text/html;charset=utf-8',hash:'fixture'})};
  const {catalog}=await getCatalog(spec,client);
  const book=cleanBookForReading({chapters:catalog.map(c=>({...c,content:'合成正文'}))});
  assert.deepEqual(book.chapters.map(c=>c.volume_number),[undefined,1,2,2,3]);
  assert.deepEqual(book.chapters.map(c=>c.chapter_number),[1,2,3,4,5]);
});
