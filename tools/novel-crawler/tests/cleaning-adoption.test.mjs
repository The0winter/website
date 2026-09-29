import '../../test-env.cjs';
import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {atomicWrite,hash,readJson} from '../storage.mjs';
import {formatChapterForExport} from '../titles.mjs';
import {adoptReadingEdition,loadReadingEdition,updateReadingEdition} from '../reading-edition.mjs';
import {cleanBookForReading} from '../../../shared/reading-cleanup.mjs';

test('reading adoption and continuation validate the complete cleanup context and volume runs', t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cleanup-adoption-'));
 t.after(()=>{assert.equal(path.dirname(fs.realpathSync(temp)),fs.realpathSync(os.tmpdir()));assert.ok(path.basename(temp).startsWith('cleanup-adoption-'));fs.rmSync(temp,{recursive:true});});
 const dir=path.join(temp,'job'),outputDir=path.join(temp,'downloads'),file=path.join(outputDir,'fixture.json');
 const spec={title:'合成书',author:'甲作者',sourceUrl:'https://example.test/book',variant:'fixture'};
 const raw=[1,2,3].map(n=>({title:`第${n}章 合成场景`,chapter_number:n,link:`https://example.test/${n}`,sourceSection:n===1?'第一卷':'第二卷',
  content:`第${n}章 合成场景\n作者：甲作者\n`+Array.from({length:150},(_,i)=>String.fromCodePoint(0x4e00+n*200+i)).join('').repeat(8)}));
 const catalog=raw.map(c=>({title:c.title,link:c.link,chapter_number:c.chapter_number}));
 for(const chapter of raw)atomicWrite(path.join(dir,'chapters',hash(chapter.link)+'.json'),{hash:hash(chapter),chapter,catalogTitle:chapter.title});
 atomicWrite(path.join(dir,'catalog.json'),catalog.slice(0,2));atomicWrite(path.join(dir,'download-report.json'),{completeAgainstSource:true,expected:2,failures:[]});
 const book=cleanBookForReading({...spec,chapters:raw.slice(0,2).map(c=>({...formatChapterForExport(c),sourceChapterNumber:c.chapter_number,sourceChapterUrl:c.link}))});
 assert.deepEqual(book.chapters.map(c=>c.volume_number),[1,2]);assert.ok(!book.chapters[0].content.includes('作者：'));
 atomicWrite(file,{...book,chapters:book.chapters.map((c,i)=>i?c:{...c,volume_title:'伪造分卷'})});
 assert.throws(()=>adoptReadingEdition(dir,spec,'fixture-hash',file,outputDir),/不匹配/);
 atomicWrite(file,book);adoptReadingEdition(dir,spec,'fixture-hash',file,outputDir);
 const state=loadReadingEdition(dir,spec,'fixture-hash',outputDir);assert.equal(state.sources[0].contentHash,hash(raw[0].content));
 atomicWrite(path.join(dir,'catalog.json'),catalog);
 const result=updateReadingEdition({dir,state,spec,extraction:'fixture-hash',outputDir,catalog,rawReport:{mode:'download',failures:[],issues:[],completeAgainstSource:true}});
 assert.equal(result.readingAdded,1,JSON.stringify(result.failures));assert.deepEqual(readJson(file).chapters.map(c=>c.volume_number),[1,2,2]);
 assert.ok(!readJson(file).chapters[2].content.includes('作者：'));
});
