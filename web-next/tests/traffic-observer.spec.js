import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
const script=fs.readFileSync(path.resolve('web-next/public/traffic-observer.js'),'utf8');

test('观察脚本只记录实际页面、串行开启、忽略输入与预取，页面切换完成旧记录',async({page})=>{
  const events=[];let activeOpens=0,maxOpens=0;
  await page.route('https://traffic.test/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/traffic-observer.js')return route.fulfill({contentType:'text/javascript',body:script});
    if(url.pathname==='/api/auth/csrf')return route.fulfill({json:{csrfToken:'fixture-csrf'}});
    if(url.pathname==='/api/traffic/observe'){
      expect(route.request().headers()['x-csrf-token']).toBe('fixture-csrf');const event=route.request().postDataJSON();events.push(event);
      if(event.kind==='open'){maxOpens=Math.max(maxOpens,++activeOpens);await new Promise(r=>setTimeout(r,30));activeOpens--;}
      return route.fulfill({json:{accepted:true,...(event.kind==='open'?{token:'fixture-'+event.id}:{})}});
    }
    if(url.pathname.startsWith('/api/chapters'))return route.fulfill({json:{content:'test'}});
    return route.fulfill({contentType:'text/html; charset=utf-8',body:'<html><body style="height:4000px"><input id="private"/><div class="reader-pages-root">reading</div><script type="module" src="/traffic-observer.js"></script></body></html>'});
  });
  await page.clock.install();await page.goto('https://traffic.test/?q=private-search');await expect.poll(()=>events.filter(e=>e.kind==='open').length).toBe(1);
  await page.locator('#private').fill('private-user-email@example.test');
  await page.evaluate(async()=>{await fetch('/api/chapters/'+'a'.repeat(24));history.pushState({},'', '/?q=another-private-value');document.body.append(document.createElement('span'));});
  await page.clock.fastForward(10000);await expect.poll(()=>events.filter(e=>e.kind==='update').length).toBeGreaterThan(0);
  expect(events.filter(e=>e.kind==='open')).toHaveLength(1);expect(events.find(e=>e.kind==='update').interactions).toBe(0);
  await page.mouse.move(250,250);await page.mouse.wheel(0,200);await page.clock.fastForward(11000);
  await page.evaluate(()=>{history.pushState({},'', '/book/'+'b'.repeat(24)+'/'+'c'.repeat(24));document.body.append(document.createElement('span'));});
  await expect.poll(()=>events.filter(e=>e.kind==='open').length).toBe(2);await expect.poll(()=>events.some(e=>e.kind==='update'&&e.complete)).toBe(true);
  const open=events.filter(e=>e.kind==='open').at(-1);expect(open.type).toBe('chapter');expect(open.target).toBe('c'.repeat(24));
  await page.evaluate(()=>{for(let i=0;i<3;i++)setTimeout(()=>{history.replaceState({},'', '/book/'+'b'.repeat(24)+'/'+String(i).padStart(24,'a'));document.body.append(document.createElement('span'));},i*10);});
  await page.clock.fastForward(100);await expect.poll(()=>events.filter(e=>e.kind==='open').length).toBeGreaterThan(2);expect(maxOpens).toBe(1);
  const sent=JSON.stringify(events);expect(sent).not.toContain('private-search');expect(sent).not.toContain('private-user-email');expect(sent).not.toContain('another-private-value');
});

test('上报失败后恢复，不影响页面；会话过期后重开，关闭后台不累计可见时长',async({page})=>{
  const events=[];let fail=true,expire=false;
  await page.route('https://traffic.test/**',async route=>{
    const pathname=new URL(route.request().url()).pathname;
    if(pathname==='/traffic-observer.js')return route.fulfill({contentType:'text/javascript',body:script});
    if(pathname==='/api/auth/csrf')return route.fulfill({json:{csrfToken:'csrf'}});
    if(pathname==='/api/traffic/observe'){const event=route.request().postDataJSON();events.push(event);if(fail)return route.fulfill({status:503,json:{error:'test'}});if(expire&&event.kind==='update'){expire=false;return route.fulfill({status:409,json:{error:'expired'}});}return route.fulfill({json:{accepted:true,token:'test-'+event.id}});}
    return route.fulfill({contentType:'text/html; charset=utf-8',body:'<body><h1>阅读仍可用</h1><script type="module" src="/traffic-observer.js"></script></body>'});
  });
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.clock.install();await page.goto('https://traffic.test/');await expect.poll(()=>events.length).toBe(1);await expect(page.getByRole('heading')).toHaveText('阅读仍可用');
  fail=false;await page.clock.fastForward(10000);await expect.poll(()=>events.filter(e=>e.kind==='open').length).toBe(2);await page.clock.fastForward(10000);await expect.poll(()=>events.some(e=>e.kind==='update')).toBe(true);
  expire=true;await page.clock.fastForward(10000);await expect.poll(()=>events.filter(e=>e.kind==='open').length).toBe(3);
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});await page.clock.fastForward(120000);
  const before=events.filter(e=>e.kind==='update').at(-1)?.visibleMs;await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));});
  await expect.poll(()=>events.filter(e=>e.kind==='update').at(-1)?.visibleMs).toBe(before);expect(errors).toEqual([]);
});
