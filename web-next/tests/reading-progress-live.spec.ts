import {test,expect,blockAnalytics} from './fixtures/without-analytics';
import type {APIRequestContext,BrowserContext,Page} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {readerParagraphs} from '../../shared/reader-paragraphs.mjs';

const base=process.env.READING_PROGRESS_BASE||'http://127.0.0.1:3000';
const fixture=JSON.parse(fs.readFileSync(path.resolve('.runtime/task-artifacts/android-v1/test-fixture-private.json'),'utf8'));
let book='';const chapters:Array<{id:string;content:string;title:string;chapter_number:number;contentVersion:string}>=[];
async function write(request:APIRequestContext,url:string,data:unknown,method='POST'){
 const csrf=await(await request.get(base+'/api/auth/csrf')).json();
 return request.fetch(base+url,{method,data,headers:{origin:base,'x-csrf-token':csrf.csrfToken,'Idempotency-Key':crypto.randomUUID()}});
}
async function login(request:APIRequestContext,role='author'){const a=fixture.accounts[role];const result=await write(request,'/api/auth/signin',{email:a.email,password:a.password});if(!result.ok())throw Error(`Fixture login ${result.status()}: ${(await result.json()).error}`);}
const getProgress=async(request:APIRequestContext)=>(await request.get(base+`/api/v1/me/reading-progress/${book}`)).json();
function position(index=0,paragraph=4,offset=27){const c=chapters[index],p=readerParagraphs(c.content,c.title,c.chapter_number);return {chapterId:c.id,contentVersion:c.contentVersion,paragraphKey:p[paragraph].key,charOffset:offset};}
async function remoteWrite(request:APIRequestContext,value:ReturnType<typeof position>){const current=await getProgress(request);const result=await write(request,`/api/v1/me/reading-progress/${book}`,{baseRevision:current.revision,operationId:crypto.randomUUID(),deviceId:'native-test-device-0001',position:value},'PUT');expect(result.ok()).toBe(true);return result.json();}
async function setup(context:BrowserContext,mode='horizontal'){
 await blockAnalytics(context);await login(context.request);
 await context.addInitScript(mode=>{localStorage.setItem('has-seen-reading-hint','true');localStorage.setItem('reader_turnMode',JSON.stringify(mode));localStorage.setItem('reader_fullscreen','false');},mode);
}
async function open(page:Page,index=0){await page.goto(`${base}/book/${book}/${chapters[index].id}`);await expect(page.locator('[data-reader-ready="true"]')).toBeVisible({timeout:90_000});}
async function local(page:Page){return page.evaluate(({id,book})=>JSON.parse(localStorage.getItem(`reader-progress:v1:${id}:${book}`)||'null'),{id:fixture.accounts.author.id,book});}
async function visible(page:Page,anchor:{paragraphKey:string;charOffset:number}){
 return page.evaluate(a=>{const p=document.querySelector(`.reader-page-window > .reader-page-surface [data-paragraph-key="${a.paragraphKey}"] .reader-paragraph-text`);if(!p?.firstChild)return false;
 const r=document.createRange();r.setStart(p.firstChild,a.charOffset);r.setEnd(p.firstChild,Math.min((p.textContent||'').length,a.charOffset+2));
 const b=p.closest('.reader-text-window')!.getBoundingClientRect();return [...r.getClientRects()].some(x=>x.right>b.left&&x.left<b.right&&x.bottom>b.top&&x.top<b.bottom);
 },anchor);
}
test.beforeAll(async({request})=>{
 test.setTimeout(180_000);await login(request,'admin');
 const created=await write(request,'/api/books',{title:`网页精确续读隔离 ${Date.now()}`,description:'Local progress integration fixture'});expect(created.ok()).toBe(true);book=(await created.json()).id;
 for(let n=1;n<=3;n++){
  const content=Array.from({length:18},(_,p)=>`章${n}段${p}：`+'山河灯火，繁體閱讀与简体文字 English 2026 😀👩‍💻。'.repeat(24)).join('\n\n');
  const c=await write(request,'/api/chapters',{bookId:book,title:`第${n}章 精确位置`,chapter_number:n,content});if(!c.ok())throw Error(`Create chapter ${c.status()}: ${(await c.json()).error}; book=${book}`);
  const id=(await c.json()).id;chapters.push(await(await request.get(base+`/api/chapters/${id}?navigation=1`)).json());
 }
 });
