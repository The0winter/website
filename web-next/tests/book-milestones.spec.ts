import {test, expect} from '@playwright/test';

const base = 'http://127.0.0.1:3000', book = '000000000000000000000101';
const sample = {
  counts:{favorites:5100,views:210000}, next:{favorites:10000,views:500000},
  events:[
    {kind:'views',threshold:200000,achievedAt:'2026-09-20T02:00:00Z'},
    {kind:'favorites',threshold:5000,achievedAt:'2026-09-19T17:00:00Z'},
    {kind:'favorites',threshold:3000,achievedAt:'2026-09-18T03:00:00Z'},
    {kind:'views',threshold:100000,achievedAt:'2026-09-16T03:00:00Z'},
    {kind:'favorites',threshold:1000,achievedAt:'2026-09-15T03:00:00Z'},
    {kind:'favorites',threshold:500,achievedAt:null},
    {kind:'favorites',threshold:300,achievedAt:null},
  ],
};
test.beforeEach(async ({page}) => {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
});
for (const width of [320,390,430,767,768,1440]) {
  test(`milestone entry, timeline and browser history at ${width}px`, async ({page}, info) => {
    await page.setViewportSize({width,height:844});
    await page.route(`**/api/books/${book}/milestones`,route=>route.fulfill({json:sample}));
    const errors:string[]=[]; page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`${base}/book/${book}`);
    await expect(page.locator('html')).not.toHaveAttribute('data-book-transition',/.+/);
    const entry=page.getByRole('button',{name:'查看作品里程碑'});
    await expect(entry).toBeVisible();
    await expect(entry.locator('[data-active=true]')).toContainText('五千收藏');
    if(width<768){
      await expect(page.locator('.book-mobile-stats dd').first()).toHaveCSS('font-size','16px');
      await expect(page.locator('.book-mobile-stats dt').first()).toHaveCSS('font-size','12px');
      await expect(page.locator('.book-mobile-stats')).toHaveCSS('border-left-width','1px');
      for (const item of await page.locator('.book-mobile-stats>div').all()) await expect(item).toHaveCSS('border-left-width','0px');
      const boxes=await page.locator('.book-mobile-stats dd').evaluateAll(items=>items.map(el=>({width:el.clientWidth,scroll:el.scrollWidth})));
      expect(boxes.every(box=>box.scroll<=box.width+1),JSON.stringify(boxes)).toBe(true);
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:info.outputPath(`final-detail-${width}.png`)});
    await expect(entry.locator('[data-active=true]')).toContainText('二十万浏览',{timeout:6500});
    await entry.click();
    const sheet=page.getByRole('dialog',{name:'作品里程碑'});
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('.milestone-event')).toHaveCount(7);
    await expect(sheet.locator('.milestone-date').first()).toHaveText('2026年09月20日');
    await expect(sheet.locator('.milestone-day').first().locator('.milestone-event')).toHaveCount(2);
    await expect(sheet.getByText('历史达成',{exact:true})).toBeVisible();
    await expect(sheet.getByText('徽章墙')).toHaveCount(0);
    await page.screenshot({path:info.outputPath(`final-timeline-${width}.png`)});
    await sheet.getByRole('button',{name:'说明',exact:true}).click();
    await expect(sheet.getByText(/已达成的里程碑永久保留/)).toBeVisible();
    await page.goBack(); await expect(sheet).not.toBeVisible(); await expect(page).toHaveURL(`${base}/book/${book}`);
    await page.goForward(); await expect(sheet).toBeVisible();
    await sheet.getByRole('button',{name:'返回书籍详情'}).click(); await expect(sheet).not.toBeVisible();
    await entry.click(); await expect(sheet).toBeVisible(); await page.keyboard.press('Escape'); await expect(sheet).not.toBeVisible();
    expect(errors).toEqual([]);
  });
}
test('empty milestones, recoverable errors, reduced motion and catalog remain usable',async({page})=>{
  await page.setViewportSize({width:390,height:844}); await page.emulateMedia({reducedMotion:'reduce'});
  let fail=true;
  await page.route(`**/api/books/${book}/milestones`,route=>fail?route.fulfill({status:503,json:{error:'unavailable'}}):route.fulfill({json:{counts:{favorites:0,views:0},events:[],next:{favorites:300,views:10000}}}));
  await page.goto(`${base}/book/${book}`);
  const entry=page.getByRole('button',{name:'查看作品里程碑'}); await entry.click();
  const sheet=page.getByRole('dialog',{name:'作品里程碑'});
  await expect(sheet.getByRole('alert')).toBeVisible();
  fail=false; await sheet.getByRole('button',{name:'重试',exact:true}).click();
  await expect(sheet.getByText('每一份喜欢，都是新的起点')).toBeVisible();
  await expect(sheet.locator('.milestone-event')).toHaveCount(0);
  await sheet.getByRole('button',{name:'返回书籍详情'}).click();
  await expect(entry.locator('[data-active=true]')).toContainText('收藏里程碑');
  await page.locator('.mobile-catalog').click();
  await expect(page.getByRole('dialog',{name:'全部目录'})).toBeVisible();
  await page.getByRole('button',{name:'关闭目录'}).click();
  await expect(page.getByRole('dialog',{name:'全部目录'})).not.toBeVisible();
});

test('both rotations move the outgoing and incoming milestone upward',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto(`${base}/book/${book}`);
  const entry=page.getByRole('button',{name:'查看作品里程碑'});
  await expect(entry).toBeVisible();
  const result=await entry.evaluate(async element=>{
    const roll=element.querySelector('.milestone-roll')!;
    const items=[...roll.querySelectorAll<HTMLElement>('.milestone-roll-item')];
    const previous=new Map<HTMLElement,number>();
    let rises=0,falls=0,changes=0,active=items.findIndex(item=>item.dataset.active==='true');
    const start=performance.now();
    while(performance.now()-start<8000){
      const next=items.findIndex(item=>item.dataset.active==='true');
      if(next!==active){changes++;active=next;}
      const box=roll.getBoundingClientRect();
      for(const item of items){
        const r=item.getBoundingClientRect();
        const visible=getComputedStyle(item).visibility==='visible'&&r.bottom>box.top+1&&r.top<box.bottom-1;
        const last=previous.get(item);
        if(visible&&last!==undefined){const delta=r.top-last;if(delta<-.1)rises++;if(delta>.1)falls++;}
        if(visible)previous.set(item,r.top);else previous.delete(item);
      }
      await new Promise(resolve=>requestAnimationFrame(resolve));
    }
    return {rises,falls,changes};
  });
  expect(result.changes).toBeGreaterThanOrEqual(2);expect(result.rises).toBeGreaterThan(10);expect(result.falls).toBe(0);
});
