import { test, expect, type Page } from '@playwright/test';

const base = 'http://127.0.0.1:3000';
const book = '000000000000000000000101';

async function login(page: Page, admin = false) {
  await page.goto(base + '/login');
  await page.getByPlaceholder('请输入用户名').fill(admin ? '隔离管理员' : '隔离作者');
  await page.getByPlaceholder('请输入密码').fill(admin ? 'Admin-test-12345' : 'Local-test-12345');
  await page.getByRole('button', { name: '立即登录', exact: true }).click();
  await expect(page).toHaveURL(base + '/');
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('has-seen-reading-hint', 'true');
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = 'nextjs-portal { display:none; }';
      document.head.append(style);
    });
  });
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
});

for (const width of [320, 390, 768, 1440]) {
  test(`profile navigation and administrator reading at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await login(page, true);
    await page.goto(base + '/profile');
    await expect(page.getByRole('heading', { name: /隔离管理员/ })).toBeVisible();
    if (width < 768) await expect(page.locator('[data-admin-mode]')).toBeHidden();
    else await expect(page.locator('[data-admin-mode]')).toBeVisible();
    const nav = page.getByRole('navigation', { name: '移动端主导航' });
    if (width < 768) {
      await expect(page.locator('[data-site-chrome]:visible')).toHaveCount(0);
      await expect(nav).toBeVisible();
      await expect(nav.getByRole('link', { name: '我', exact: true })).toHaveAttribute('aria-current', 'page');
      await expect(nav.getByRole('link')).toHaveCount(4);
      const bounds = (await nav.boundingBox())!;
      expect(Math.round(bounds.y + bounds.height)).toBe(844);
      await page.getByRole('button', { name: '退出登录', exact: true }).scrollIntoViewIfNeeded();
      const logout = (await page.getByRole('button', { name: '退出登录', exact: true }).boundingBox())!;
      expect(logout.y + logout.height).toBeLessThanOrEqual(bounds.y);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: testInfo.outputPath('profile.png') });
      for (const [name, destination] of [['书架', '/library'], ['精选', '/'], ['论坛', '/forum']]) {
        await nav.getByRole('link', { name, exact: true }).click();
        await expect(page).toHaveURL(base + destination);
        await page.goBack();
        await expect(nav).toBeVisible();
      }
    } else {
      await expect(nav).toBeHidden();
      await expect(page.locator('nav[data-site-chrome]')).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('profile.png') });
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.goto(`${base}/book/${book}/${book}`);
    const reader = page.locator('.reader-pages-root:visible');
    await expect(reader).toHaveAttribute('data-reader-ready', 'true');
    const box = (await reader.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.getByRole('button', { name: '设置', exact: true }).first().click();
    await expect(page.getByRole('dialog', {name: '阅读设置'})).toBeVisible();
    await expect(page.getByRole('button', {name: '左右翻页', exact: true})).toBeVisible();
    await expect(page.locator('iframe[title="广告"]')).toHaveCount(0);
    await page.getByRole('button', { name: '关闭阅读设置' }).click();
    await page.keyboard.press('Control+ArrowRight');
    await expect(page).toHaveURL(`${base}/book/${book}/000000000000000000000102`);
  });
}

test('administrator mode does not remain after logout or transfer to a reader account', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, true);
  await page.goto(base + '/profile');
  await expect(page.getByRole('heading', { name: /隔离管理员/ })).toBeVisible();
  await expect(page.locator('[data-admin-mode]')).toBeHidden();
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page).toHaveURL(base + '/');
  await expect(page.locator('[data-admin-mode]')).toHaveCount(0);
  await login(page);
  await page.goto(base + '/profile');
  await expect(page.getByRole('heading', { name: /隔离作者/ })).toBeVisible();
  await expect(page.locator('[data-admin-mode]')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: '移动端主导航' })).toBeVisible();
});