test.afterAll(async({request})=>{if(book){await login(request,'admin');await write(request,`/api/books/${book}`,{},'DELETE');}});

test('cloud UTF16 anchor restores without initial-zero PUT; page turn and font reflow retain exact position',async({browser,request})=>{
 test.setTimeout(150_000);await login(request);const seeded=await remoteWrite(request,position());
 const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});await setup(context);const page=await context.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await open(page);await expect.poll(async()=>(await local(page))?.local?.charOffset).toBe(27);expect(await visible(page,seeded.position)).toBe(true);
  await page.waitForTimeout(1000);expect((await getProgress(request)).revision).toBe(seeded.revision);
  await page.keyboard.press('ArrowRight');await expect.poll(async()=>(await getProgress(request)).revision).toBeGreaterThan(seeded.revision);
  const moved=(await getProgress(request)).position;expect(moved.charOffset).toBeGreaterThan(0);expect(await visible(page,moved)).toBe(true);
  await page.keyboard.press('m');await page.locator('.reader-tools').getByRole('button',{name:'设置',exact:true}).click();
  await page.getByRole('button',{name:'A+',exact:true}).click();await page.getByRole('button',{name:'增大行距',exact:true}).click();await page.getByRole('button',{name:'关闭阅读设置',exact:true}).click();
  expect((await local(page)).local.charOffset).toBe(moved.charOffset);expect(await visible(page,moved)).toBe(true);
  await page.setViewportSize({width:1280,height:900});await expect.poll(()=>visible(page,moved)).toBe(true);expect((await local(page)).local.charOffset).toBe(moved.charOffset);
  await page.reload();await expect(page.locator('[data-reader-ready="true"]')).toBeVisible();expect(await visible(page,moved)).toBe(true);expect(errors).toEqual([]);
 }finally{await context.close();}
});

test('body version changes require confirmation and deleted paragraph keys fall back by index',async({browser,request})=>{
 test.setTimeout(150_000);await login(request);await remoteWrite(request,position(0,4,27));
 const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});await setup(context);const page=await context.newPage();
 const admin=await browser.newContext();await login(admin.request,'admin');
 try{
  await open(page);
  const updated=chapters[0].content.replace('章1段4：','更新后的第四段：');
  expect((await write(admin.request,`/api/chapters/${chapters[0].id}`,{content:updated},'PATCH')).ok()).toBe(true);
  await page.keyboard.press('ArrowRight');await expect(page.getByRole('dialog',{name:'阅读位置冲突'})).toBeVisible();await expect(page.getByText('正文已更新',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'刷新正文并保留本机位置',exact:true}).click();await expect(page.getByRole('dialog',{name:'阅读位置冲突'})).not.toBeVisible();
  const current=await(await request.get(base+`/api/chapters/${chapters[0].id}?navigation=1`)).json();
  await expect.poll(async()=>(await getProgress(request)).position.contentVersion).toBe(current.contentVersion);
  const saved=(await getProgress(request)).position;expect(saved.paragraphIndex).toBe(4);expect(saved.charOffset).toBe(0);expect(await visible(page,saved)).toBe(true);
  chapters[0]=current;
 }finally{await context.close();await admin.close();}
});

