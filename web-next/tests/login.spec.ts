import { test, expect, type Page } from '@playwright/test';

const base = 'http://127.0.0.1:3000';
const detail = '/book/000000000000000000000101';
const reader = `${detail}/000000000000000000000101`;
const idle = (page: Page) => expect(page.locator('html')).not.toHaveAttribute('data-book-transition', /.+/);
const atLogin = async (page: Page) => {
  await expect(page.locator('.login-card')).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(history.state?.loginNavigation))).toBe(true);
};

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.addInitScript(() => localStorage.setItem('has-seen-reading-hint', 'true'));
});

for (const width of [320, 390, 768, 1440]) {
  test(`login matches home at ${width}px and mobile profile Back has no redirect loop`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(base);
    const home = page.locator(width < 768 ? '.mobile-home' : '.desktop-home');
    const background = await home.evaluate(element => getComputedStyle(element).backgroundColor);
    expect(background).toBe(width < 768 ? 'rgb(244, 236, 230)' : 'rgb(248, 249, 250)');
    await page.locator(width < 768 ? '.mh-bottom a[href="/profile"]' : 'nav a[href="/login"]:visible').click();
    await atLogin(page);
    await expect(page.locator('nav, footer')).toHaveCount(0);
    await expect(page.locator('a[href^="mailto:"]')).toHaveCount(0);
    expect(await page.locator('.login-page').evaluate(element => getComputedStyle(element).backgroundColor)).toBe(background);
    await expect(page.locator('.login-submit')).toHaveCSS('background-color', width < 768 ? 'rgb(206, 59, 66)' : 'rgb(37, 99, 235)');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await page.locator('.login-card').boundingBox())!.height).toBeLessThan(460);
    await page.getByRole('button', { name: '邮箱登录', exact: true }).click();
    await expect(page.getByLabel('邮箱地址', { exact: true })).toHaveAttribute('type', 'email');
    await page.getByLabel('密码', { exact: true }).fill('example-password');
    await page.getByRole('button', { name: '显示密码', exact: true }).click();
    await expect(page.getByLabel('密码', { exact: true })).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: '隐藏密码', exact: true }).click();
    await page.getByRole('button', { name: '用户名登录', exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath(`login-${width}.png`) });
    await page.reload(); await atLogin(page);
    await page.goBack(); await expect(page).toHaveURL(base + '/'); await idle(page);
    await expect(home).toBeVisible();
    await page.goForward(); await atLogin(page);
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await expect(home).toBeVisible();
    await expect(page.locator('a[href^="mailto:"]')).toHaveCount(0);
  });
}

for (const source of ['direct', 'library', 'writer']) {
  test(`${source} entry gets a local fallback and stays stable after reload`, async ({ page }) => {
    await page.goto(base + (source === 'direct' ? '/login?next=https://example.com' : '/' + source));
    await atLogin(page);
    const length = await page.evaluate(() => history.length);
    await page.reload(); await atLogin(page);
    expect(await page.evaluate(() => history.length)).toBe(length);
    await page.goBack();
    await expect(page).toHaveURL(base + '/');
    await expect(page.locator('.desktop-home')).toBeVisible();
    await expect(page.locator('.login-page')).toHaveCount(0);
    await page.goForward(); await atLogin(page);
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await expect(page).toHaveURL(base + '/');
    await expect(page.locator('.desktop-home')).toBeVisible();
  });
}

test('book login supports Back, Forward and a real username session returning to its book', async ({ page }) => {
  await page.goto(base + detail); await idle(page);
  await page.getByRole('button', { name: '加入书架', exact: true }).filter({ visible: true }).click();
  await atLogin(page);
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(page).toHaveURL(base + detail); await idle(page);
  await expect(page.locator('.book-detail:visible')).toBeVisible();
  await page.goForward(); await atLogin(page);
  await page.getByPlaceholder('请输入用户名').fill('隔离作者');
  await page.getByPlaceholder('请输入密码').fill('incorrect-password');
  await page.getByRole('button', { name: '立即登录', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByPlaceholder('请输入用户名')).toHaveValue('隔离作者');
  await page.getByPlaceholder('请输入密码').fill('Local-test-12345');
  await page.getByRole('button', { name: '立即登录', exact: true }).click();
  await expect(page).toHaveURL(base + detail); await idle(page);
  expect((await page.request.get(base + '/api/auth/session')).status()).toBe(200);
  await page.goBack(); await expect(page).toHaveURL(base + '/');
});

test('search query survives login and email authentication', async ({ page }) => {
  const source = '/search?q=' + encodeURIComponent('山海');
  await page.goto(base + source);
  await page.locator('nav a[href="/login"]:visible').click(); await atLogin(page);
  await page.getByRole('button', { name: '邮箱登录', exact: true }).click();
  await page.getByPlaceholder('请输入邮箱').fill('reader@example.test');
  await page.getByPlaceholder('请输入密码').fill('Local-test-12345');
  await page.getByRole('button', { name: '立即登录', exact: true }).click();
  await expect(page).toHaveURL(base + source);
  expect((await page.request.get(base + '/api/auth/session')).status()).toBe(200);
});

test('login opened in a new tab returns to the referring page instead of leaving the site', async ({ page }) => {
  await page.goto(base + detail); await idle(page);
  const opened = page.waitForEvent('popup');
  await page.locator('nav a[href="/login"]:visible').evaluate((link: HTMLAnchorElement) => window.open(link.href, '_blank'));
  const popup = await opened;
  await atLogin(popup);
  await popup.reload(); await atLogin(popup);
  await popup.goBack(); await expect(popup).toHaveURL(base + detail);
  await expect(popup.locator('.book-detail:visible')).toBeVisible();
  await popup.close();
});

test('reader bookmark login returns to the chapter and preserves reader/detail/home history', async ({ page }) => {
  await page.goto(base + reader);
  await expect(page.locator('.reader-pages-root:visible')).toHaveAttribute('data-reader-ready', 'true'); await idle(page);
  await page.getByRole('button', { name: '书签', exact: true }).click(); await atLogin(page);
  await page.reload(); await atLogin(page);
  await page.goBack(); await expect(page).toHaveURL(base + reader);
  await expect(page.locator('.reader-pages-root:visible')).toHaveAttribute('data-reader-ready', 'true'); await idle(page);
  await page.goForward(); await atLogin(page);
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(page).toHaveURL(base + reader); await idle(page);
  await page.goBack(); await expect(page).toHaveURL(base + detail); await idle(page);
  await page.goBack(); await expect(page).toHaveURL(base + '/');
});
