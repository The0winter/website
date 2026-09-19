import '../../test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSpec,extractionHash} from '../core.mjs';
import {getChapter} from '../adapters.mjs';

test('a bounded pagination budget preserves extraction identity and every cross-page guard',async()=>{
  const base='https://novel.example/', spec=validateSpec({version:1,kind:'html',title:'测试书',author:'甲作者',sourceUrl:base+'book',metadata:{title:'h1',author:'b'},catalog:{links:'nav a'},chapter:{title:'h1',content:'article',next:'a.next',maxPages:2}});
  const entry={title:'第1章 故事',link:base+'p1',chapter_number:1},links=new Set([entry.link,base+'other']);
  const page=(n,next=n<3?base+'p'+(n+1):null)=>`<h1>第1章 故事</h1><article>第${n}页不同的完整正文</article>${next?`<a class="next" href="${next}">下一页</a>`:''}`;
  const pages=new Map([1,2,3].map(n=>[base+'p'+n,page(n)])), requests=[];
  const client={assertUrl:url=>{assert.equal(new URL(url).origin,new URL(base).origin);return url;},get:async url=>{requests.push(url);return {url,body:Buffer.from(pages.get(url)),contentType:'text/html; charset=utf-8'};}};
  await assert.rejects(getChapter(spec,entry,links,client),/分页超过上限/);
  const larger=validateSpec({...spec,maxChapterPages:3});
  assert.equal(extractionHash(larger),extractionHash(spec));
  assert.notEqual(extractionHash({...larger,chapter:{...spec.chapter,content:'section'}}),extractionHash(spec));
  const chapter=await getChapter(larger,entry,links,client);
  assert.equal(chapter.provenance.length,3);assert.equal(chapter.content,'第1页不同的完整正文\n第2页不同的完整正文\n第3页不同的完整正文');
  for(const value of [1,2.5,101,'3',null])assert.throws(()=>validateSpec({...spec,maxChapterPages:value}),/maxChapterPages/);
  for(const [html,error] of [[page(3,base+'p2'),/循环/],[page(3,base+'other'),/另一章|上限/],[page(3).replace('第1章 故事','第2章 错章'),/标题不一致/],[page(2,null),/正文重复/]]){
    pages.set(base+'p3',html);await assert.rejects(getChapter({...larger,maxChapterPages:4},entry,links,client),error);
  }
  pages.set(base+'p3',page(3,base+'p4'));pages.set(base+'p4',page(4,null));
  await assert.rejects(getChapter(larger,entry,links,client),/分页超过上限/);
});

test('standalone ellipsis pages are preserved without permitting repeated prose or loops',async()=>{
  const base='https://novel.example/',spec=validateSpec({version:1,kind:'html',title:'测试书',author:'甲作者',sourceUrl:base+'book',metadata:{title:'h1',author:'b'},catalog:{links:'nav a'},chapter:{title:'h1',content:'article',next:'a.next',maxPages:5}});
  const entry={title:'九月活动公告',link:base+'1',chapter_number:1},links=new Set([entry.link,base+'next-chapter']);
  const bodies=['这次活动的完整说明。','.....','147，196，199，206','.....'];let tail=null;
  const client={assertUrl:url=>url,get:async url=>{const n=Number(new URL(url).pathname.slice(1)),next=n<4?base+(n+1):tail;return {url,body:Buffer.from(`<h1>九月活动公告</h1><article>${bodies[n-1]}</article>${next?`<a class="next" href="${next}">下一页</a>`:''}`),contentType:'text/html; charset=utf-8'};}};
  const result=await getChapter(spec,entry,links,client);assert.equal(result.content,bodies.join('\n'));assert.equal(result.provenance.length,4);
  for(const repeat of ['相同的正文','123456','.'.repeat(33)]){bodies[1]=bodies[3]=repeat;await assert.rejects(getChapter(spec,entry,links,client),/正文重复/);}
  bodies[1]=bodies[3]='.....';tail=base+'2';await assert.rejects(getChapter(spec,entry,links,client),/循环/);
  tail=base+'next-chapter';await assert.rejects(getChapter(spec,entry,links,client),/另一章/);
});
