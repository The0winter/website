import {test, expect, type Page} from '@playwright/test';

const base = process.env.FEATURED_BASE || 'http://127.0.0.1:3000';
test.use({hasTouch: true});
test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'connection', {value: {saveData: true, addEventListener() {}, removeEventListener() {}}});
    document.addEventListener('DOMContentLoaded', () => {const style = document.createElement('style'); style.textContent = 'nextjs-portal{display:none}'; document.head.append(style);});
  });
});

async function drag(page: Page, x: number, y: number, dx: number, dy = 0) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y, id: 1}]});
  for (let i = 1; i <= 8; i++) {
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: x + dx * i / 8, y: y + dy * i / 8, id: 1}]});
    await page.waitForTimeout(20);
  }
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  await cdp.detach();
}

for (const width of [320, 390, 767]) test(`57 unique recommendations alternate two lists with an eight-book shelf at ${width}px`, async ({page, request}, info) => {
  await page.setViewportSize({width, height: 844});
  const top = (await (await request.get(`${base}/api/books?orderBy=views&limit=50`)).json()).map((book: {id: string}) => `/book/${book.id}`);
  await page.goto(base);
  const home = page.locator('.mobile-home:visible');
  await expect(home.locator('.mh-section')).toHaveCount(12);
  const links = home.locator('.mh-banner, .mh-book, .mh-shelf-book');
  await expect(links).toHaveCount(57);
  const hrefs = await links.evaluateAll(nodes => nodes.map(node => node.getAttribute('href')));
  expect(new Set(hrefs).size).toBe(57);
  expect(hrefs.filter(href => top.includes(href))).toHaveLength(0);
  for (let i = 0; i < 12; i++) {
    const section = home.locator('.mh-section').nth(i);
    await expect(section.locator(i % 3 === 2 ? '.mh-shelf-book' : '.mh-book')).toHaveCount(i % 3 === 2 ? 8 : 3);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path: info.outputPath('final-top.png')});
  const shelf = home.locator('.mh-shelf').first();
  await shelf.scrollIntoViewIfNeeded();
  const bounds = (await shelf.boundingBox())!;
  await drag(page, width - 40, bounds.y + 45, -(width - 90));
  await expect.poll(() => shelf.evaluate(el => el.scrollLeft)).toBeGreaterThan(80);
  await expect(page).toHaveURL(base + '/');
  await expect(page.locator('[data-section-transition]')).toHaveCount(0);
  await page.screenshot({path: info.outputPath('final-shelf-swiped.png')});
  // Keep using native gestures: assigning scrollLeft during touch momentum can
  // be superseded by the browser's still-running scroll/snap animation.
  for (let attempt = 0; attempt < 4; attempt++) {
    if (await shelf.evaluate(el => el.scrollWidth - el.clientWidth - el.scrollLeft < 2)) break;
    await drag(page, width - 40, bounds.y + 45, -(width - 90));
  }
  await expect(shelf.locator('.mh-shelf-book').last()).toBeInViewport();
  await drag(page, width - 40, bounds.y + 45, -(width - 90));
  await expect(page).toHaveURL(base + '/');
  // Native vertical scrolling still works when a gesture starts over the shelf.
  const before = await page.evaluate(() => scrollY);
  await drag(page, width / 2, bounds.y + 80, 0, -130);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before + 40);
  await shelf.scrollIntoViewIfNeeded();
  const last = shelf.locator('.mh-shelf-book').last(), href = await last.getAttribute('href');
  await last.click();
  await expect(page).toHaveURL(base + href);
  await expect(page.locator('.book-detail')).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-book-transition', /.+/);
  await page.goBack();
  await expect(home.locator('.mh-section')).toHaveCount(12);
  await expect(page.locator('html')).not.toHaveAttribute('data-book-transition', /.+/);
  await home.locator('.mh-feed-end').scrollIntoViewIfNeeded();
  await expect(home.locator('.mh-feed-end')).toBeVisible();
  await page.screenshot({path: info.outputPath('final-end.png')});
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await shelf.scrollIntoViewIfNeeded();
  await page.screenshot({path: info.outputPath('final-dark-shelf.png')});
});

test('desktop keeps its full-size homepage and no horizontal overflow', async ({page}, info) => {
  await page.setViewportSize({width: 1440, height: 1000});
  await page.goto(base);
  await expect(page.locator('.mobile-home')).toBeHidden();
  await expect(page.locator('.desktop-home')).toBeVisible();
  expect(await page.locator('.desktop-home a[href^="/book/"]').count()).toBeGreaterThan(10);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path: info.outputPath('final-desktop.png')});
});

test('swiping a regular recommendation still switches sections and returns to the complete feed', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.goto(base);
  const row = page.locator('.mobile-home .mh-book').first();
  await row.scrollIntoViewIfNeeded();
  const bounds = (await row.boundingBox())!;
  await drag(page, 300, bounds.y + 35, -190);
  await expect(page).toHaveURL(base + '/forum');
  await expect(page.locator('.mobile-section-snapshot')).toHaveCount(0);
  await expect(page.locator('.forum-page')).toBeVisible();
  await page.locator('.mh-bottom [data-section="home"]').click();
  await expect(page).toHaveURL(base + '/');
  await expect(page.locator('.mobile-home:visible .mh-shelf-book')).toHaveCount(32);
});
