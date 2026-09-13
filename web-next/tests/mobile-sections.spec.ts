import {test, expect, type Page, type BrowserContext} from '@playwright/test';

const base = process.env.MOBILE_SECTIONS_BASE || 'http://127.0.0.1:3000';
const user = {id: '000000000000000000000001', username: '移动导航验证', role: 'reader'};
test.use({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});

async function setup(page: Page, signedIn = true) {
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {const style = document.createElement('style'); style.textContent = 'nextjs-portal{display:none}'; document.head.append(style);});
  });
  await page.route('**/api/auth/session', route => route.fulfill({json: {user: signedIn ? user : null, profile: signedIn ? user : null}}));
  await page.route('**/api/users/*/library?*', route => route.fulfill({json: [{bookId: '1', book: {id: '1', title: '滑动不会打开这本书', author: '测试作者'}}]}));
  await page.route('**/api/forum/posts*', route => route.fulfill({json: []}));
  await page.goto(base);
  await expect(page.locator('.mobile-home')).toBeVisible();
  if (signedIn) await expect(page.locator('.mobile-home .mobile-account-initial')).toHaveText('移');
  else await expect(page.locator('.mobile-home [data-section=library]')).toHaveAttribute('href', '/login');
}

async function swipe(page: Page, context: BrowserContext, selector: string, dx: number, dy = 0, cancel = false, atY?: number) {
  const box = (await page.locator(selector).first().boundingBox())!;
  const x = box.x + box.width * (dx < 0 ? .8 : .2), y = atY ?? Math.max(130, box.y + 65);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y, id: 1}]});
  for (let step = 1; step <= 6; step++) await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: x + dx * step / 6, y: y + dy * step / 6, id: 1}]});
  await cdp.send('Input.dispatchTouchEvent', {type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: []});
  await cdp.detach();
}

for (const width of [320, 390]) test(`all six pages connect in both directions at ${width}px`, async ({page, context}, info) => {
  await page.setViewportSize({width, height: 844});
  await setup(page);
  await swipe(page, context, '.mh-section', 150);
  await expect(page).toHaveURL(base + '/library');
  await expect(page.getByRole('tab')).toHaveText(['浏览记录', '书架']);
  await expect(page.getByRole('tab', {name: '书架', exact: true})).toHaveAttribute('aria-selected', 'true');
  await swipe(page, context, '.shelf-viewport', 150);
  await expect(page.getByRole('tab', {name: '浏览记录'})).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.shelf-viewport')).not.toHaveAttribute('data-switching', 'true');
  await swipe(page, context, '.shelf-viewport', -150);
  await expect(page.getByRole('tab', {name: '书架', exact: true})).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.shelf-viewport')).not.toHaveAttribute('data-switching', 'true');
  await page.screenshot({path: info.outputPath('library.png')});
  await swipe(page, context, '.shelf-viewport', -150);
  await expect(page).toHaveURL(base + '/');
  await swipe(page, context, '.mh-section', -150);
  await expect(page).toHaveURL(base + '/forum');
  const tabs = page.getByRole('navigation', {name: '论坛内容分类'});
  await expect(tabs.getByRole('button')).toHaveText(['推荐', '热榜', '关注']);
  await expect(tabs.getByRole('button', {name: '推荐', exact: true})).toHaveAttribute('aria-current', 'page');
  for (const name of ['热榜', '关注']) {
    await swipe(page, context, '.forum-mobile-feed', -150);
    await expect(tabs.getByRole('button', {name, exact: true})).toHaveAttribute('aria-current', 'page');
  }
  await swipe(page, context, '.forum-mobile-feed', -150);
  await expect(tabs.getByRole('button', {name: '关注', exact: true})).toHaveAttribute('aria-current', 'page');
  for (const name of ['热榜', '推荐']) {
    await swipe(page, context, '.forum-mobile-feed', 150);
    await expect(tabs.getByRole('button', {name, exact: true})).toHaveAttribute('aria-current', 'page');
  }
  await expect.poll(() => page.locator('.forum-mobile-feed > div').evaluate(element => new DOMMatrix(getComputedStyle(element).transform).m41)).toBe(0);
  await page.screenshot({path: info.outputPath('forum.png')});
  await swipe(page, context, '.forum-mobile-feed', 150);
  await expect(page).toHaveURL(base + '/');
  await expect(page.locator('.mh-bottom:visible [aria-current=page]')).toHaveText('精选');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('short, vertical and cancelled gestures stay put; the next tap works', async ({page, context}) => {
  await setup(page);
  await swipe(page, context, '.mh-section', 25);
  await swipe(page, context, '.mh-section', 10, -100);
  await page.evaluate(() => scrollTo(0, 0));
  await swipe(page, context, '.mh-section', -150, 0, true);
  await expect(page).toHaveURL(base + '/');
  await page.locator('.mh-bottom:visible [data-section=forum]').tap();
  await expect(page).toHaveURL(base + '/forum');
  await swipe(page, context, '.forum-mobile-feed', 25);
  await swipe(page, context, '.forum-mobile-feed', -150, 0, true);
  await expect(page.getByRole('button', {name: '推荐', exact: true})).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', {name: '关注', exact: true}).tap();
  await expect(page.getByRole('button', {name: '关注', exact: true})).toHaveAttribute('aria-current', 'page');
});

test('signed-out shelf swipe follows the normal login route', async ({page, context}) => {
  await setup(page, false);
  await expect(page.locator('.mh-bottom:visible [data-section=library]')).toHaveAttribute('href', '/login');
  await swipe(page, context, '.mh-section', 150);
  await expect(page).toHaveURL(base + '/login');
});

test('empty space below the shelf and forum also accepts section swipes', async ({page, context}) => {
  await setup(page);
  await swipe(page, context, '.mh-section', 150);
  await expect(page).toHaveURL(base + '/library');
  await expect(page.locator('#shelf-content .shelf-row')).toHaveCount(1);
  await swipe(page, context, '.library-page', -150, 0, false, 650);
  await expect(page).toHaveURL(base + '/');
  await swipe(page, context, '.mh-section', -150);
  await expect(page).toHaveURL(base + '/forum');
  await swipe(page, context, '.forum-page', 150, 0, false, 650);
  await expect(page).toHaveURL(base + '/');
});

test('management prevents leaving the shelf and desktop keeps its boundary', async ({page, context}) => {
  await setup(page);
  await page.locator('.mh-bottom:visible [data-section=library]').click();
  await page.getByRole('button', {name: '管理', exact: true}).click();
  await swipe(page, context, '.shelf-viewport', -150);
  await expect(page).toHaveURL(base + '/library');
  await expect(page.locator('.library-page')).toHaveAttribute('data-managing', 'true');
  await page.getByRole('button', {name: '返回', exact: true}).click();
  await page.setViewportSize({width: 1440, height: 900});
  await swipe(page, context, '.shelf-viewport', -150);
  await expect(page).toHaveURL(base + '/library');
});
