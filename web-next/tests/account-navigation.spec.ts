import { test, expect, type Page } from '@playwright/test';

const base = 'http://127.0.0.1:3000';
const home = (page: Page) => page.locator('.mobile-home');
const link = (page: Page, name: string) => page.locator('.mh-bottom').getByRole('link', { name: new RegExp(`^${name}(?:\\s|$)`) });
const releases = new Set<() => void>();
let pageErrors: string[] = [];
function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  releases.add(release);
  return { promise, release };
}

test.afterEach(() => { releases.forEach(release => release()); releases.clear(); expect(pageErrors).toEqual([]); });

test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
    // Next's development badge covers the shelf item; it is absent in production.
    const style = document.createElement('style');
    style.textContent = 'nextjs-portal { display: none; }';
    document.head.append(style);
  }));
  await page.addInitScript(() => Object.defineProperty(navigator, 'connection', {
    value: { saveData: true, addEventListener() {}, removeEventListener() {} },
  }));
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
});

for (const name of ['书架', '我']) {
  test(`${name}: a slow guest navigation retains home and never paints a protected page`, async ({ page }, testInfo) => {
    const login = gate();
    await page.route('**/login?_rsc=*', async route => { await login.promise; await route.continue(); });
    await page.goto(base);
    await expect(link(page, name)).toHaveAttribute('href', '/login');
    await page.evaluate(() => {
      const frames: { path: string; chrome: boolean; blank: boolean }[] = [];
      Object.assign(window, { navigationFrames: frames });
      function sample() {
        const visible = (selector: string) => Array.from(document.querySelectorAll<HTMLElement>(selector)).some(element => element.getBoundingClientRect().height > 0 && getComputedStyle(element).display !== 'none');
        frames.push({ path: location.pathname, chrome: visible('[data-site-chrome]'), blank: !visible('.mobile-home, .login-page') });
        if (frames.length < 600) requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    });
    await link(page, name).click();
    await expect(link(page, name).getByRole('status')).toHaveCount(1);
    await expect(home(page)).toBeVisible();
    await expect(page.locator('[data-site-chrome]:visible')).toHaveCount(0);
    await expect(link(page, name)).toHaveCSS('opacity', '0.55');
    await page.screenshot({ path: testInfo.outputPath(`pending-${name}.png`) });
    login.release();
    await expect(page.locator('.login-card')).toBeVisible();
    const frames = await page.evaluate(() => (window as Window & { navigationFrames?: { path: string; chrome: boolean; blank: boolean }[] }).navigationFrames!);
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.filter(frame => frame.chrome || frame.blank || !['/', '/login'].includes(frame.path))).toEqual([]);
    await page.goBack(); await expect(home(page)).toBeVisible();
  });
}

test('slow forum navigation dims only the chosen item and draws no blue loading bar', async ({ page }, testInfo) => {
  const forum = gate();
  await page.route('**/forum?_rsc=*', async route => { await forum.promise; await route.continue(); });
  await page.goto(base);
  const bar = await page.locator('.mh-bottom').boundingBox();
  await link(page, '论坛').click();
  const status = link(page, '论坛').getByRole('status');
  await expect(status).toHaveCount(1);
  expect((await status.boundingBox())!.width).toBeLessThanOrEqual(1);
  await expect(status).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(link(page, '论坛')).toHaveCSS('opacity', '0.55');
  expect(await page.locator('.mh-bottom').boundingBox()).toEqual(bar);
  await page.screenshot({ path: testInfo.outputPath('pending-forum.png') });
  forum.release();
  await expect(page).toHaveURL(base + '/forum');
});

for (const signedIn of [false, true]) {
  test(`a click during session restoration waits on home then opens the ${signedIn ? 'account' : 'login'}`, async ({ page }) => {
    if (signedIn) {
      await page.goto(base + '/login');
      await page.getByPlaceholder('请输入用户名').fill('隔离作者');
      await page.getByPlaceholder('请输入密码').fill('Local-test-12345');
      await page.getByRole('button', { name: '立即登录', exact: true }).click();
      await expect(page).toHaveURL(base + '/');
    }
    const session = gate();
    await page.route('**/api/auth/session', async route => { await session.promise; await route.continue(); });
    await page.goto(base);
    await link(page, '我').click();
    await expect(link(page, '我')).toHaveAttribute('aria-busy', 'true');
    await expect(page).toHaveURL(base + '/');
    await expect(home(page)).toBeVisible();
    await expect(page.locator('[data-site-chrome]:visible')).toHaveCount(0);
    session.release();
    await expect(page).toHaveURL(base + (signedIn ? '/profile' : '/login'));
    if (signedIn) await expect(page.getByRole('button', { name: '退出登录', exact: true })).toBeVisible();
    else await expect(page.locator('.login-card')).toBeVisible();
    await page.goBack(); await expect(home(page)).toBeVisible();
    await expect(link(page, '我')).not.toHaveAttribute('aria-busy', 'true');
  });
}

test('choosing another item cancels a queued account navigation', async ({ page }) => {
  const session = gate();
  await page.route('**/api/auth/session', async route => { await session.promise; await route.continue(); });
  await page.goto(base);
  await link(page, '书架').click();
  await expect(link(page, '书架')).toHaveAttribute('aria-busy', 'true');
  await link(page, '论坛').click();
  await expect(page).toHaveURL(base + '/forum');
  const restored = page.waitForResponse('**/api/auth/session');
  session.release(); await restored;
  await expect(page.getByRole('navigation', { name: '移动端主导航' }).getByRole('link', { name: '我', exact: true })).toHaveAttribute('href', '/login');
  await expect(page).toHaveURL(base + '/forum');
});

for (const destination of ['library', 'profile']) {
  test(`direct ${destination} entry displays a branded loading state with no legacy chrome`, async ({ page }) => {
    const session = gate();
    await page.route('**/api/auth/session', async route => { await session.promise; await route.continue(); });
    await page.goto(base + '/' + destination);
    await expect(page.locator('.account-loading')).toBeVisible();
    await expect(page.locator('.account-loading')).toHaveCSS('background-color', 'rgb(244, 236, 230)');
    await expect(page.locator('[data-site-chrome]')).toHaveCount(0);
    session.release();
    await expect(page.locator('.login-card')).toBeVisible();
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await expect(home(page)).toBeVisible();
  });
}

test('desktop header and footer account links also resolve directly to login', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(base);
  await expect(page.locator('nav[data-site-chrome]').getByRole('link', { name: '书架', exact: true })).toHaveAttribute('href', '/login');
  const shelf = page.locator('footer').getByRole('link', { name: '我的书架', exact: true });
  await expect(shelf).toHaveAttribute('href', '/login');
  await shelf.click();
  await expect(page.locator('.login-card')).toBeVisible();
  await page.goBack(); await expect(page.locator('.desktop-home')).toBeVisible();
});
