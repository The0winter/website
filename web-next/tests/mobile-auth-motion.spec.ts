import {test, expect} from './fixtures/without-analytics';
import type {Page} from '@playwright/test';

const base=process.env.AUTH_ENTRY_BASE || 'http://127.0.0.1:3000';
test.use({viewport:{width:393,height:851},isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36 Quark/7.0.0.0'});
type Exit={side:string;duration:number;transform:string};
const exits=(page:Page)=>page.evaluate(()=>(window as unknown as Window & {authExits:Exit[]}).authExits);
const settled=(page:Page)=>page.evaluate(()=>Promise.all(document.querySelector('.login-page, .register-page')?.getAnimations().map(a=>a.finished.catch(()=>{})) || []));

test.beforeEach(async({page})=>{
  await page.route('**/api/auth/session',route=>route.fulfill({status:401,contentType:'application/json',body:'{}'}));
  await page.addInitScript(()=>{
    const records:Exit[]=[];Object.assign(window,{authExits:records});
    const animate=Element.prototype.animate;
    Element.prototype.animate=function(frames,options){
      if(this instanceof HTMLElement && this.matches('.auth-exit-snapshot')) records.push({side:this.dataset.authExitSide!,duration:Number((options as KeyframeAnimationOptions).duration),transform:String((frames as Keyframe[]).at(-1)?.transform)});
      return animate.call(this,frames,options);
    };
    document.addEventListener('DOMContentLoaded',()=>{const style=document.createElement('style');style.textContent='nextjs-portal {display:none}';document.head.append(style);});
  });
});

for(const entry of ['avatar','shelf'] as const){
  test(`${entry}: 400ms entry and exit use the originating edge through Back, Forward and reload`,async({page},info)=>{
    await page.goto(base);
    const trigger=page.locator(entry==='avatar'?'.mobile-account-link:visible':'.mh-bottom [data-section="library"]');
    await expect(trigger).toHaveAttribute('href','/login');await trigger.click();
    const side=entry==='shelf'?'left':'right',x=entry==='shelf'?'-100%':'100%';
    await expect(page.locator('.login-page')).toHaveCSS('animation-duration','0.4s');
    await expect.poll(()=>page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--auth-enter-x'))).toBe(x);
    await settled(page);
    await page.screenshot({path:info.outputPath(`final-${entry}-center.png`)});
    await page.getByRole('button',{name:'返回',exact:true}).click();
    await expect(page).toHaveURL(base+'/');
    await expect.poll(()=>exits(page)).toEqual([{side,duration:400,transform:`translate3d(${x},0,0)`}]);
    await expect(page.locator('.auth-exit-viewport')).toHaveCount(0);
    await page.goForward();await expect(page.locator('.login-card')).toBeVisible();
    await expect.poll(()=>page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--auth-enter-x'))).toBe(x);
    await settled(page);await page.goBack();
    await expect.poll(async()=> (await exits(page)).length).toBe(2);
    await page.goForward();await page.reload();await expect(page.locator('.login-card')).toBeVisible();
    await settled(page);await page.goBack();await expect(page).toHaveURL(base+'/');
    await expect.poll(async()=> (await exits(page))[0]?.side).toBe(side);
    await expect(page.locator('.auth-exit-viewport')).toHaveCount(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  });
}

test('login/register transitions reverse on Back and retain the shelf origin',async({page})=>{
  await page.goto(base);await page.locator('.mh-bottom [data-section="library"]').click();await settled(page);
  await page.locator('.login-register a').click();await expect(page.locator('.register-card')).toBeVisible();
  await expect.poll(async()=> (await exits(page)).at(-1)?.side).toBe('left');await settled(page);
  await page.getByRole('button',{name:'返回',exact:true}).click();await expect(page.locator('.login-card')).toBeVisible();
  await expect.poll(async()=> (await exits(page)).at(-1)?.side).toBe('right');
  await expect.poll(()=>page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--auth-enter-x'))).toBe('-100%');
  await settled(page);await page.getByRole('button',{name:'返回',exact:true}).click();
  await expect.poll(async()=> (await exits(page)).at(-1)?.side).toBe('left');
  await expect(page.locator('.auth-exit-viewport')).toHaveCount(0);
});

for(const visualViewport of [true,false]){
  test(`Quark centering uses visible height, resizes and permits short-screen scrolling (visualViewport=${visualViewport})`,async({page},info)=>{
    await page.addInitScript(enabled=>{
      if(!enabled){Object.defineProperty(window,'visualViewport',{value:undefined});return;}
      const viewport=Object.assign(new EventTarget(),{height:720,scale:1});
      Object.defineProperty(window,'visualViewport',{value:viewport});
      Object.assign(window,{resizeAuthViewport:(height:number)=>{viewport.height=height;viewport.dispatchEvent(new Event('resize'));}});
    },visualViewport);
    await page.goto(base+'/login');await settled(page);
    const center=()=>page.locator('.login-card').evaluate(e=>{const r=e.getBoundingClientRect();return r.top+r.height/2;});
    await expect.poll(center).toBeCloseTo((visualViewport?720:851)/2,0);
    if(visualViewport) await page.evaluate(()=>(window as unknown as Window & {resizeAuthViewport:(height:number)=>void}).resizeAuthViewport(650));
    else await page.setViewportSize({width:393,height:650});
    await expect.poll(center).toBeCloseTo(325,0);
    await page.screenshot({path:info.outputPath(`final-quark-center-${visualViewport}.png`)});
    if(visualViewport) await page.evaluate(()=>(window as unknown as Window & {resizeAuthViewport:(height:number)=>void}).resizeAuthViewport(340));
    await page.setViewportSize({width:393,height:340});
    await page.getByPlaceholder('请输入用户名').fill('仍可输入');
    await page.getByPlaceholder('请输入密码').fill('test-password');
    await page.locator('.login-register a').scrollIntoViewIfNeeded();
    await page.locator('.login-register a').click();await expect(page.locator('.register-card')).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  });
}

for(const fallback of ['reduced','missing-animation']){
  test(`${fallback}: Back still works and removes exit surfaces`,async({page})=>{
    if(fallback==='reduced') await page.emulateMedia({reducedMotion:'reduce'});
    else await page.addInitScript(()=>Object.defineProperty(Element.prototype,'animate',{value:undefined}));
    await page.goto(base+'/login');await expect.poll(()=>page.evaluate(()=>Boolean(history.state?.loginNavigation))).toBe(true);await settled(page);await page.goBack();
    await expect(page).toHaveURL(base+'/');await expect(page.locator('.mobile-home')).toBeVisible();
    await expect(page.locator('.auth-exit-viewport')).toHaveCount(0);
  });
}
