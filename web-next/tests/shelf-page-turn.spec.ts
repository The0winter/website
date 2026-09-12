import {test, expect, type Page, type BrowserContext} from '@playwright/test';

const base = process.env.SHELF_NAVIGATION_BASE || 'http://127.0.0.1:3000';
const user = {id: '000000000000000000000001', username: '书架翻页验证', role: 'reader'};

async function setup(page: Page, width: number, historyGate?: Promise<void>) {
  await page.setViewportSize({width, height: 844});
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'connection', {value: {saveData: true, addEventListener() {}, removeEventListener() {}}});
    document.addEventListener('DOMContentLoaded', () => {const style = document.createElement('style'); style.textContent = 'nextjs-portal{display:none}'; document.head.append(style);});
  });
  await page.route('**/api/auth/session', route => route.fulfill({json: {user, profile: user}}));
  await page.route('**/api/users/*/library?*', async route => {
    const history = new URL(route.request().url()).searchParams.get('tab') === 'history';
    if (history) await historyGate;
    await route.fulfill({json: Array.from({length: history ? 3 : 1}, (_, i) => ({
      bookId: String(i + 1), book: {id: String(i + 1), title: `${history ? '浏览记录' : '书架'}作品 ${i + 1}`, author: '测试作者'},
    }))});
  });
  await page.goto(base + '/library?sort=updated&page=2');
  await expect(page.locator('#shelf-content .shelf-row h2')).toHaveText(['书架作品 1']);
}

async function swipe(page: Page, context: BrowserContext, direction: number) {
  const box = (await page.locator('.shelf-viewport').boundingBox())!;
  const x = box.x + box.width * (direction > 0 ? .8 : .2), y = box.y + 65;
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {type:'touchStart', touchPoints:[{x,y,id:1}]});
  for(let i=1;i<=6;i++) await cdp.send('Input.dispatchTouchEvent', {type:'touchMove', touchPoints:[{x:x-direction*i*20,y,id:1}]});
  await cdp.send('Input.dispatchTouchEvent', {type:'touchEnd', touchPoints:[]});
  await cdp.detach();
}

async function pause(page: Page) {
  await expect(page.locator('.shelf-viewport')).toHaveAttribute('data-switching', 'true');
  return page.locator('.shelf-viewport').evaluate(host => {
    const incoming = host.querySelector('#shelf-content')!, outgoing = host.querySelector('[data-active=false]')!;
    const animations = [incoming, outgoing].flatMap(element => element.getAnimations());
    animations.forEach(animation => {animation.pause(); animation.currentTime = Number(animation.effect!.getTiming().duration) / 2;});
    const a = incoming.getBoundingClientRect(), b = outgoing.getBoundingClientRect(), bounds = host.getBoundingClientRect();
    return {durations: animations.map(animation => animation.effect!.getTiming().duration), a:a.x,b:b.x,width:bounds.width,left:bounds.x,
      opacities:[incoming,outgoing].map(element => getComputedStyle(element).opacity), inert: (outgoing as HTMLElement).inert};
  });
}

async function resume(page: Page) {
  await page.locator('.shelf-viewport').evaluate(host => host.getAnimations({subtree:true}).forEach(animation=>animation.play()));
  await expect(page.locator('.shelf-viewport')).not.toHaveAttribute('data-switching', 'true');
  await expect(page.locator('.shelf-viewport')).not.toHaveAttribute('inert', '');
}

for (const width of [320,390,1440]) for (const method of ['click','swipe']) {
  test(`${width}px ${method} moves both shelf pages together in opposite directions`, async ({page,context}, info) => {
    await setup(page,width);
    const historyLength=await page.evaluate(()=>history.length);
    const bottom=await page.locator('.mh-bottom').boundingBox();
    for (const direction of [1,-1]) {
      if(method==='click') await page.getByRole('tab',{name:direction>0?'浏览记录':'书架',exact:true}).click();
      else await swipe(page,context,direction);
      const frame=await pause(page);
      expect(frame.durations[0]).toBe(frame.durations[1]);
      expect(frame.durations[0]).toBeLessThanOrEqual(300);
      expect(frame.durations[0]).toBeGreaterThanOrEqual(120);
      expect(frame.opacities).toEqual(['1','1']);
      expect(frame.inert).toBe(true);
      expect(Math.abs((frame.a-frame.b)*direction-frame.width)).toBeLessThan(1);
      expect((frame.a-frame.left)*direction).toBeGreaterThan(0);
      expect((frame.a-frame.left)*direction).toBeLessThan(frame.width);
      expect((frame.b-frame.left)*direction).toBeLessThan(0);
      expect(await page.locator('.mh-bottom').boundingBox()).toEqual(bottom);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.screenshot({path:info.outputPath(`${direction>0?'history':'shelf'}-mid-turn.png`)});
      await resume(page);
      await expect(page.locator('#shelf-content .shelf-row h2')).toHaveText(direction>0?['浏览记录作品 1','浏览记录作品 2','浏览记录作品 3']:['书架作品 1']);
      await expect(page).toHaveURL(base+'/library?'+(direction>0?'tab=history&':'')+'sort=updated');
      expect(await page.evaluate(()=>history.length)).toBe(historyLength);
    }
  });
}

