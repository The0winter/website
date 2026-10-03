import {test,expect,blockAnalytics} from './fixtures/without-analytics';
import type {BrowserContext} from '@playwright/test';
const base=process.env.QA_TEST_BASE||'http://127.0.0.1:3208';
test.skip(!base.includes('127.0.0.1'),'Mutation tests require an isolated synthetic server');
const cards='.forum-feed-panel[aria-hidden="false"] .forum-entry';

for(const width of [320,390,1440])test(`balanced recommendations, preference controls and stable return at ${width}px`,async({page},info)=>{
  await page.setViewportSize({width,height:900});
  await page.route('**/api/forum/recommendations/events',route=>route.fulfill({json:{recorded:0}}));
  await page.route('**/api/forum/posts/*/views',route=>route.fulfill({json:{counted:false}}));
  await page.goto(base+'/forum');
  await expect(page.locator(cards).first()).toBeVisible({timeout:30000});
  if(width<768)await expect(page.locator(cards)).toHaveCount(10,{timeout:20000});
  else await expect(page.locator(cards)).toHaveCount(20);
  const titles=await page.locator(cards+' h2').allTextContents();
  expect(new Set(titles).size).toBe(titles.length);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await expect(page.locator(cards+' .forum-recommendation-reason').first()).toBeVisible();
  const firstId=await page.locator(cards).first().getAttribute('data-entry-id');
  await page.locator(cards+' .forum-entry-title').first().click();
  await expect(page.locator('main .qa-body').first()).toBeVisible();
  await page.goBack();
  await expect(page.locator(cards).first()).toHaveAttribute('data-entry-id',firstId!);
  expect(await page.locator(cards+' h2').allTextContents()).toEqual(titles);
  await page.locator(cards+' .forum-feedback-toggle').first().click();
  const sheet=page.getByRole('dialog',{name:'调整推荐'});
  await sheet.getByRole('button',{name:'少看这本书',exact:true}).click();
  await expect(page.locator(`${cards}[data-entry-id="${firstId}"]`)).toHaveCount(0);
  await page.getByRole('button',{name:/推荐偏好/}).click();
  const preferences=page.getByRole('dialog',{name:'推荐偏好'});
  await expect(preferences.getByText('少看这本书',{exact:true})).toBeVisible();
  await preferences.getByRole('button',{name:'均衡探索',exact:true}).click();
  await expect(preferences.getByRole('button',{name:'更多探索',exact:true})).toBeVisible();
  await preferences.getByRole('button',{name:'已开启',exact:true}).click();
  await expect(preferences.getByRole('button',{name:'已关闭',exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath(`verified-preferences-${width}.png`)});
  await page.keyboard.press('Escape');
  await expect(preferences).toHaveCount(0);
  await page.getByRole('button',{name:'换一批',exact:true}).click();
  await expect(page.locator(cards).first()).toBeVisible();
  await expect(page.locator(`${cards}[data-entry-id="${firstId}"]`)).toHaveCount(0);
  await page.screenshot({path:info.outputPath(`verified-feed-${width}.png`)});
});

test('real follow preferences synchronize across devices without leaking to guests',async({browser})=>{
  const contexts:BrowserContext[]=[];
  try {
    for(let i=0;i<3;i++){
      const context=await browser.newContext({viewport:{width:390,height:844}});contexts.push(context);await blockAnalytics(context);
      await context.route('**/api/forum/recommendations/events',route=>route.fulfill({json:{recorded:0}}));
      if(i<2){const csrf=await(await context.request.get(base+'/api/auth/csrf')).json();
        const response=await context.request.post(base+'/api/auth/signin',{headers:{origin:base,'x-csrf-token':csrf.csrfToken},data:{email:'recommendation@example.test',password:'Local-test-12345'}});
        expect(response.ok()).toBeTruthy();}
    }
    const first=await contexts[0].newPage();await first.goto(base+'/forum');
    await expect(first.locator(cards).first()).toBeVisible();
    await first.locator(cards+' .forum-feedback-toggle').first().click();
    await first.getByRole('dialog',{name:'调整推荐'}).getByRole('button',{name:'关注这本书',exact:true}).click();
    await expect(first.getByRole('status').filter({hasText:'已关注'})).toBeVisible();
    await first.getByRole('button',{name:'关注',exact:true}).click();
    await expect(first.locator(cards)).toHaveCount(1);
    const title=await first.locator(cards+' h2').textContent();
    const second=await contexts[1].newPage();await second.goto(base+'/forum');
    await second.getByRole('button',{name:'关注',exact:true}).click();
    await expect(second.locator(cards+' h2')).toHaveText(title!);
    const guest=await contexts[2].newPage();await guest.goto(base+'/forum');
    await guest.getByRole('button',{name:'关注',exact:true}).click();
    await expect(guest.getByText('还没有关注内容。',{exact:false})).toBeVisible();
    await expect(guest.locator(cards)).toHaveCount(0);
  } finally {for(const context of contexts)await context.close();}
});

test('only visible cards and the actively read answer emit telemetry',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const impressions:string[]=[],reads:string[]=[];
  await page.route('**/api/forum/recommendations/events',async route=>{
    const {events}=route.request().postDataJSON();
    for(const event of events){const ticket=JSON.parse(Buffer.from(event.token.split('.')[0],'base64url').toString());
      (event.type==='read'?reads:impressions).push(ticket.entry);}
    await route.fulfill({json:{recorded:events.length}});
  });
  // Exercise client dwell/visibility independently of the server's longer signed
  // read threshold, which is verified in the database integration tests.
  await page.route('**/api/forum/recommendations/receipt?*',async route=>{
    const entry=new URL(route.request().url()).searchParams.get('entry');
    await route.fulfill({json:{minReadMs:1200,token:Buffer.from(JSON.stringify({entry})).toString('base64url')+'.test'}});
  });
  await page.goto(base+'/forum');await expect(page.locator(cards)).toHaveCount(10,{timeout:25000});
  await expect.poll(()=>impressions.length).toBeGreaterThan(0);
  expect(impressions.length).toBeLessThan(10);
  const lastId=await page.locator(cards).last().getAttribute('data-entry-id');expect(impressions).not.toContain(lastId);
  const firstId=await page.locator(cards).first().getAttribute('data-entry-id');
  await page.locator(cards+' .forum-entry-title').first().click();
  await expect(page.locator('.qa-answer').first()).toBeVisible();
  await expect.poll(()=>reads,{timeout:12000}).toContain(firstId);
  expect(new Set(reads)).toEqual(new Set([firstId]));
});

