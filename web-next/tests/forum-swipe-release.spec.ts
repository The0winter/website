import '../../tools/test-env.cjs';
import {test, expect, type Page, type CDPSession} from '@playwright/test';

const base = process.env.MOBILE_SECTIONS_BASE || 'http://127.0.0.1:3000';
test.use({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});

async function idle(page: Page) {
  await expect(page.locator('.mobile-section-snapshot, .mobile-section-header, .mobile-section-backdrop')).toHaveCount(0);
  await expect(page.locator('html')).not.toHaveAttribute('data-mobile-section-transition', /.+/);
}

async function forum(page: Page) {
  await page.locator('.mh-bottom:visible [data-section=forum]').click();
  await expect(page).toHaveURL(base + '/forum');
  await expect(page.getByRole('button', {name: '推荐', exact: true})).toHaveAttribute('aria-current', 'page');
  await idle(page);
}

test.beforeEach(async ({page}) => {
  await page.route('**/api/auth/session', route => route.fulfill({json: {user: null, profile: null}}));
  await page.route('**/api/forum/posts*', route => route.fulfill({json: []}));
  await page.goto(base + '/');
  await expect(page.locator('.mobile-home .mh-bottom [data-section=library]')).toHaveAttribute('href', '/login');
  await forum(page);
});

async function touch(cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', points: {x: number; y: number; id: number}[] = []) {
  await cdp.send('Input.dispatchTouchEvent', {type, touchPoints: points});
}

// Keep the final move and release in one task so a deferred React render cannot
// hide the race. Actual browser touch input with CPU throttling is covered below.
test('a same-frame forum drag and release always finishes the section transition', async ({page}) => {
  await page.locator('.forum-mobile-feed').evaluate(element => {
    const point = new Touch({identifier: 1, target: element, clientX: 75, clientY: 320});
    element.dispatchEvent(new TouchEvent('touchstart', {bubbles: true, touches: [point], targetTouches: [point], changedTouches: [point]}));
  });
  await page.locator('.forum-mobile-feed').evaluate(element => {
    const point = new Touch({identifier: 1, target: element, clientX: 170, clientY: 320});
    element.dispatchEvent(new TouchEvent('touchmove', {bubbles: true, cancelable: true, touches: [point], targetTouches: [point], changedTouches: [point]}));
    element.dispatchEvent(new TouchEvent('touchend', {bubbles: true, touches: [], targetTouches: [], changedTouches: [point]}));
  });
  await expect(page).toHaveURL(base + '/');
  await idle(page);
});

for (const width of [320, 390]) test(`${width}px fast releases finish after repeated forum visits on a slow CPU`, async ({page, context}, info) => {
  await page.setViewportSize({width, height: 844});
  const cdp = await context.newCDPSession(page);
  try {
    for (const rate of [4, 8]) {
      await cdp.send('Emulation.setCPUThrottlingRate', {rate});
      for (let iteration = 0; iteration < 6; iteration++) {
        if (iteration || rate === 8) await forum(page);
        const x = 65, y = iteration % 2 ? 640 : 320;
        // One move followed immediately by release reproduced the orphaned drag.
        await touch(cdp, 'touchStart', [{x, y, id: 1}]);
        await touch(cdp, 'touchMove', [{x: x + 95, y, id: 1}]);
        await touch(cdp, 'touchEnd');
        await expect(page).toHaveURL(base + '/');
        await idle(page);
        await expect(page.locator('.mh-bottom:visible [aria-current=page]')).toHaveText('精选');
      }
    }
    await page.screenshot({path: info.outputPath(`verified-fast-release-${width}.png`)});
  } finally {
    await cdp.send('Emulation.setCPUThrottlingRate', {rate: 1});
    await cdp.detach();
  }
});

test('short, reversed, cancelled and multi-touch drags settle and leave the next swipe usable', async ({page, context}) => {
  const cdp = await context.newCDPSession(page);
  try {
    for (const scenario of ['short', 'reverse', 'cancel', 'multi']) {
      await touch(cdp, 'touchStart', [{x: 75, y: 320, id: 1}]);
      await touch(cdp, 'touchMove', [{x: scenario === 'short' ? 100 : 170, y: 320, id: 1}]);
      await expect(page.locator('html')).toHaveAttribute('data-mobile-section-transition', 'dragging');
      if (scenario === 'reverse') await touch(cdp, 'touchMove', [{x: 85, y: 320, id: 1}]);
      if (scenario === 'multi') await touch(cdp, 'touchStart', [{x: 170, y: 320, id: 1}, {x: 230, y: 350, id: 2}]);
      await touch(cdp, scenario === 'cancel' ? 'touchCancel' : 'touchEnd');
      await idle(page);
      await expect(page).toHaveURL(base + '/forum');
      await expect(page.getByRole('button', {name: '推荐', exact: true})).toHaveAttribute('aria-current', 'page');
    }
    await touch(cdp, 'touchStart', [{x: 75, y: 320, id: 1}]);
    await touch(cdp, 'touchMove', [{x: 170, y: 320, id: 1}]);
    await touch(cdp, 'touchEnd');
    await expect(page).toHaveURL(base + '/');
    await idle(page);
  } finally {await cdp.detach();}
});

test('fast inner-tab swipes and reversing across the origin keep their destinations', async ({page, context}) => {
  const cdp = await context.newCDPSession(page);
  try {
    await cdp.send('Emulation.setCPUThrottlingRate', {rate: 4});
    for (const [dx, name] of [[-95, '热榜'], [-95, '关注'], [95, '热榜'], [95, '推荐']] as const) {
      await touch(cdp, 'touchStart', [{x: 195, y: 320, id: 1}]);
      await touch(cdp, 'touchMove', [{x: 195 + dx, y: 320, id: 1}]);
      await touch(cdp, 'touchEnd');
      await expect(page.getByRole('button', {name, exact: true})).toHaveAttribute('aria-current', 'page');
      await expect(page).toHaveURL(base + '/forum');
    }
    await touch(cdp, 'touchStart', [{x: 195, y: 320, id: 1}]);
    for (const x of [270, 140, 285]) await touch(cdp, 'touchMove', [{x, y: 320, id: 1}]);
    await touch(cdp, 'touchEnd');
    await expect(page).toHaveURL(base + '/');
    await idle(page);
  } finally {
    await cdp.send('Emulation.setCPUThrottlingRate', {rate: 1});
    await cdp.detach();
  }
});

test('desktop forum remains controlled by its visible tabs', async ({page, context}) => {
  await page.setViewportSize({width: 1440, height: 900});
  const cdp = await context.newCDPSession(page);
  await touch(cdp, 'touchStart', [{x: 500, y: 320, id: 1}]);
  await touch(cdp, 'touchMove', [{x: 600, y: 320, id: 1}]);
  await touch(cdp, 'touchEnd');
  await idle(page);
  await expect(page).toHaveURL(base + '/forum');
  await page.getByRole('button', {name: '热榜', exact: true}).click();
  await expect(page.getByRole('button', {name: '热榜', exact: true})).toHaveAttribute('aria-current', 'page');
  await cdp.detach();
});
