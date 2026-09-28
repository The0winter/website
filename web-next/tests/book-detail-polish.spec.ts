import {test,expect} from './fixtures/without-analytics';

const base=process.env.DETAIL_BASE||'http://127.0.0.1:3000';
const book=process.env.DETAIL_BOOK||'000000000000000000000101';
const query=process.env.DETAIL_QUERY||'山海';
const detail=`${base}/book/${book}`;
test.beforeEach(async({page})=>{
  await page.addInitScript(()=>{
    Object.defineProperty(navigator,'connection',{value:{saveData:true,addEventListener(){},removeEventListener(){}}});
    localStorage.setItem('has-seen-reading-hint','true');
  });
  await page.route('**/api/books/*/views',route=>route.fulfill({json:{success:true,counted:false}}));
  await page.route('**/api/books/*/reviews?*',route=>route.fulfill({json:[{_id:'000000000000000000000201',rating:4,content:'评论返回测试',user:{_id:'other',username:'读者'},createdAt:'2026-09-20T12:00:00Z'}],headers:{'X-Total-Count':'1','X-Next-Cursor':''}}));
});

for(const width of [390,1440]) test(`review Back closes only the sheet and Forward reopens it at ${width}`,async({page})=>{
  await page.setViewportSize({width,height:844});await page.goto(detail);
  await expect.poll(()=>page.evaluate(()=>history.state?.bookNavigation?.kind)).toBe('detail');
  await page.getByRole('button',{name:'查看全部评论'}).click();
  await expect(page.getByRole('dialog',{name:'全部评论',exact:true})).toBeVisible();
  const length=await page.evaluate(()=>history.length);
  await page.goBack();await expect(page.getByRole('dialog',{name:'全部评论',exact:true})).toHaveCount(0);await expect(page).toHaveURL(detail);
  await page.goForward();await expect(page.getByRole('dialog',{name:'全部评论',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'关闭全部评论'}).click();
  await expect(page.getByRole('dialog',{name:'全部评论',exact:true})).toHaveCount(0);await expect(page).toHaveURL(detail);
  await page.getByRole('button',{name:'查看全部评论'}).click();await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog',{name:'全部评论',exact:true})).toHaveCount(0);await expect(page).toHaveURL(detail);
  expect(await page.evaluate(()=>history.length)).toBe(length);
  await page.goBack();await expect(page).toHaveURL(base+'/');
});

test('share reminder is white, compact and still opens sharing',async({page},info)=>{
  await page.setViewportSize({width:390,height:844});
  await page.addInitScript(id=>{sessionStorage.setItem('book-share-visits:v2',JSON.stringify({[id]:Date.now()}));localStorage.removeItem('book-share-shown:v1');},book);
  await page.goto(detail);const reminder=page.locator('.book-share-reminder');
  await expect(reminder).toBeVisible();await expect(reminder).toHaveCSS('background-color','rgb(255, 255, 255)');
  expect((await reminder.boundingBox())!.height).toBeLessThanOrEqual(40);
  await page.screenshot({path:info.outputPath('final-share-reminder.png')});
  await page.getByRole('button',{name:/喜欢的话，请多多分享/}).click();
  await expect(page.getByRole('dialog',{name:'分享这本书'})).toBeVisible();
  await page.goBack();await expect(page).toHaveURL(detail);await expect(page.getByRole('dialog',{name:'分享这本书'})).toBeHidden();
});

for(const width of [390,1440]) test(`detail entry uses the shared skeleton and small central brand at ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:844});await page.goto(base+'/search?q='+encodeURIComponent(query));
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route(`**/book/${book}?_rsc=*`,async route=>{await gate;await route.continue();});
  try{
    await page.locator(`a[href="/book/${book}"]:visible`).first().click();
    const shell=page.locator('.book-navigation-loading .book-loading');await expect(shell).toBeVisible();
    await expect(shell.locator('.book-loading-cover')).toBeVisible();
    const brand=shell.locator('.book-loading-brand');await expect(brand.locator('img')).toHaveCSS('width','28px');
    await expect(brand).toHaveCSS('font-size','14px');
    await expect.poll(async()=>Math.abs((await brand.boundingBox())!.x+(await brand.boundingBox())!.width/2-width/2)).toBeLessThan(1);
    const box=(await brand.boundingBox())!;expect(Math.abs(box.y+box.height/2-422)).toBeLessThan(1);
    await page.screenshot({path:info.outputPath(`final-loading-${width}.png`)});
    release();await expect(page.locator('.book-detail:visible')).toHaveAttribute('data-book-id',book);
    await expect(page.locator('.book-navigation-loading')).toHaveCount(0);
  }finally{release();}
});