test('preference loading waits for authentication and logout restores guest settings',async({page,context})=>{
  await page.setViewportSize({width:1440,height:900});
  const csrf=await(await context.request.get(base+'/api/auth/csrf')).json();
  const headers={origin:base,'x-csrf-token':csrf.csrfToken};
  expect((await context.request.post(base+'/api/auth/signin',{headers,data:{email:'recommendation@example.test',password:'Local-test-12345'}})).ok()).toBeTruthy();
  headers['x-csrf-token']=(await(await context.request.get(base+'/api/auth/csrf')).json()).csrfToken;
  expect((await context.request.patch(base+'/api/forum/preferences',{headers,data:{enabled:false}})).ok()).toBeTruthy();
  let releaseAuth:()=>void=()=>{};
  const pendingAuth=new Promise<void>(resolve=>{releaseAuth=resolve;});
  await context.route('**/api/auth/session',async route=>{await pendingAuth;await route.continue();});
  await context.route('**/api/forum/recommendations/events',route=>route.fulfill({json:{recorded:0}}));
  let preferenceRequests=0;
  page.on('request',request=>{if(request.url().endsWith('/api/forum/preferences'))preferenceRequests++;});
  try {
    await page.goto(base+'/forum');
    await expect(page.getByRole('navigation',{name:'论坛内容分类'})).toBeVisible();
    await page.waitForTimeout(400); // Keep auth unresolved across mounted effects.
    expect(preferenceRequests).toBe(0);
  } finally {releaseAuth();}
  await expect(page.locator(cards).first()).toBeVisible();
  await page.getByRole('button',{name:/推荐偏好/}).click();
  await expect(page.getByRole('dialog',{name:'推荐偏好'}).getByRole('button',{name:'已关闭',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('link',{name:'九天小说首页',exact:true}).click();
  await page.getByRole('button',{name:'退出登录',exact:true}).click();
  await expect(page.getByRole('button',{name:'退出登录',exact:true})).toHaveCount(0);
  await page.getByRole('link',{name:'论坛',exact:true}).first().click();
  await expect(page.locator(cards).first()).toBeVisible();
  await page.getByRole('button',{name:/推荐偏好/}).click();
  await expect(page.getByRole('dialog',{name:'推荐偏好'}).getByRole('button',{name:'已开启',exact:true})).toBeVisible();
});
