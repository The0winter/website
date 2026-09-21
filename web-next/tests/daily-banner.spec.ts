import {test, expect, type Page} from '@playwright/test';
const base = process.env.FEATURED_BASE || 'http://127.0.0.1:3000';
test.use({hasTouch: true});
async function drag(page: Page, dx: number, dy = 0) {
  const bounds = (await page.locator('.mh-banner-track').boundingBox())!;
  const x = dx < 0 ? bounds.x + bounds.width - 35 : bounds.x + 35, y = bounds.y + 65;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y, id: 1}]});
  for (let i = 1; i <= 8; i++) {
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: x + dx * i / 8, y: y + dy * i / 8, id: 1}]});
    await page.waitForTimeout(20);
  }
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []}); await cdp.detach();
}

for (const width of [320, 390, 767]) test(`daily three-book carousel swipes without section navigation at ${width}px`, async ({page, request}, info) => {
  await page.setViewportSize({width, height: 844});
  await page.goto(base);
  const books = await (await request.get(`${base}/api/books?orderBy=featured_daily&limit=3`)).json();
  const rail = page.locator('.mh-banner-track'), slides = rail.locator('.mh-banner');
  await expect(slides).toHaveCount(3);
  expect(await slides.evaluateAll(links => links.map(link => link.getAttribute('href')))).toEqual(books.map((book: {id: string}) => `/book/${book.id}`));
  await drag(page, -(width - 90));
  await expect(slides.nth(1)).toHaveAttribute('aria-hidden', 'false');
  await expect(page).toHaveURL(base + '/');
  await expect(page.locator('[data-section-transition]')).toHaveCount(0);
  await page.getByRole('button', {name: `查看推荐：${books[2].title}`, exact: true}).click();
  await expect(slides.nth(2)).toHaveAttribute('aria-hidden', 'false');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path: info.outputPath('verified-banner.png')});
  await slides.nth(2).click();
  await expect(page).toHaveURL(base + `/book/${books[2].id}`);
  await expect(page.locator('.book-detail')).toBeVisible();
  await page.goBack();
  await expect(slides).toHaveCount(3);
});

test('banner rotates, can pause, and stops when reduced motion is requested', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.goto(base); const slides = page.locator('.mh-banner-track .mh-banner');
  await expect(slides).toHaveCount(3);
  await expect(slides.nth(1)).toHaveAttribute('aria-hidden', 'false', {timeout: 10000});
  await page.getByRole('button', {name: '暂停自动轮播'}).click();
  const current = await page.locator('.mh-banner-dots [aria-pressed=true]').getAttribute('aria-label');
  await page.locator('.mh-kicker').first().evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.waitForTimeout(6500);
  expect(await page.locator('.mh-banner-dots [aria-pressed=true]').getAttribute('aria-label')).toBe(current);
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.getByRole('button', {name: '继续自动轮播'}).click();
  await page.locator('.mh-kicker').first().evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.waitForTimeout(6500);
  expect(await page.locator('.mh-banner-dots [aria-pressed=true]').getAttribute('aria-label')).toBe(current);
});
