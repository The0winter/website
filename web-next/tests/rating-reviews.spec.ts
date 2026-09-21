import {test, expect} from '@playwright/test';

const base = process.env.REVIEW_BASE || 'http://127.0.0.1:3000';
const book = process.env.REVIEW_BOOK || '000000000000000000000101';
const reader = {id:'000000000000000000000011', username:'山间读者', role:'reader'};

for (const width of [320, 390, 1440]) test(`ten-point ratings preserve saved stars and review edits at ${width}px`, async ({page}, info) => {
  await page.setViewportSize({width, height:900});
  const reviews = [
    {_id:'low', rating:1, content:'故事还有进步空间。\n期待人物的成长写得更细致一些。', user:{_id:'other-low', username:'山野来信'}, createdAt:'2026-09-12T12:00:00Z'},
    {_id:'high', rating:5, content:'文笔细腻，读来余韵悠长。', user:{_id:'other-high', username:'一个很长的书友名字用来检查换行', avatar:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="40" height="40"%3E%3Crect width="40" height="40" fill="%239fb5a8"/%3E%3C/svg%3E'}, createdAt:'2026-09-13T12:00:00Z'},
  ];
  const writes: number[] = [];
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === '/api/auth/session') return route.fulfill({json:{user:reader, profile:reader}});
    if (url.pathname === '/api/auth/csrf') return route.fulfill({json:{csrfToken:'browser-fixture'}});
    if (url.pathname.endsWith('/review-reactions')) return route.fulfill({json:reviews.map(review => ({id:review._id, likes:0, dislikes:0, reaction:null}))});
    if (url.pathname.endsWith('/check')) return route.fulfill({json:{isBookmarked:false}});
    if (url.pathname === `/api/books/${book}/reviews/mine`) return route.fulfill({json:reviews.find(review=>review.user._id===reader.id) || null});
    if (url.pathname === `/api/books/${book}/reviews`) {
      if (request.method() === 'POST') {
        const input = request.postDataJSON();
        writes.push(input.rating);
        const saved = {_id:'mine', ...input, user:{_id:reader.id, username:reader.username}, createdAt:'2026-09-13T13:00:00Z'};
        const index = reviews.findIndex(review=>review._id==='mine');
        if (index < 0) reviews.push(saved); else reviews[index]=saved;
        return route.fulfill({status:201, json:saved});
      }
      const distribution: Record<number,number> = {};
      for (const review of reviews) distribution[review.rating]=(distribution[review.rating] || 0)+1;
      return route.fulfill({json:reviews, headers:{'X-Total-Count':String(reviews.length), 'X-Review-Distribution':JSON.stringify(distribution)}});
    }
    if (!['GET','HEAD'].includes(request.method())) return route.fulfill({json:{ok:true}});
    return route.continue();
  });
  page.on('dialog', dialog=>dialog.accept());
  await page.goto(`${base}/book/${book}`);
  const score = page.locator(width < 768 ? '.book-mobile-rating strong:visible' : '.book-rating-score:visible');
  await expect(score).toHaveText('6.0');
  await expect(page.locator('.book-review-meta [role="img"]').first()).toHaveAttribute('aria-label','2.0 分');
  await expect(page.locator('.book-review-meta [role="img"]').nth(1)).toHaveAttribute('aria-label','10.0 分');
  await expect(page.locator('.book-review-meta > span')).toHaveCount(0);
  const uploadedAvatar = page.locator('.book-review-avatar img').first();
  await expect(uploadedAvatar).toHaveAttribute('src', reviews[1].user.avatar!);
  await expect.poll(() => uploadedAvatar.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.getByRole('button', {name:'写书评', exact:true}).click();
  await expect(page.getByRole('button', {name:'发表评论', exact:true})).toBeDisabled();
  await expect(page.getByRole('group', {name:'选择评分，最低 2 分，最高 10 分'}).getByRole('button', {pressed:true})).toHaveCount(0);
  for (let star=1; star<=5; star++) {
    await page.getByRole('button', {name:`${star*2} 分（${star} 星）`, exact:true}).click();
    await expect(page.getByRole('button', {name:`${star*2} 分（${star} 星）`, exact:true})).toHaveAttribute('aria-pressed','true');
  }
  await page.getByRole('button', {name:'2 分（1 星）', exact:true}).focus();
  await page.keyboard.press('Space');
  await page.getByPlaceholder('写下你的短评...').fill('先保存最低分，再修改为最高分。');
  await page.getByRole('button', {name:'发表评论', exact:true}).click();
  await expect(score).toHaveText('4.7');
  await page.reload();
  await expect(page.getByRole('button', {name:'修改', exact:true})).toHaveCount(0);
  await page.getByRole('button', {name:'写书评', exact:true}).click();
  await expect(page.getByRole('button', {name:'2 分（1 星）', exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button', {name:'10 分（5 星）', exact:true}).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', {name:'发表评论', exact:true}).click();
  await expect(score).toHaveText('7.3');
  expect(writes).toEqual([1,5]);
  await expect(page.locator('.book-review-meta [role="img"]').first()).toHaveAttribute('aria-label','10.0 分');
  await page.locator('#reviews-section:visible').screenshot({path:info.outputPath('comments.png')});
});

test('an unrated work has no numeric zero score', async ({page}) => {
  await page.route(`**/api/books/${book}/reviews?*`, route=>route.fulfill({json:[], headers:{'X-Total-Count':'0','X-Review-Distribution':'{}'}}));
  await page.goto(`${base}/book/${book}`);
  await expect(page.locator('.book-rating-score')).toHaveText('暂无评分');
  await expect(page.locator('.book-mobile-rating strong')).toHaveText('暂无评分');
});

test('initialized score survives loading an empty real review list', async ({page}) => {
  await page.route(`**/api/books/${book}/reviews?*`, route=>route.fulfill({json:[], headers:{'X-Total-Count':'0','X-Review-Distribution':'{}','X-Book-Rating':'4.75'}}));
  await page.goto(`${base}/book/${book}`);
  await expect(page.locator('.book-rating-score')).toHaveText('9.5');
  await expect(page.locator('.book-mobile-rating strong')).toHaveText('9.5');
  await page.reload();
  await expect(page.locator('.book-mobile-rating strong')).toHaveText('9.5');
});
