import {test, expect, type Page} from '@playwright/test';

const base = process.env.SWIPE_LOADING_BASE || 'http://127.0.0.1:3027';
test.use({viewport:{width:390,height:844},isMobile:true,hasTouch:true});

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator,'connection',{value:{saveData:true,addEventListener(){},removeEventListener(){}}});
    document.addEventListener('DOMContentLoaded',() => {const style=document.createElement('style');style.textContent='nextjs-portal{display:none}';document.head.append(style);});
  });
  await page.route('**/api/books/*/views',route=>route.fulfill({json:{success:true,counted:false}}));
});

async function settled(page: Page) {
  await expect(page.locator('.mobile-section-snapshot')).toHaveCount(0);
  await expect(page.locator('.shelf-viewport[data-switching=true]')).toHaveCount(0);
}

for (const width of [320,390]) test(`${width}px short deliberate swipes switch outer sections and inner tabs but small or vertical drags do not`,async ({page,context}) => {
  await page.setViewportSize({width,height:844});
  const user={id:'000000000000000000000001',username:'滑动验证',role:'reader'};
  await page.route('**/api/auth/session',route=>route.fulfill({json:{user,profile:user}}));
  await page.route('**/api/users/*/library?*',route=>route.fulfill({json:[]}));
  await page.route('**/api/forum/posts*',route=>route.fulfill({json:[]}));
  await page.goto(base+'/');
  await expect(page.locator('.mobile-account-initial:visible')).toHaveText('滑');
  const cdp=await context.newCDPSession(page);
  const swipe=async (dx: number,dy=0) => {
    await settled(page);
    const x=width/2,y=330;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
    for(const part of [.34,.67,1]) {
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*part,y:y+dy*part,id:1}]});
      await page.waitForTimeout(70);
    }
    // No flick bonus: a gentle, slow release must still switch at 55px.
    await page.waitForTimeout(150);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await settled(page);
  };
  for(const dx of [-25,25]) {await swipe(dx);await expect(page).toHaveURL(base+'/');}
  await swipe(22,-110);await expect(page).toHaveURL(base+'/');
  await page.evaluate(()=>scrollTo(0,0));
  await swipe(55);await expect(page).toHaveURL(base+'/library');
  await swipe(55);await expect(page.getByRole('tab',{name:'浏览记录',exact:true})).toHaveAttribute('aria-selected','true');
  await swipe(-55);await expect(page.getByRole('tab',{name:'书架',exact:true})).toHaveAttribute('aria-selected','true');
  await swipe(-55);await expect(page).toHaveURL(base+'/');
  await swipe(-55);await expect(page).toHaveURL(base+'/forum');
  const tabs=page.getByRole('navigation',{name:'论坛内容分类'});
  await swipe(-55);await expect(tabs.getByRole('button',{name:'热榜',exact:true})).toHaveAttribute('aria-current','page');
  await swipe(-55);await expect(tabs.getByRole('button',{name:'关注',exact:true})).toHaveAttribute('aria-current','page');
  await swipe(55);await expect(tabs.getByRole('button',{name:'热榜',exact:true})).toHaveAttribute('aria-current','page');
  await swipe(55);await expect(tabs.getByRole('button',{name:'推荐',exact:true})).toHaveAttribute('aria-current','page');
  await swipe(55);await expect(page).toHaveURL(base+'/');
  await cdp.detach();
});

for(const width of [390,1440]) test(`${width}px book loading uses the site logo and dots cycle 0 to 3 without shifting the label`,async ({page},info) => {
  await page.setViewportSize({width,height:844});
  await page.goto(base+'/');
  const link=page.locator(width<768?'.mobile-home .mh-book':'.desktop-home a[href^="/book/"]').first();
  // Loading must reuse a small optimized logo, even when the full-size original is unavailable.
  await page.route('**/icon.png',route=>route.abort());
  const href=await link.getAttribute('href');
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**'+href+'?_rsc=*',async route=>{await gate;await route.continue();});
  try {
    await link.click();
    const loading=page.locator('.book-navigation-loading');
    await expect(loading).toBeVisible();
    await expect.poll(()=>loading.evaluate(element=>element.getBoundingClientRect().x)).toBeCloseTo(0,1);
    await expect(loading.locator('img.loading-logo')).toHaveAttribute('src',/\/_next\/image\?/);
    await expect.poll(()=>loading.locator('img').evaluate(image=>(image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth>0)).toBe(true);
    const dots=loading.locator('.loading-dots');
    await expect(dots).toHaveAttribute('aria-hidden','true');
    const stages=await dots.evaluate(async element=>{
      const animation=element.getAnimations({subtree:true})[0];animation.pause();
      const result=[];
      for(const currentTime of [100,500,900,1300,1700]) {
        animation.currentTime=currentTime;
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const box=element.parentElement!.getBoundingClientRect();
        result.push({dots:getComputedStyle(element,'::after').content,x:box.x,y:box.y,width:box.width,height:box.height});
      }
      return result;
    });
    expect(stages.map(stage=>stage.dots)).toEqual(['""','"."','".."','"..."','""']);
    expect(new Set(stages.map(stage=>stage.x)).size).toBe(1);
    expect(new Set(stages.map(stage=>stage.width)).size).toBe(1);
    expect(new Set(stages.map(stage=>stage.y)).size).toBe(1);
    expect(new Set(stages.map(stage=>stage.height)).size).toBe(1);
    expect(await loading.evaluate(element=>getComputedStyle(element,'::before').content)).toBe('none');
    await dots.evaluate(element=>{element.getAnimations({subtree:true})[0].currentTime=1300;});
    await page.screenshot({path:info.outputPath(`logo-loading-${width}.png`)});
    await page.goBack();
    await expect(page).toHaveURL(base+'/');
    await expect(loading).toHaveCount(0);
  } finally {release();}
});

test('account loading keeps its logo and shares the animated dots',async ({page},info) => {
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/auth/session',async route=>{await gate;await route.fulfill({json:{user:null,profile:null}});});
  try {
    await page.goto(base+'/library');
    const loading=page.locator('.account-loading');
    await expect(loading).toBeVisible();
    await expect(loading.locator('img')).toBeVisible();
    await expect(loading.locator('.loading-dots')).toBeVisible();
    expect(await loading.locator('.loading-dots').evaluate(element=>getComputedStyle(element,'::after').animationName)).toBe('loading-dots');
    await page.screenshot({path:info.outputPath('account-loading.png')});
  } finally {release();}
});
