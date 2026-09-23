import '../../tools/test-env.cjs';
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';

const base = 'http://127.0.0.1:3000';
const atRegistration = async (page: Page) => {
  await expect(page.locator('.register-card')).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(history.state?.registrationNavigation))).toBe(true);
};
test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
});

for (const [width, theme] of [[320, 'light'], [390, 'light'], [390, 'dark'], [768, 'light'], [1440, 'dark']] as const) {
  test(`registration follows the ${theme} site theme at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ colorScheme: theme });
    await page.goto(base + '/register'); await atRegistration(page);
    await expect(page.locator('nav, footer')).toHaveCount(0);
    const colors = await page.locator('.register-page').evaluate(element => ({
      background: getComputedStyle(element).backgroundColor,
      expected: getComputedStyle(element).getPropertyValue('--home-background').trim(),
      overflow: document.documentElement.scrollWidth > innerWidth,
    }));
    await expect(page.locator('.register-page')).toHaveCSS('background-color', theme === 'dark' ? 'rgb(24, 22, 20)' : width < 768 ? 'rgb(244, 236, 230)' : 'rgb(248, 249, 250)');
    expect(colors.overflow).toBe(false);
    for (const element of await page.locator('.register-page input, .register-page button').all()) {
      expect((await element.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    const back = (await page.getByRole('button', { name: '返回', exact: true }).boundingBox())!;
    expect(back.x).toBeLessThan(35);expect(back.y).toBeLessThan(25);
    await page.screenshot({ path: info.outputPath(`register-${width}-${theme}.png`), fullPage: true });
  });
}

test('Back and login shortcuts preserve the source after reload; direct entry stays on the site', async ({ page }) => {
  await page.goto(base + '/login');
  await page.getByRole('link', { name: '注册账号', exact: true }).click(); await atRegistration(page);
  await page.reload(); await atRegistration(page);
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(page.locator('.login-card')).toBeVisible();
  await page.goForward(); await atRegistration(page);
  await page.getByRole('button', { name: '立即登录', exact: true }).click();
  await expect(page.locator('.login-card')).toBeVisible();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(page).toHaveURL(base + '/');
  const direct = await page.context().newPage();
  await direct.goto(base + '/register?next=https://example.com'); await atRegistration(direct);
  await direct.reload(); await atRegistration(direct);
  await direct.getByRole('button', { name: '返回', exact: true }).click();
  await expect(direct).toHaveURL(base + '/');await direct.close();
});

test('sending disables repeat clicks, displays server errors and allows retry', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  let count = 0;
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/auth/send-code', async route => {
    count++;
    if (count === 1) { await waiting; return route.fulfill({ status: 503, json: { error: '邮件发送失败，请重试' } }); }
    await route.fulfill({ json: { message: '验证码已发送' } });
  });
  await page.goto(base + '/register');await atRegistration(page);
  await page.getByRole('button', { name: '获取验证码' }).click();
  await expect(page.locator('.register-card').getByRole('alert')).toHaveText('请输入有效的邮箱地址');expect(count).toBe(0);
  await page.getByLabel('邮箱地址', { exact: true }).fill('registration@example.test');
  await page.getByRole('button', { name: '获取验证码' }).click();
  await expect(page.getByRole('button', { name: '发送中…' })).toBeDisabled();
  await expect.poll(() => count).toBe(1);release();
  await expect(page.locator('.register-card').getByRole('alert')).toHaveText('邮件发送失败，请重试');
  await page.getByRole('button', { name: '获取验证码' }).click();
  await expect(page.getByRole('status')).toContainText('验证码已发送');
  await expect(page.locator('.register-send')).toBeDisabled();expect(count).toBe(2);
  await page.getByLabel('邮箱地址', { exact: true }).fill('changed@example.test');
  await expect(page.getByRole('status')).toHaveCount(0);
  await page.getByLabel('确认密码', { exact: true }).fill('Local-test-12345');
  await page.getByRole('button', { name: '显示密码', exact: true }).click();
  await expect(page.getByLabel('确认密码', { exact: true })).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: '隐藏密码', exact: true }).click();
  await expect(page.getByLabel('确认密码', { exact: true })).toHaveAttribute('type', 'password');
  await page.locator('.register-submit').scrollIntoViewIfNeeded();await expect(page.locator('.register-submit')).toBeInViewport();
});

test('a captured verification code completes registration and creates a session', async ({ page }) => {
  const email = `registration-${Date.now()}@example.test`;
  await page.goto(base + '/register');await atRegistration(page);
  await page.getByLabel('用户名', { exact: true }).fill('注册界面测试' + Date.now());
  await page.getByLabel('邮箱地址', { exact: true }).fill(email);
  await page.getByRole('button', { name: '获取验证码' }).click();
  await expect(page.getByRole('status')).toContainText('验证码已发送');
  const captured = () => (JSON.parse(fs.readFileSync(path.resolve('.runtime/development-mail.json'), 'utf8')) as {email: string; code: string}[]).find(mail => mail.email === email);
  await expect.poll(captured).toBeTruthy();
  await page.getByLabel('邮箱验证码', { exact: true }).fill(captured()!.code);
  await page.getByLabel('密码', { exact: true }).fill('Local-test-12345');
  await page.getByLabel('确认密码', { exact: true }).fill('Different-12345');
  await page.getByRole('button', { name: '注册账号', exact: true }).click();
  await expect(page.locator('.register-card').getByRole('alert')).toHaveText('两次输入的密码不一致');
  await page.getByLabel('确认密码', { exact: true }).fill('Local-test-12345');
  await page.getByRole('button', { name: '注册账号', exact: true }).click();
  await expect(page).toHaveURL(base + '/');
  expect((await page.request.get(base + '/api/auth/session')).status()).toBe(200);
});
