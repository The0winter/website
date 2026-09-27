import {test,expect} from './fixtures/without-analytics';
const base=process.env.PROFILE_CLEANUP_BASE || 'http://127.0.0.1:3157';
const book=process.env.PROFILE_CLEANUP_BOOK || '000000000000000000000101';
for(const width of [390,1440]) {
 test(`profile cleanup and return at ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});
  await page.route('**/api/**',route=>route.request().method()==='GET'?route.continue():route.abort());
  await page.goto(`${base}/book/${book}`);
  const link=page.locator('#reviews-panel .book-review-profile-link').first();await expect(link).toBeVisible();
  const href=await link.getAttribute('href');await link.click();await expect(page).toHaveURL(base+href);
  await expect(page.locator('.public-profile-identity h1')).toBeVisible();
  await expect(page.locator('nav[data-site-chrome]')).toHaveCount(0);
  await expect(page.locator('.public-profile-page')).not.toContainText(/测试|调试|评论来源|邮箱/);
  await expect(page.locator('.public-profile-page a[target="_blank"]')).toHaveCount(0);
  await expect(page.getByText('加入时间',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath(`verified-profile-${width}.png`),fullPage:true});
  await page.getByRole('button',{name:'返回',exact:true}).click();await expect(page).toHaveURL(`${base}/book/${book}`);
  await page.goto(base+href);await expect(page.locator('nav[data-site-chrome]')).toHaveCount(0);
  await page.getByRole('link',{name:'返回书库',exact:true}).click();await expect(page).toHaveURL(base+'/');
 });
 test(`navigation entries retained at ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});await page.goto(base+'/');
  const nav=page.getByRole('navigation',{name:'桌面导航'});
  if(width===1440){await expect(nav).toBeVisible();await expect(nav.getByRole('link',{name:'书架',exact:true})).toBeVisible();await expect(nav.getByRole('link',{name:'登录',exact:true})).toBeVisible();await expect(nav.locator('input')).toBeVisible();await nav.getByRole('button',{name:/切换到夜间模式/}).click();await expect(page.locator('html')).toHaveClass(/dark/);}
  else {await expect(nav).toBeHidden();await expect(page.locator('.mobile-home')).toBeVisible();}
  await page.goto(base+'/search');await expect(page.locator('nav[data-site-chrome]')).toHaveCount(0);
 });
 test(`missing profile has no inherited navigation at ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});await page.goto(base+'/user/000000000000000000999999');
  await expect(page.getByRole('heading',{name:'书友主页暂不可用'})).toBeVisible();await expect(page.locator('nav[data-site-chrome]')).toHaveCount(0);
 });
}
