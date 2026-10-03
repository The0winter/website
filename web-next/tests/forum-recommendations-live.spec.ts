import {test,expect} from './fixtures/without-analytics';
const base=process.env.QA_TEST_BASE||'http://127.0.0.1:3208';
const cards='.forum-feed-panel[aria-hidden="false"] .forum-entry';

for(const width of [390,1440])test(`recommendation release read-only acceptance at ${width}px`,async({page,context},info)=>{
  await page.setViewportSize({width,height:900});
  // These routes are installed before navigation: synthetic acceptance never
  // contributes to recommendation heat, reading counters or Google Analytics.
  await context.route('**/api/forum/recommendations/events',route=>route.fulfill({json:{recorded:0}}));
  await context.route('**/api/forum/posts/*/views',route=>route.fulfill({json:{counted:false}}));
  const pageErrors:string[]=[];page.on('pageerror',error=>pageErrors.push(error.message));
  const response=page.waitForResponse(res=>res.url().includes('/api/forum/posts?')&&res.url().includes('format=page')&&res.url().includes('tab=recommend'));
  await page.goto(base+'/forum');
  const payload=await(await response).json();expect(payload.algorithm).toBe('balanced-v1');
  await expect(page.locator(cards).first()).toBeVisible({timeout:30000});
  await expect(page.locator(cards)).toHaveCount(width<768?10:20,{timeout:20000});
  const titles=await page.locator(cards+' h2').allTextContents();
  expect(new Set(titles).size).toBe(titles.length);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await expect(page.locator(cards+' .forum-recommendation-reason').first()).toBeVisible();
  await expect(page.getByRole('button',{name:/推荐偏好|换一批/})).toHaveCount(0);
  const toolbar=await page.locator('.forum-feed-toolbar').boundingBox(),card=await page.locator(cards).first().boundingBox();
  expect(Math.abs(card!.y-toolbar!.y-toolbar!.height-(width<768?0:24))).toBeLessThan(2);
  await page.screenshot({path:info.outputPath(`verified-public-feed-${width}.png`)});
  const first=await page.locator(cards).first().getAttribute('data-entry-id');
  await page.locator(cards+' .forum-entry-title').first().click();
  await expect(page.locator('main .forum-prose').first()).toBeVisible();
  expect((await page.locator('main .forum-prose').first().innerText()).length).toBeGreaterThan(20);
  await page.goBack();
  await expect(page.locator(cards).first()).toHaveAttribute('data-entry-id',first!);
  expect(await page.locator(cards+' h2').allTextContents()).toEqual(titles);
  await page.getByRole('navigation',{name:'论坛内容分类'}).getByRole('button',{name:'热榜',exact:true}).click();
  await expect(page.locator('.forum-feed-panel[aria-hidden="false"] article').first()).toBeVisible();
  await page.getByRole('navigation',{name:'论坛内容分类'}).getByRole('button',{name:'关注',exact:true}).click();
  await expect(page.getByText('还没有关注内容。在推荐卡片中关注作者或书籍后，这里会显示相关内容。')).toBeVisible();
  expect(pageErrors).toEqual([]);
});
