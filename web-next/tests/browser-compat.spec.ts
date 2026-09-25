import type {Page} from '@playwright/test';
import {test,expect} from './fixtures/without-analytics';

const base=process.env.COMPAT_BASE || 'http://127.0.0.1:3000';
const book=process.env.COMPAT_BOOK || '000000000000000000000101';
const chapter=process.env.COMPAT_CHAPTER || book;
const detail=`${base}/book/${book}`,reader=`${detail}/${chapter}`;
const root=(page:Page)=>page.locator('.reader-pages-root:visible');
const pageNumber=(page:Page)=>root(page).locator('.reader-page-window > .reader-page-surface [data-reader-page]');
async function ready(page:Page){
  await expect(root(page)).toHaveAttribute('data-reader-ready','true');
  await expect(page.locator('.reader-entry-content')).toHaveAttribute('data-entry-pending','false');
  await expect(page.locator('.chapter-loading-page,.reader-fullscreen-cover,.book-transition-snapshot')).toHaveCount(0);
}
async function settings(page:Page){
  if(await page.locator('.reader-tools').getAttribute('aria-hidden')==='true')await page.keyboard.press('m');
  await page.locator('.reader-tools').getByRole('button',{name:'设置',exact:true}).tap();
  await expect(page.getByRole('dialog',{name:'阅读设置'})).toBeVisible();
}
async function closeSettings(page:Page){
  await page.getByRole('button',{name:'关闭阅读设置'}).tap();
  await expect(page.getByRole('dialog',{name:'阅读设置'})).toBeHidden();
  if(await page.locator('.reader-tools').getAttribute('aria-hidden')==='false')await page.keyboard.press('m');
  await expect(page.locator('.reader-tools')).toHaveAttribute('aria-hidden','true');
}
test.beforeEach(async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem('has-seen-reading-hint','true');
    document.addEventListener('DOMContentLoaded',()=>{
      const style=document.createElement('style');style.textContent='nextjs-portal{display:none!important}';document.head.append(style);
    });
  });
  await page.route('**/api/books/*/views',route=>route.fulfill({json:{success:true,counted:false}}));
  // Both counters are excluded from verification. The observer treats 204 as
  // disabled, preventing retries with the synthetic token during navigation.
  await page.route('**/api/traffic/observe',route=>route.fulfill({status:204}));
  await page.route('**/api/auth/csrf',route=>route.fulfill({json:{csrfToken:'browser-verification'}}));
});

