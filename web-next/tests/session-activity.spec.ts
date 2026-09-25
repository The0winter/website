import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {test,expect} from './fixtures/without-analytics';
import type {Page} from '@playwright/test';

type ActivityWindow = Window & {
  startReady:boolean; activityCalls:number; expiredCalls:number; activityResult:boolean|'error';
  begin:()=>void; stopActivity:()=>void; forceVisibility:(state:string)=>void;
};

const script=ts.transpileModule(fs.readFileSync(path.resolve('web-next/lib/session-activity.ts'),'utf8'),
  {compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ES2020}}).outputText;
const interval=5*60*1000;
async function setup(page:Page, installClock=true) {
  await page.route('https://session.example.test/**',route=>route.fulfill({contentType:'text/html',body:'<button>Read next</button>'}));
  await page.goto('https://session.example.test/');
  if(installClock){
    await page.clock.install({time:new Date('2026-09-25T10:00:00Z')});
    await page.clock.pauseAt(new Date('2026-09-25T10:00:01Z'));
  }
  await page.addScriptTag({type:'module',content:script+`
    window.activityCalls=0;window.expiredCalls=0;window.activityResult=true;
    window.begin=()=>window.stopActivity=startSessionActivity('reader',async()=>{
      window.activityCalls++;if(window.activityResult==='error')throw Error('offline');return window.activityResult;
    },()=>window.expiredCalls++);
    window.forceVisibility=(state)=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:state});document.dispatchEvent(new Event('visibilitychange'));};
    window.startReady=true;`});
  await page.waitForFunction(()=>Boolean((window as unknown as ActivityWindow).startReady));
  await page.evaluate(()=>{(window as unknown as ActivityWindow).forceVisibility('visible');(window as unknown as ActivityWindow).begin();});
  await page.clock.runFor(1);
}
const count=(page:Page)=>page.evaluate(()=>(window as unknown as ActivityWindow).activityCalls);
test('activity burst is coalesced, idle pages stop, hidden pages stop and resume renews',async({page})=>{
  await setup(page);await expect.poll(()=>count(page)).toBe(1);
  await page.evaluate(()=>{for(let i=0;i<1000;i++)window.dispatchEvent(new Event('scroll'));});
  await page.clock.runFor(interval-2);expect(await count(page)).toBe(1);
  await page.clock.runFor(2);await expect.poll(()=>count(page)).toBe(2);
  await page.clock.runFor(interval*20);expect(await count(page)).toBe(2);
  await page.evaluate(()=>{(window as unknown as ActivityWindow).forceVisibility('hidden');window.dispatchEvent(new Event('scroll'));});
  await page.clock.runFor(interval*20);expect(await count(page)).toBe(2);
  await page.evaluate(()=>(window as unknown as ActivityWindow).forceVisibility('visible'));
  await page.clock.runFor(1);await expect.poll(()=>count(page)).toBe(3);
  await page.evaluate(()=>(window as unknown as ActivityWindow).stopActivity());
  await page.clock.runFor(interval);await page.evaluate(()=>window.dispatchEvent(new Event('scroll')));
  await page.clock.runFor(1);expect(await count(page)).toBe(3);
});
test('tabs share the activity budget',async({page,context})=>{
  await setup(page);await expect.poll(()=>count(page)).toBe(1);
  const other=await context.newPage();await setup(other,false);expect(await count(other)).toBe(0);
  await other.clock.runFor(interval);await expect.poll(()=>count(other)).toBe(1);
  await page.evaluate(()=>window.dispatchEvent(new Event('scroll')));await page.clock.runFor(1);
  expect(await count(page)).toBe(1);
});
test('network failures are throttled and expired login stops reporting',async({page})=>{
  await setup(page);await expect.poll(()=>count(page)).toBe(1);
  await page.evaluate(()=>{(window as unknown as ActivityWindow).activityResult='error';window.dispatchEvent(new Event('keydown'));});
  await page.clock.runFor(interval);await expect.poll(()=>count(page)).toBe(2);
  expect(await page.evaluate(()=>(window as unknown as ActivityWindow).expiredCalls)).toBe(0);
  await page.evaluate(()=>{for(let i=0;i<100;i++)window.dispatchEvent(new Event('scroll'));});
  await page.clock.runFor(interval-1);expect(await count(page)).toBe(2);
  await page.evaluate(()=>(window as unknown as ActivityWindow).activityResult=false);
  await page.clock.runFor(2);await expect.poll(()=>page.evaluate(()=>(window as unknown as ActivityWindow).expiredCalls)).toBe(1);
  await page.clock.runFor(interval*10);expect(await count(page)).toBe(3);
});
