import '../../test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {splitText} from '../adapters.mjs';
import {validateSpec} from '../core.mjs';
import {loadSites,parseSearch} from '../desktop/sources.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {acquire} from '../core.mjs';
const resource={headingPattern:'^((?:第[一二][卷章].*|[上下]半部：.*))$',sectionPattern:'^(?:第[一二]卷|[上下]半部：)',preamble:'metadata'};
test('TXT section headings retain source order and labels without becoming empty chapters',()=>{
 const chapters=splitText('简介\n上半部：初始\n第一卷 开端\n第一章 原题\n正文甲\n第二章 继续\n正文乙\n下半部：重来\n第二卷 后来\n第一章 原题\n正文丙',{resource});
 assert.equal(chapters.length,3);
 assert.deepEqual(chapters.map(c=>c.content),['正文甲','正文乙','正文丙']);
 assert.deepEqual(chapters[0].sourceSectionHeadings,['上半部：初始','第一卷 开端']);
 assert.equal(chapters[1].sourceSection,'第一卷 开端');
 assert.deepEqual(chapters[2].sourceSectionHeadings,['下半部：重来','第二卷 后来']);
 assert.equal(chapters[2].title,'第一章 原题');
 const preface=splitText('第一卷 开端\n序言正文\n第一章 原题\n正文',{resource});
 assert.equal(preface.length,2);assert.equal(preface[0].title,'第一卷 开端');assert.equal(preface[0].content,'序言正文');
 assert.throws(()=>splitText('第一章 原题\n正文\n第二卷 后来',{resource}),/没有后续章节/);
 assert.equal(splitText('第一卷 开端\n第一章 原题\n正文',{resource:{...resource,sectionPattern:undefined}})[0].content,'');
});
test('TXT section rules are explicit and validated',()=>{
 const base={version:1,kind:'txt',title:'合成',author:'作者',sourceUrl:'https://example.org/book',metadata:{title:'h1',author:'p'},resource:{url:'https://example.org/book.txt'}};
 for(const pattern of ['',42,'^'])assert.throws(()=>validateSpec({...base,resource:{...base.resource,sectionPattern:pattern}}),/分卷标题/);
 assert.throws(()=>validateSpec({...base,kind:'epub',resource:{...base.resource,sectionPattern:'^第一卷'}}),/TXT/);
});
test('zxcs search pairs title and author within each result card',()=>{
 const site=loadSites().sites.find(s=>s.id==='zxcs-zip');assert.ok(site);
 const html='<a href="/book/1.html"><h3>《合成甲》（校对版全本）作者：甲</h3><p>广告</p></a><a href="/book/2.html"><h3>《合成乙》（校对版全本）作者：乙</h3></a><a href="/book/9.html">推荐</a>';
 assert.deepEqual(parseSearch(html,site.home,site).results.map(({title,author,url})=>({title,author,url})),[{title:'合成甲',author:'甲',url:'https://zxcs.zip/book/1.html'},{title:'合成乙',author:'乙',url:'https://zxcs.zip/book/2.html'}]);
});
test('TXT ZIP uses only an explicitly configured password and preserves the resource check',async t=>{
 // Synthetic single-chapter ZipCrypto fixture; password is public-test-password.
 const zip=Buffer.from('UEsDBBQAAQAAAPuzOl3a/6HSMAAAACQAAAAIAAAAYm9vay50eHRXVR6Oeh26mnO3uH+On0iAMEP6kNCn/RAia0Ul4ZvfjMu8opFAXCbYE6Y3iriZyM1QSwECFAAUAAEAAAD7szpd2v+h0jAAAAAkAAAACAAAAAAAAAAAAAAAgAEAAAAAYm9vay50eHRQSwUGAAAAAAEAAQA2AAAAVgAAAAAA','base64');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'novel-txtzip-'));
 const server=http.createServer((req,res)=>{if(req.url==='/book'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<h1>合成</h1><p>作者</p>');}else{res.setHeader('Content-Type','application/zip');res.end(zip);}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));fs.rmSync(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${server.address().port}`;
 const spec={version:1,kind:'txt',title:'合成',author:'作者',sourceUrl:base+'/book',delayMs:200,retries:0,metadata:{title:'h1',author:'p'},resource:{url:base+'/book.zip',compression:'zip',encoding:'utf8'}};
 const options={mode:'download',stateDir:path.join(dir,'state'),outputDir:path.join(dir,'downloads')};
 const missing=await acquire(spec,options);assert.equal(missing.exportFile,null);assert.match(missing.failures[0].error,/explicit archive password/);
 const wrong=await acquire({...spec,variant:'wrong',resource:{...spec.resource,password:'wrong'}},options);assert.equal(wrong.exportFile,null);assert.match(wrong.failures[0].error,/password/i);
 const correct=await acquire({...spec,variant:'correct',resource:{...spec.resource,password:'public-test-password'}},options);assert.equal(correct.completeAgainstSource,true,JSON.stringify(correct.failures));assert.equal(correct.errors,0);
 const book=JSON.parse(fs.readFileSync(correct.exportFile,'utf8'));assert.equal(book.chapters[0].content,'这是合成正文。');assert.ok(book.chapters[0].provenance[0].hash);
 for(const resource of [{...spec.resource,password:''},{...spec.resource,password:123},{url:base+'/book.txt',password:'public-test-password'}])assert.throws(()=>validateSpec({...spec,resource}),/TXT ZIP/);
});
