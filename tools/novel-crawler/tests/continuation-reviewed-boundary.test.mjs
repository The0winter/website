import '../../test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {acquire, localBookState, validateSpec, extractionHash} from '../core.mjs';
import {continuationKey, createContinuationReviewer, recordContinuationAnchorReview, recordContinuationSourceDefect} from '../continuation.mjs';
import {atomicWrite, hash, readJson} from '../storage.mjs';

const body = n => Array.from({length:180}, (_,i) => String.fromCodePoint(0x4e00+n*200+i)).join('').repeat(4);
const heading = n => `第${n}章 山间故事${n}`;
async function fixture(t) {
  const stateDir=fs.mkdtempSync(path.join(os.tmpdir(),'reviewed-boundary-')),outputDir=path.join(stateDir,'out'),titles={};
  const server=http.createServer((req,res)=>{
    res.setHeader('Content-Type','text/html; charset=utf-8');
    if(req.url==='/book')return res.end(`<h1>附注核对</h1><b>甲作者</b><nav>${Array.from({length:6},(_,i)=>`<a href="/c/${i+1}">${titles[i+1]||heading(i+1)}</a>`).join('')}</nav>`);
    const n=Number(req.url.split('/').at(-1));res.end(`<h1>${titles[n]||heading(n)}</h1><article>${body(n)}</article>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));assert.equal(path.dirname(path.resolve(stateDir)),path.resolve(os.tmpdir()));assert.ok(path.basename(stateDir).startsWith('reviewed-boundary-'));fs.rmSync(stateDir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;
  const spec=validateSpec({version:1,kind:'html',variant:'reviewed-heading-v1',title:'附注核对',author:'甲作者',sourceUrl:base+'/book',metadata:{title:'h1',author:'b'},catalog:{links:'nav a'},chapter:{title:'h1',content:'article'},delayMs:200,retries:0});
  const book={title:spec.title,author:spec.author,sourceUrl:'https://old.example/book',chapters:Array.from({length:4},(_,i)=>({chapter_number:i+1,title:heading(i+1),content:body(i+1),link:`https://old.example/${i+1}`}))};
  const file=path.join(outputDir,'附注核对.json');atomicWrite(file,book);
  const options={stateDir,outputDir,extraction:extractionHash(spec)},sourceDir=path.join(stateDir,'continuations',continuationKey(spec),'sources',hash([spec.sourceUrl,options.extraction]).slice(0,24));
  const run=()=>acquire(spec,{...options,continuation:localBookState(spec,options).continuation,mode:'probe'});
  const save=chapter=>atomicWrite(path.join(sourceDir,'chapters',hash(chapter.link)+'.json'),{chapter,hash:hash(chapter),catalogTitle:chapter.title});
  return {spec,book,file,options,titles,run,save,base};
}

test('continuation comparison uses host-specific noise rules without removing prose on other hosts',()=>{
  const content=body(1).slice(0,300)+'\n'+body(1).slice(300),promotion='前往必应搜索德旗小说网可查看最新章节！';
  const old={chapter_number:1,title:heading(1),content,link:'https://www.deqixs.org/1/old.html'},book={chapters:[old]};
  const incoming={...old,content:content.replace('\n','\n'+promotion+'\n'),link:'https://www.deqixs.org/1/new.html'};
  const reviewer=createContinuationReviewer(book);
  assert.equal(reviewer.accept(incoming,incoming),false);assert.equal(reviewer.resolutions[0].kind,'duplicate-chapter');assert.equal(book.chapters[0].content,content);
  assert.throws(()=>createContinuationReviewer(book).accept(incoming,{...incoming,link:'https://unverified.example/chapter'}));
  assert.throws(()=>createContinuationReviewer(book).accept(incoming,{...incoming,content:content.replace('\n','\n他念道：'+promotion+'\n')}));
});

test('request suffix changes require an explicit review that expires even when normalized bodies remain equal',async t=>{
  const f=await fixture(t);f.book.chapters[3].title=heading(4)+'（求追读or2）';atomicWrite(f.file,f.book);f.titles[4]=heading(4)+'（求追读2）';
  const original=fs.readFileSync(f.file),blocked=await f.run();assert.equal(blocked.structuralPass,false);assert.match(blocked.failures[0].error,/无法对齐/);
  const incoming={chapter_number:4,title:f.titles[4],content:body(4),link:f.base+'/c/4'};f.save(incoming);
  const choice={file:path.basename(f.file),oldNumber:4,newLink:incoming.link,oldHash:hash(body(4)),newHash:hash(body(4)),reason:'同一章求追读附注变化，已核对完整正文并保留原题原文'};
  assert.throws(()=>recordContinuationAnchorReview(f.spec,f.options,choice),/同章号且标题对应/);
  const review=recordContinuationAnchorReview(f.spec,f.options,{...choice,allowTitleAnnotationChange:true});assert.equal(review.titleAnnotation,true);
  f.save({...incoming,content:body(4)+'\n'});assert.equal((await f.run()).failures[0].code,'continuation-body-conflict');
  f.save(incoming);const checked=await f.run();assert.equal(checked.structuralPass,true,JSON.stringify(checked.failures));assert.equal(checked.anchors[2].reviewKey,review.key);
  assert.deepEqual(fs.readFileSync(f.file),original);
  const downloaded=await acquire(f.spec,{...f.options,continuation:localBookState(f.spec,f.options).continuation,mode:'download'});
  assert.equal(downloaded.completeAgainstSource,true);assert.deepEqual(readJson(f.file).chapters.slice(0,4),f.book.chapters);
});

test('title-annotation review cannot authorize a renamed story, different ordinal or a split chapter',async t=>{
  const f=await fixture(t);f.book.chapters[3].title=heading(4)+'（求追读or2）';atomicWrite(f.file,f.book);
  for(const title of ['第4章 另一件事情（求追读2）','第5章 山间故事4（求追读2）',heading(4)+'（下）']){
    const incoming={chapter_number:4,title,content:body(4),link:f.base+'/c/4'};f.save(incoming);
    assert.throws(()=>recordContinuationAnchorReview(f.spec,f.options,{file:path.basename(f.file),oldNumber:4,newLink:incoming.link,oldHash:hash(body(4)),newHash:hash(body(4)),allowTitleAnnotationChange:true,reason:'不能凭附注选项接受其他章节'}),/同章号且标题对应/);
  }
});

test('boundary numbering with a prose variant requires a pinned explicit anchor review and preserves the old body',async t=>{
  const f=await fixture(t);f.book.chapters[3].content=body(4).slice(2);atomicWrite(f.file,f.book);f.titles[5]='第6章 山间故事5';f.titles[6]='第7章 山间故事6';
  assert.equal((await f.run()).structuralPass,false);
  const sourceDir=path.join(f.options.stateDir,'continuations',continuationKey(f.spec),'sources',hash([f.spec.sourceUrl,f.options.extraction]).slice(0,24));
  atomicWrite(path.join(sourceDir,'catalog.json'),Array.from({length:6},(_,i)=>({chapter_number:i+1,title:f.titles[i+1]||heading(i+1),link:f.base+'/c/'+(i+1)})));
  const chapters=[4,5,6].map(n=>({chapter_number:n,title:f.titles[n]||heading(n),content:body(n),link:f.base+'/c/'+n}));chapters.forEach(f.save);
  const evidenceFile=path.join(f.options.stateDir,'independent.json');atomicWrite(evidenceFile,{chapters,detail:'Independent complete prose and title sequence reviewed'});
  const choice={links:chapters.map(c=>c.link),hashes:chapters.map(c=>hash(c.content)),evidenceFile,evidenceHash:hash(fs.readFileSync(evidenceFile)),reason:'完整三章顺序已核对，旧末章少字版本保留',boundary:{file:path.basename(f.file),exportHash:hash(fs.readFileSync(f.file)),chapterHash:hash(f.book.chapters.at(-1))}};
  assert.throws(()=>recordContinuationSourceDefect(f.spec,f.options,choice),/显式衔接核对/);
  const anchor=recordContinuationAnchorReview(f.spec,f.options,{file:path.basename(f.file),oldNumber:4,newLink:chapters[0].link,oldHash:hash(f.book.chapters[3].content),newHash:hash(chapters[0].content),reason:'完整正文确认少字旧版与现版对应，保留旧版'});
  assert.throws(()=>recordContinuationSourceDefect(f.spec,f.options,choice),/显式衔接核对/);
  assert.throws(()=>recordContinuationSourceDefect(f.spec,f.options,{...choice,boundary:{...choice.boundary,anchorReviewKey:'stale'}}),/显式衔接核对/);
  const pinned={...choice,boundary:{...choice.boundary,anchorReviewKey:anchor.key}},changed={...chapters[0],content:chapters[0].content+'\n'};f.save(changed);
  assert.throws(()=>recordContinuationSourceDefect(f.spec,f.options,{...pinned,hashes:[hash(changed.content),...choice.hashes.slice(1)]}),/显式衔接核对/);f.save(chapters[0]);
  const decision=recordContinuationSourceDefect(f.spec,f.options,pinned);assert.equal(decision.boundary.anchorReviewKey,anchor.key);
  const result=await acquire(f.spec,{...f.options,continuation:localBookState(f.spec,f.options).continuation,mode:'download'});
  assert.equal(result.completeAgainstSource,true,JSON.stringify(result.failures));assert.deepEqual(readJson(f.file).chapters.slice(0,4),f.book.chapters);
});

test('a reviewed renumbered notice requires four pinned bodies and an independent consecutive narrative window',async t=>{
  const f=await fixture(t),sourceDir=path.join(f.options.stateDir,'continuations',continuationKey(f.spec),'sources',hash([f.spec.sourceUrl,f.options.extraction]).slice(0,24));
  f.book.chapters[2].link=f.base+'/c/3';
  f.book.chapters[3]={chapter_number:4,title:'请假一天',content:'今天身体不舒服，向大家请假一天，明天恢复更新。',link:f.base+'/c/4'};
  atomicWrite(f.file,f.book);
  const catalog=Array.from({length:6},(_,i)=>({chapter_number:i+1,title:i===3?'请假一天':heading(i+1),link:f.base+'/c/'+(i+1)}));
  atomicWrite(sourceDir+'/catalog.json',catalog);
  const prior={...catalog[2],content:body(3)},chapters=[{...f.book.chapters[3]},...catalog.slice(4).map(c=>({...c,content:body(c.chapter_number)}))];
  [prior,...chapters].forEach(f.save);
  const notice={position:4,link:chapters[0].link,previousTitle:'请假一天',currentTitle:'第4章 请假一天',checkpointHash:hash(chapters[0]),localChapterHash:hash(f.book.chapters[3]),incoming:{...chapters[0],title:'第4章 请假一天'}};
  notice.incomingHash=hash(notice.incoming);
  const writeNotice=value=>atomicWrite(sourceDir+'/catalog-notice-reviews.json',{value,hash:hash(value)});writeNotice([notice]);
  const refs=[heading(3),'第4章 山间故事5','第5章 山间故事6'].map((title,i)=>({title,link:'https://independent.example/c/'+(i+3)}));
  const referenceFile=path.join(f.options.stateDir,'reference.html');
  const writeReference=(entries=refs,author=f.spec.author)=>{atomicWrite(referenceFile,`<title>${f.spec.title}</title><b>${author}</b>${entries.map(c=>`<a href="${c.link}">${c.title}</a>`).join('')}`);return {url:'https://independent.example/book',bodyFile:referenceFile,hash:hash(fs.readFileSync(referenceFile)),chapters:refs};};
  const reference=writeReference(),evidenceFile=path.join(f.options.stateDir,'notice-evidence.json');atomicWrite(evidenceFile,{notice,reference});
  const context={chapterHash:hash(f.book.chapters[2]),link:prior.link,contentHash:hash(prior.content),reference};
  const choice={links:chapters.map(c=>c.link),hashes:chapters.map(c=>hash(c.content)),evidenceFile,evidenceHash:hash(fs.readFileSync(evidenceFile)),reason:'完整公告未变，独立目录证明前后正文连续；保留全部原文和来源编号',boundary:{file:path.basename(f.file),exportHash:hash(fs.readFileSync(f.file)),chapterHash:hash(f.book.chapters[3]),noticeContext:context}};
  const record=override=>recordContinuationSourceDefect(f.spec,f.options,{...choice,...override});
  assert.throws(()=>record({boundary:{...choice.boundary,noticeContext:undefined}}),/显式衔接核对/);
  writeNotice([]);assert.throws(()=>record(),/已核对的原公告/);writeNotice([notice]);
  assert.throws(()=>record({boundary:{...choice.boundary,noticeContext:{...context,chapterHash:'stale'}}}),/已核对的原公告/);
  f.save({...prior,content:prior.content+'不同的正文'});assert.throws(()=>record(),/完整正文/);f.save(prior);
  f.save({...chapters[0],content:'另外一次请假公告'});assert.throws(()=>record(),/完整检查点/);f.save(chapters[0]);
  for(const i of [1,2]){f.save({...chapters[i],content:chapters[i].content+'不同'});assert.throws(()=>record(),/完整检查点/);f.save(chapters[i]);}
  const missing={title:'第4章 遗失的正文',link:'https://independent.example/missing'};
  const gapReference=writeReference([refs[0],missing,...refs.slice(1)]);
  assert.throws(()=>record({boundary:{...choice.boundary,noticeContext:{...context,reference:gapReference}}}),/连续且无遗漏/);
  const wrongAuthor=writeReference(refs,'另一作者');assert.throws(()=>record({boundary:{...choice.boundary,noticeContext:{...context,reference:wrongAuthor}}}),/同书同作者/);writeReference();
  const decision=record();assert.equal(decision.boundary.noticeContext.chapterHash,context.chapterHash);
  const reviewer=()=>createContinuationReviewer(f.book,[],[],undefined,[],[],[decision]);
  const good=reviewer();assert.equal(good.accept(catalog[4],chapters[1]),true);assert.equal(good.accept(catalog[5],chapters[2]),true);good.finish();
  assert.deepEqual(fs.readFileSync(f.file),Buffer.from(JSON.stringify(f.book,null,2)+'\n'));
  const partial=reviewer();partial.accept(catalog[4],chapters[1]);assert.throws(()=>partial.finish(),/后续核对章缺失/);
  const changed=reviewer();changed.accept(catalog[4],chapters[1]);assert.throws(()=>changed.accept(catalog[5],{...chapters[2],content:body(30)}),/后续完整核对章已变化/);
  assert.throws(()=>reviewer().accept(catalog[4],{...chapters[1],content:body(30)}),/章号冲突/);
  const stale=structuredClone(f.book);stale.chapters[2].content+='\n';assert.throws(()=>createContinuationReviewer(stale,[],[],undefined,[],[],[decision]).accept(catalog[4],chapters[1]),/章号冲突/);
});