test('detail, pagination, settings and scrolling survive mobile resize',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(detail);
  await expect(page.locator('.book-hero h1')).toHaveCount(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('.read-now:visible').tap();await ready(page);
  await page.touchscreen.tap(340,400);
  await expect(pageNumber(page)).toHaveText(/^2\//);
  await page.reload();await ready(page);await expect(pageNumber(page)).toHaveText(/^2\//);
  for(const size of [{width:320,height:600},{width:844,height:390},{width:390,height:844}]){
    await page.setViewportSize(size);
    await expect.poll(()=>root(page).locator('.reader-frame').evaluate(el=>Math.round(el.getBoundingClientRect().height))).toBe(size.height);
    await settings(page);
    await expect(page.getByRole('button',{name:'关闭阅读设置'})).toBeInViewport();
    await page.getByRole('button',{name:'关闭阅读设置'}).tap();
    await expect(page.locator('.reader-tools')).toBeInViewport({ratio:1});
    await page.keyboard.press('m');
  }
  await settings(page);await page.getByRole('button',{name:'上下翻页',exact:true}).tap();
  await closeSettings(page);
  await expect(root(page)).toHaveAttribute('data-mode','vertical');
  await settings(page);await page.getByRole('button',{name:'上下滚屏',exact:true}).tap();
  await closeSettings(page);
  await expect(root(page)).toHaveAttribute('data-mode','scroll');
  const view=root(page).locator('.reader-scroll-window');
  await view.evaluate(el=>{el.scrollTop+=450;});
  await expect.poll(()=>view.evaluate(el=>el.scrollTop)).toBeGreaterThan(300);
  await page.screenshot({path:info.outputPath('verified-mobile-reader.png')});
  expect(errors).toEqual([]);
});

for(const failure of ['absent','throws','no-finished','stalled'] as const){
  test(`animation ${failure}: detail navigation and chapter turns stay usable`,async({page})=>{
    const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(failure=>{
      const original=Element.prototype.animate;
      if(failure==='absent')Object.defineProperty(Element.prototype,'animate',{value:undefined,configurable:true});
      else Element.prototype.animate=function(...args:Parameters<typeof original>){
        if(failure==='throws')throw new Error('Animation unavailable');
        const animation=original.apply(this,args);
        if(failure==='stalled')animation.pause();
        else Object.defineProperty(animation,'finished',{value:undefined});
        return animation;
      };
    },failure);
    await page.goto(base);
    await page.locator(`.mobile-home a[href="/book/${book}"]:not([data-banner-clone]):visible`).first().tap();
    await expect(page).toHaveURL(detail);
    await expect(page.locator('html')).not.toHaveAttribute('data-book-transition',/.+/);
    await page.locator('.read-now:visible').tap();await ready(page);
    await page.touchscreen.tap(340,400);
    await expect(pageNumber(page)).toHaveText(/^2\//);
    await expect(root(page).locator('.reader-page-window')).not.toHaveAttribute('data-turning',/.+/);
    await page.goBack();await expect(page).toHaveURL(detail);
    await expect(page.locator('html')).not.toHaveAttribute('data-book-transition',/.+/);
    expect(errors).toEqual([]);
  });
}

test('prefixed fullscreen waits for native events and exits from settings',async({page})=>{
  await page.addInitScript(()=>{
    let active:Element|null=null;
    Object.defineProperty(document,'fullscreenEnabled',{value:false});
    Object.defineProperty(document,'webkitFullscreenEnabled',{value:true});
    Object.defineProperty(document,'webkitFullscreenElement',{get:()=>active});
    Object.defineProperty(Element.prototype,'webkitRequestFullscreen',{value:()=>{
      setTimeout(()=>{active=document.documentElement;document.dispatchEvent(new Event('webkitfullscreenchange'));},60);
    }});
    Object.defineProperty(document,'webkitExitFullscreen',{value:()=>{
      setTimeout(()=>{active=null;document.dispatchEvent(new Event('webkitfullscreenchange'));},60);
    }});
  });
  await page.goto(reader);await ready(page);await settings(page);
  const group=page.getByRole('group',{name:'全屏阅读'});
  await group.getByRole('button',{name:'是',exact:true}).tap();
  await expect(page.locator('.reader-fullscreen-cover')).toHaveCount(0);
  await expect(group.getByRole('button',{name:'是',exact:true})).toBeEnabled();
  expect(await page.evaluate(()=>Boolean((document as Document & {webkitFullscreenElement?:Element}).webkitFullscreenElement))).toBe(true);
  await group.getByRole('button',{name:'否',exact:true}).tap();
  await expect(page.locator('.reader-fullscreen-cover')).toHaveCount(0);
  expect(await page.evaluate(()=>Boolean((document as Document & {webkitFullscreenElement?:Element}).webkitFullscreenElement))).toBe(false);
  await expect(page).toHaveURL(reader);
});

test('no fullscreen API keeps ordinary reading and settings available',async({page})=>{
  await page.addInitScript(()=>{
    Object.defineProperty(document,'fullscreenEnabled',{value:false});
    Object.defineProperty(document,'webkitFullscreenEnabled',{value:false});
  });
  await page.goto(reader);await ready(page);await settings(page);
  await expect(page.getByRole('group',{name:'全屏阅读'}).getByRole('button',{name:'是',exact:true})).toBeDisabled();
  await closeSettings(page);
  await page.touchscreen.tap(340,400);
  await expect(pageNumber(page)).toHaveText(/^2\//);
});

test('silent fullscreen failure releases the cover and lets the reader retry',async({page})=>{
  await page.addInitScript(()=>{
    Object.defineProperty(document,'fullscreenEnabled',{value:false});
    Object.defineProperty(document,'webkitFullscreenEnabled',{value:true});
    Object.defineProperty(Element.prototype,'webkitRequestFullscreen',{value:()=>{}});
    Object.defineProperty(document,'webkitExitFullscreen',{value:()=>{}});
  });
  await page.goto(reader);await ready(page);await settings(page);
  const yes=page.getByRole('group',{name:'全屏阅读'}).getByRole('button',{name:'是',exact:true});
  await yes.tap();
  await expect(page.locator('.reader-navigation-error')).toContainText('未能切换全屏');
  await expect(page.locator('.reader-fullscreen-cover')).toHaveCount(0);
  await expect(yes).toBeEnabled();
  await expect(page).toHaveURL(reader);
});

test('legacy viewport and resize fallback preserve readable pages',async({page})=>{
  await page.addInitScript(()=>{
    Object.defineProperty(window,'ResizeObserver',{value:undefined});
    const supports=CSS.supports.bind(CSS);
    CSS.supports=((...args:string[])=>args.includes('100dvh')?false:Reflect.apply(supports,CSS,args)) as typeof CSS.supports;
  });
  await page.goto(reader);await ready(page);
  for(const height of [640,780,540]){
    await page.setViewportSize({width:390,height});
    await expect.poll(()=>root(page).locator('.reader-frame').evaluate(el=>Math.round(el.getBoundingClientRect().height))).toBe(height);
    await expect(pageNumber(page)).not.toHaveText('1/1');
  }
});

test('reduced motion skips animated turning and copy fallback remains selectable',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.addInitScript(()=>{
    Object.defineProperty(navigator,'share',{value:undefined});
    Object.defineProperty(navigator,'clipboard',{value:undefined});
    document.execCommand=()=>false;
  });
  await page.route('https://jsapi.qq.com/**',route=>route.abort());
  await page.goto(detail);await page.getByRole('button',{name:'分享书籍'}).tap();
  await page.getByRole('button',{name:'复制',exact:true}).tap();
  await expect(page.locator('.book-share-message')).toContainText('长按');
  const input=page.getByRole('textbox',{name:'书名和分享链接'});
  expect(await input.evaluate(el=>getComputedStyle(el).fontSize)).toBe('16px');
  expect(await input.evaluate(el=>(el as HTMLInputElement).selectionEnd)).toBe((await input.inputValue()).length);
  if(/Android 8/.test(await page.evaluate(()=>navigator.userAgent)))await expect(page.locator('.book-share-apps')).not.toContainText('Safari');
  await page.getByRole('button',{name:'关闭分享'}).tap();
  await page.locator('.read-now:visible').tap();await ready(page);
  await page.touchscreen.tap(340,400);
  await expect(pageNumber(page)).toHaveText(/^2\//);
  await expect(root(page).locator('.reader-page-window')).not.toHaveAttribute('data-turning',/.+/);
});