test('offline outbox survives reload, conflicts preserve local and cloud choices, explicit chapter navigation is respected',async({browser,request})=>{
 test.setTimeout(150_000);await login(request);await remoteWrite(request,position(0,2,12));
 const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});await setup(context,'vertical');const page=await context.newPage();
 try{
  await open(page);await context.route('**/api/v1/me/reading-progress/**',route=>route.abort());
  await page.keyboard.press('ArrowDown');await expect.poll(async()=>Boolean((await local(page))?.pending)).toBe(true);const saved=(await local(page)).local;
  await page.reload();await expect(page.locator('[data-reader-ready="true"]')).toBeVisible();expect((await local(page)).local.paragraphKey).toBe(saved.paragraphKey);
  const cloud=await remoteWrite(request,position(0,1,3));await context.unroute('**/api/v1/me/reading-progress/**');await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await expect(page.getByRole('dialog',{name:'阅读位置冲突'})).toBeVisible();expect((await local(page)).local.charOffset).toBe(saved.charOffset);expect((await getProgress(request)).revision).toBe(cloud.revision);
  await page.getByRole('button',{name:'保留本机',exact:true}).click();await expect.poll(async()=>(await getProgress(request)).position.charOffset).toBe(saved.charOffset);
  const nextCloud=await remoteWrite(request,position(1,3,8));await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page.getByRole('dialog',{name:'阅读位置冲突'})).toBeVisible();
  await page.getByRole('button',{name:'使用云端',exact:true}).click();await expect(page).toHaveURL(new RegExp(chapters[1].id));await expect.poll(()=>visible(page,nextCloud.position)).toBe(true);
  await open(page,2);await expect(page).toHaveURL(new RegExp(chapters[2].id));await expect.poll(async()=>(await getProgress(request)).position.chapterId).toBe(chapters[2].id);
 }finally{await context.close();}
});

test('continuous scroll reports the visible document, restores after font changes and reload',async({browser,request})=>{
 test.setTimeout(150_000);await login(request);const seed=await remoteWrite(request,position(0,17,600));
 const context=await browser.newContext({viewport:{width:430,height:932},reducedMotion:'reduce'});await setup(context,'scroll');const page=await context.newPage();
 try{
  await open(page);expect(await visible(page,seed.position)).toBe(true);
  const view=page.locator('.reader-scroll-window');await expect(page.locator(`[data-scroll-chapter="${chapters[1].id}"]`)).toHaveCount(1);
  await view.evaluate((el,id)=>{const next=el.querySelector(`[data-scroll-chapter="${id}"]`)!;el.scrollTop+=next.getBoundingClientRect().top-el.getBoundingClientRect().top+330;},chapters[1].id);
  await expect.poll(async()=>(await getProgress(request)).position.chapterId).toBe(chapters[1].id);
  const saved=(await getProgress(request)).position;expect(saved.charOffset).toBeGreaterThan(0);
  await page.keyboard.press('m');await page.locator('.reader-tools').getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'A+',exact:true}).click();await page.getByRole('button',{name:'关闭阅读设置',exact:true}).click();
  expect((await local(page)).local.charOffset).toBe(saved.charOffset);expect(await visible(page,saved)).toBe(true);
  await page.reload();await expect(page.locator('[data-reader-ready="true"]')).toBeVisible();expect(await visible(page,saved)).toBe(true);
 }finally{await context.close();}
});

test('a stale tab never uploads the old account outbox through another account cookie',async({browser,request})=>{
 test.setTimeout(150_000);await login(request);await remoteWrite(request,position(0,2,17));
 const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});await setup(context);const page=await context.newPage();
 try{
  await open(page);await login(context.request,'reader');const before=await getProgress(context.request);
  await page.keyboard.press('ArrowRight');await expect(page.getByRole('status').filter({hasText:'登录账户已变化'})).toBeVisible();
  expect((await local(page)).pending).not.toBeNull();expect((await getProgress(context.request)).revision).toBe(before.revision);
  await page.reload();await expect(page.locator('[data-reader-ready="true"]')).toBeVisible();
  const old=await local(page);expect(old.account).toBe(fixture.accounts.author.id);expect(old.pending).not.toBeNull();
 }finally{await context.close();}
});