test('slow history data keeps one page movement and rapid tab clicks settle on the last choice', async ({page}) => {
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  try {
    await setup(page,390,gate);
    await page.getByRole('tab',{name:'浏览记录'}).click();
    await pause(page);
    await expect(page.locator('#shelf-content')).toHaveAttribute('aria-busy','true');
    await resume(page);
    release();
    await expect(page.locator('#shelf-content .shelf-row')).toHaveCount(3);
    expect(await page.locator('#shelf-content').evaluate(element=>element.getAnimations().length)).toBe(0);
    await page.getByRole('tab',{name:'书架',exact:true}).click();
    await pause(page);
    await page.getByRole('tab',{name:'浏览记录'}).click();
    await page.getByRole('tab',{name:'书架',exact:true}).click();
    await page.getByRole('tab',{name:'浏览记录'}).click();
    await resume(page);
    await expect(page.getByRole('tab',{name:'浏览记录'})).toHaveAttribute('aria-selected','true');
    await expect(page.locator('#shelf-content .shelf-row')).toHaveCount(3);
    await expect(page.locator('.shelf-viewport')).not.toHaveAttribute('data-switching', 'true');
  } finally {release();}
});

test('leaving the library removes an interrupted page turn', async ({page}) => {
  await setup(page,390);
  await page.getByRole('tab',{name:'浏览记录'}).click();
  await pause(page);
  await page.getByRole('navigation',{name:'移动端主导航'}).getByRole('link',{name:'精选',exact:true}).click();
  await expect(page).toHaveURL(base+'/');
  await expect(page.locator('.shelf-viewport[data-switching]')).toHaveCount(0);
});

test('reduced motion skips the page turn and resize clears an active turn', async ({page}) => {
  await page.emulateMedia({reducedMotion:'reduce'});
  await setup(page,390);
  await page.getByRole('tab',{name:'浏览记录'}).click();
  await expect(page.locator('#shelf-content .shelf-row')).toHaveCount(3);
  await expect(page.locator('.shelf-viewport')).not.toHaveAttribute('data-switching', 'true');
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.getByRole('tab',{name:'书架',exact:true}).click();
  await pause(page);
  await page.setViewportSize({width:320,height:844});
  await expect(page.locator('.shelf-viewport')).not.toHaveAttribute('data-switching', 'true');
  await expect(page.locator('.shelf-viewport')).not.toHaveAttribute('inert','');
  await expect(page.locator('#shelf-content .shelf-row h2')).toHaveText(['书架作品 1']);
});

test('both pages and the tab indicator track the finger before release, then a short reversal springs back', async ({page, context}, info) => {
  await setup(page, 390);
  await expect(page.locator('#shelf-preview-history .shelf-row')).toHaveCount(3);
  const box = (await page.locator('.shelf-viewport').boundingBox())!;
  const x = box.x + box.width * .85, y = box.y + 70;
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {type:'touchStart', touchPoints:[{x,y,id:1}]});
  for (const dx of [-40, -80, -120, -60, -20]) {
    await cdp.send('Input.dispatchTouchEvent', {type:'touchMove', touchPoints:[{x:x+dx,y,id:1}]});
    // CDP acknowledges input before Chrome has necessarily dispatched its
    // pointer event. Observe the rendered frame before measuring the panes.
    await expect.poll(async () => Math.abs((await page.locator('[data-shelf-tab=shelf]').boundingBox())!.x - box.x - dx)).toBeLessThan(1);
    const frame = await page.locator('.shelf-viewport').evaluate(host => {
      const shelf = host.querySelector('[data-shelf-tab=shelf]')!, history = host.querySelector('[data-shelf-tab=history]')!;
      const tabs = document.querySelector('.shelf-tabs')!;
      return {shelf:shelf.getBoundingClientRect().x, history:history.getBoundingClientRect().x,
        animations:host.getAnimations({subtree:true}).length, indicator:new DOMMatrix(getComputedStyle(tabs,'::after').transform).m41};
    });
    expect(Math.abs(frame.shelf - box.x - dx)).toBeLessThan(1);
    expect(Math.abs(frame.history - frame.shelf - box.width)).toBeLessThan(1);
    expect(frame.animations).toBe(0);
    expect(frame.indicator).toBeGreaterThan(0);
    await expect(page.getByRole('tab',{name:'书架',exact:true})).toHaveAttribute('aria-selected','true');
    await expect(page).toHaveURL(base+'/library?sort=updated&page=2');
    if (dx === -120) await page.screenshot({path:info.outputPath('finger-down.png')});
  }
  await cdp.send('Input.dispatchTouchEvent', {type:'touchEnd', touchPoints:[]});
  await expect(page.locator('.shelf-viewport')).not.toHaveAttribute('data-switching','true');
  expect((await page.locator('#shelf-content').boundingBox())!.x).toBe(box.x);
  await expect(page).toHaveURL(base+'/library?sort=updated&page=2');
  await expect(page.locator('.library-page')).toHaveAttribute('data-managing','false');
  await cdp.detach();
});

test('a cancelled drag restores the selected page and an edge drag never changes tabs', async ({page, context}) => {
  await setup(page, 390);
  const box = (await page.locator('.shelf-viewport').boundingBox())!;
  const x=box.x+box.width*.7, y=box.y+70;
  const cdp=await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-100,y,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
  await expect(page.locator('.shelf-viewport')).not.toHaveAttribute('data-switching','true');
  expect((await page.locator('#shelf-content').boundingBox())!.x).toBe(box.x);
  await cdp.detach();
  await swipe(page,context,-1);
  await expect(page.locator('.shelf-viewport')).not.toHaveAttribute('data-switching','true');
  await expect(page).toHaveURL(base+'/library?sort=updated&page=2');
});
