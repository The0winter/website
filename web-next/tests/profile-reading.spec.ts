import {test,expect} from './fixtures/without-analytics';
import {displayRatingCount} from '../lib/rating';
const base=process.env.PROFILE_READING_BASE || 'http://127.0.0.1:3157';
const book=process.env.PROFILE_READING_BOOK || '000000000000000000000101';

test('rating count halves only its display, including odd and empty counts',()=>{
  expect([0,1,2,3,21,100].map(displayRatingCount)).toEqual([0,1,1,2,11,50]);
});
for(const width of [390,1440]) test(`profile slide, recent books and return at ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});
  await page.addInitScript(()=>{
    const motions:{duration:number;label:string|null}[]=[];Object.assign(window,{profileMotions:motions});
    const animate=Element.prototype.animate;
    Element.prototype.animate=function(frames,options){
      if(this.classList.contains('book-navigation-loading'))motions.push({duration:Number(typeof options==='object'?options?.duration:options),label:this.getAttribute('aria-label')});
      return animate.call(this,frames,options);
    };
  });
  await page.goto(`${base}/book/${book}`);
  await expect(page.locator('.book-recommendations header')).toHaveText('猜你喜欢');
  const response=await page.request.get(`${base}/api/books/${book}`);const row=await response.json();
  const counts=row.ratingSummary?.count ?? ((row.statisticsSeed?.ratingSample?.votes.length ?? row.statisticsSeed?.ratingWeight ?? 0)+(row.numRatings ?? 0));
  await expect(page.getByText(`${displayRatingCount(counts)}人评分`,{exact:true}).filter({visible:true})).toBeVisible();
  await page.locator('#reviews-panel .book-review-profile-link').first().click();
  await expect(page.locator('[data-public-profile-id]')).toBeVisible();
  await expect(page.locator('.book-transition-snapshot')).toHaveCount(0);
  const profileUrl=page.url();const user=profileUrl.split('/').pop();
  const recent=await (await page.request.get(`${base}/api/users/${user}/recent-books`)).json();
  const section=page.getByRole('region',{name:'最近读过',exact:true});await expect(section).toBeVisible();
  await expect(section.locator('h2')).toHaveText('最近读过');await expect(section).not.toContainText('左右滑动');
  await expect(section.locator('.mh-shelf-book')).toHaveCount(Math.min(8,recent.length));
  expect(await page.evaluate(()=> (window as unknown as {profileMotions:{duration:number;label:string}[]}).profileMotions)).toContainEqual({duration:400,label:'正在打开书友主页'});
  if(recent.length){
    expect(await section.locator('.mh-shelf-book').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href')))).toEqual(recent.slice(0,8).map((b:{id:string})=>`/book/${b.id}`));
    const link=section.locator('.mh-shelf-book').first();const href=await link.getAttribute('href');await link.click();await expect(page).toHaveURL(base+href);
    await expect(page.locator('.book-transition-snapshot')).toHaveCount(0);
    if(width<768) await page.getByRole('link',{name:'返回书友主页',exact:true}).click(); else await page.goBack();await expect(page).toHaveURL(profileUrl);await expect(page.locator('.book-transition-snapshot')).toHaveCount(0);
  }else await expect(section.getByText('还没有阅读记录')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await section.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath(`verified-recent-${width}.png`),fullPage:true});
  await page.getByRole('button',{name:'返回',exact:true}).click();await expect(page).toHaveURL(`${base}/book/${book}`);await expect(page.locator('.book-transition-snapshot')).toHaveCount(0);
});

test('recent books can retry and reduced motion leaves no blocking overlay',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});let fail=true;
  await page.route('**/api/users/*/recent-books',route=>fail?route.fulfill({status:503,json:{}}):route.fulfill({json:[]}));
  await page.goto(`${base}/book/${book}`);await page.locator('#reviews-panel .book-review-profile-link').first().click();
  const section=page.getByRole('region',{name:'最近读过',exact:true});await expect(section.getByRole('alert')).toBeVisible();
  fail=false;await section.getByRole('button',{name:'重试'}).click();await expect(section.getByText('还没有阅读记录')).toBeVisible();
  await expect(page.locator('.book-transition-snapshot')).toHaveCount(0);
});

test('comment sheet profile retains its origin through Back, Forward and reload',async({page})=>{
  await page.setViewportSize({width:390,height:900});await page.goto(`${base}/book/${book}`);
  await page.getByRole('button',{name:'查看全部评论',exact:true}).click();
  await page.getByRole('dialog',{name:'全部评论',exact:true}).locator('.book-review-profile-link').first().click();
  await expect(page.locator('[data-public-profile-id]')).toBeVisible();await expect(page.locator('.book-transition-snapshot')).toHaveCount(0);
  const profileUrl=page.url();await page.goBack();await expect(page).toHaveURL(`${base}/book/${book}`);await expect(page.locator('.book-transition-snapshot')).toHaveCount(0);
  await page.goForward();await expect(page).toHaveURL(profileUrl);await expect(page.locator('.book-transition-snapshot')).toHaveCount(0);
  await page.reload();await expect(page.getByRole('region',{name:'最近读过',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'返回',exact:true}).click();await expect(page).toHaveURL(`${base}/book/${book}`);await expect(page.locator('.book-transition-snapshot')).toHaveCount(0);
});
