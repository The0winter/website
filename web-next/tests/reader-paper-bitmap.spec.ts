import {test, expect} from '@playwright/test';

const base = 'http://127.0.0.1:3000', book = '000000000000000000000101';
const texture = '/textures/reader-paper-v2.webp';

test('cold paper is decoded before the loading sheet reveals text and reused across touch turns', async ({browser}, testInfo) => {
  const context = await browser.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: 3, isMobile: true, hasTouch: true});
  const page = await context.newPage();
  let release!: () => void, textureRequests = 0;
  const held = new Promise<void>(resolve => {release = resolve;});
  try {
    await page.addInitScript(() => localStorage.setItem('has-seen-reading-hint', 'true'));
    await page.route(`**${texture}`, async route => {textureRequests++; await held; await route.continue();});
    await page.goto(`${base}/book/${book}`);
    await page.getByRole('link', {name: '立即阅读', exact: true}).click();
    const root = page.locator('.reader-pages-root:visible');
    await expect(root).toHaveAttribute('data-reader-ready', 'true');
    // Deliberately outlast the existing 400 ms cover minimum with a slow asset.
    await page.waitForTimeout(600);
    await expect(page.locator('.chapter-loading-message')).toBeVisible();
    release();
    await expect(page.locator('.chapter-loading-page')).toHaveCount(0);
    const sheet = root.locator('.reader-page-window > .reader-page-surface'), number = sheet.locator('[data-reader-page]');
    await expect(sheet).toHaveCSS('background-image', /reader-paper-v2\.webp/);
    await expect(sheet).toHaveCSS('background-size', '768px 1024px');
    await expect(sheet).toHaveCSS('background-color', 'rgb(219, 196, 158)');
    for (let index = 0; index < 4; index++) {
      await page.touchscreen.tap(355, 430);
      await expect(number).toHaveText(new RegExp(`^${index + 2}/`));
    }
    expect(textureRequests).toBe(1);
    await page.screenshot({path: testInfo.outputPath('deeper-paper-dpr3.png')});
    const response = await page.request.get(base + texture);
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toContain('image/webp');
    expect((await response.body()).length).toBeLessThan(80_000);
  } finally {release(); await context.close();}
});

test('a stalled paper image still lets the chapter open', async ({browser}) => {
  const context = await browser.newContext({viewport: {width: 390, height: 844}});
  const page = await context.newPage();
  let release!: () => void;
  const held = new Promise<void>(resolve => {release = resolve;});
  try {
    await page.addInitScript(() => localStorage.setItem('has-seen-reading-hint', 'true'));
    await page.route(`**${texture}`, async route => {await held; await route.abort();});
    await page.goto(`${base}/book/${book}`);
    await page.getByRole('link', {name: '立即阅读', exact: true}).click();
    await expect(page.locator('.chapter-loading-page')).toHaveCount(0);
    await expect(page.locator('.reader-pages-root:visible')).toHaveAttribute('data-reader-ready', 'true');
    await expect(page.locator('.reader-page-window > .reader-page-surface .reader-paragraph').first()).toBeVisible();
  } finally {release(); await context.close();}
});
