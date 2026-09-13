import {test, expect} from '@playwright/test';

const base = process.env.REVIEW_BASE || 'http://127.0.0.1:3000';
const book = process.env.REVIEW_BOOK || '000000000000000000000101';
const reader = {id:'000000000000000000000011', username:'山间读者', role:'reader'};

for (const width of [320,390,768,1440]) test(`review footer, compact stars and persistent feedback at ${width}px`, async ({page}, info) => {
  await page.setViewportSize({width, height:900});
  const reviews = [
    {_id:'000000000000000000000201', rating:5, content:'文笔细腻，人物鲜活。\n读到这里，仍然想继续翻下一章。', user:{_id:'other1', username:'山间读者'}, createdAt:'2026-09-13T12:00:00Z'},
    {_id:'000000000000000000000202', rating:2, content:'故事还有进步空间，期待后续更精彩。'.repeat(8), user:{_id:'other2', username:'一个很长的书友名字用来检查换行和星级对齐'}, createdAt:'2026-09-12T12:00:00Z'},
  ];
  let reaction:string|null = null, failWrite = false, failRead = false;
  const writes:unknown[] = [], errors:string[] = [];
  const data = () => reviews.map((review,index) => ({id:review._id, likes:(index ? 12589 : 18)+(index === 0 && reaction === 'like' ? 1 : 0), dislikes:index === 0 && reaction === 'dislike' ? 1 : 0, reaction:index ? null : reaction}));
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === '/api/auth/session') return route.fulfill({json:{user:reader, profile:reader}});
    if (path === '/api/auth/csrf') return route.fulfill({json:{csrfToken:'fixture'}});
    if (path.endsWith('/check')) return route.fulfill({json:{isBookmarked:false}});
    if (path.endsWith('/reviews/mine')) return route.fulfill({json:null});
    if (path.endsWith('/reviews')) return route.fulfill({json:reviews, headers:{'X-Total-Count':'2','X-Review-Distribution':'{"5":1,"2":1}'}});
    if (path.endsWith('/review-reactions')) return failRead ? route.fulfill({status:503,json:{error:'unavailable'}}) : route.fulfill({json:data()});
    if (path.endsWith('/reaction')) {
      writes.push(request.postDataJSON());
      if (failWrite) return route.fulfill({status:503, json:{error:'反馈保存失败，请重试'}});
      reaction = request.postDataJSON().reaction;
      return route.fulfill({json:data()[0]});
    }
    if (!['GET','HEAD'].includes(request.method())) return route.fulfill({json:{ok:true}});
    return route.continue();
  });
  await page.goto(`${base}/book/${book}`);
  const rows = page.locator('.book-review'), first = rows.first();
  const like = first.getByRole('button', {name:/^喜欢，/}), dislike = first.getByRole('button', {name:/^不喜欢，/});
  await expect(like).toBeEnabled();
  await expect(rows).toHaveCount(2);
  const layout = await rows.evaluateAll(elements => elements.map(row => {
    const rect = (selector:string) => row.querySelector(selector)!.getBoundingClientRect();
    const name = rect('.book-review-name'), stars = rect('.book-review-stars'), content = rect('.book-review-content'), time = rect('time'), actions = rect('.book-review-reactions');
    return {starsRight:Math.abs(stars.right-content.right)<1 && stars.left>name.right && Math.abs(stars.top+stars.height/2-name.top-name.height/2)<1, bodyBelow:content.top >= name.bottom, timeBelow:time.top >= content.bottom,
      aligned:Math.abs(name.left-content.left)<1 && Math.abs(name.left-time.left)<1,
      fontSize:parseFloat(getComputedStyle(row.querySelector('.book-review-content')!).fontSize),dateSize:parseFloat(getComputedStyle(row.querySelector('time')!).fontSize),
      starsWidth:stars.width, starSize:rect('.book-review-stars svg').width, bottomAligned:Math.abs(time.top+time.height/2-actions.top-actions.height/2)<1,
      rightAligned:Math.abs(actions.right-content.right)<1, separated:time.right+7<=actions.left};
  }));
  for (const row of layout) {
    expect(row).toMatchObject({starsRight:true, bodyBelow:true, timeBelow:true, aligned:true, bottomAligned:true, rightAligned:true, separated:true,fontSize:17,dateSize:15});
    expect(row.starSize).toBe(10); expect(row.starsWidth).toBeLessThanOrEqual(55);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(first.locator('.book-review-avatar')).toHaveText('山');
  await expect(rows.nth(1).locator('.book-review-avatar')).toHaveText('一');
  if (width >= 768) {
    const accountAvatar = page.locator('[data-site-chrome] .user-avatar').first();
    await expect(accountAvatar).toHaveText('山');
    expect(await first.locator('.book-review-avatar').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(await accountAvatar.evaluate(el=>getComputedStyle(el).backgroundColor));
  }
  await page.locator('#reviews-section:visible').screenshot({path:info.outputPath('comments.png')});
  await like.click(); await expect(like).toHaveAttribute('aria-pressed','true'); await expect(like).toHaveAccessibleName('喜欢，19 人');
  await page.reload(); await expect(like).toHaveAttribute('aria-pressed','true');
  await dislike.click(); await expect(dislike).toHaveAttribute('aria-pressed','true'); await expect(like).toHaveAccessibleName('喜欢，18 人');
  await dislike.focus(); await page.keyboard.press('Space'); await expect(dislike).toHaveAttribute('aria-pressed','false');
  failWrite = true;
  await like.click(); await expect(page.locator('.book-review-error[role=alert]')).toContainText('反馈保存失败'); await expect(like).toHaveAttribute('aria-pressed','false');
  failWrite = false;
  await like.click(); await expect(like).toHaveAttribute('aria-pressed','true'); await expect(page.locator('.book-review-error[role=alert]')).toHaveCount(0);
  expect(writes).toEqual([{reaction:'like'}, {reaction:'dislike'}, {reaction:null}, {reaction:'like'}, {reaction:'like'}]);
  failRead = true;
  await page.reload(); await expect(page.locator('.book-review-error[role=alert]')).toContainText('评论反馈加载失败'); await expect(like).toBeDisabled();
  await expect(first.locator('.book-review-content')).toBeVisible();
  failRead = false;
  await page.getByRole('button', {name:'重试',exact:true}).click(); await expect(like).toBeEnabled(); await expect(like).toHaveAttribute('aria-pressed','true');
  expect(errors).toEqual([]);
});

test('guest feedback opens sign-in without writing a reaction', async ({page}) => {
  let writes = 0;
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/session') return route.fulfill({json:{user:null}});
    if (path.endsWith('/reviews')) return route.fulfill({json:[{_id:'000000000000000000000201',rating:4,content:'测试评论',user:{_id:'other',username:'书友'},createdAt:'2026-09-13T12:00:00Z'}],headers:{'X-Total-Count':'1','X-Review-Distribution':'{"4":1}'}});
    if (path.endsWith('/review-reactions')) return route.fulfill({json:[{id:'000000000000000000000201',likes:0,dislikes:0,reaction:null}]});
    if (path.endsWith('/reaction')) writes++;
    if (!['GET','HEAD'].includes(route.request().method())) return route.fulfill({json:{ok:true}});
    return route.continue();
  });
  await page.goto(`${base}/book/${book}`);
  await page.getByRole('button', {name:'喜欢，0 人',exact:true}).click();
  await expect(page).toHaveURL(/\/login$/); expect(writes).toBe(0);
});
