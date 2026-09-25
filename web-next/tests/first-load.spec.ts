import {test, expect} from './fixtures/without-analytics';

const base = process.env.FIRST_LOAD_BASE || 'http://127.0.0.1:3000';

test('reading pages defer the creation center until it is opened', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.route('**/api/auth/session', route => route.fulfill({json:{user:null,profile:null}}));
  await page.route('**/api/traffic/observe', route => route.fulfill({json:{}}));
  await page.route('**/api/books/*/views', route => route.fulfill({json:{success:true,counted:false}}));
  const scripts: Promise<string>[] = [];
  page.on('response', response => {
    if (response.request().resourceType() === 'script' && response.ok()) scripts.push(response.text().catch(() => ''));
  });
  await page.goto(base);
  const launch = page.getByRole('button',{name:'创作',exact:true});
  await expect(launch).toBeVisible();
  await expect(page.locator('.mh-banner').first()).toBeVisible();
  // The dialog imports the whole writing workspace; none of it belongs to a
  // first reading visit, including when visible book links are prefetched.
  await page.waitForTimeout(1200);
  expect((await Promise.all(scripts)).join('\n')).not.toContain('作品还未创建，确定关闭');
  await launch.click();
  const dialog = page.getByRole('dialog',{name:'创作中心',exact:true});
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('data-ready','true');
  expect((await Promise.all(scripts)).join('\n')).toContain('作品还未创建，确定关闭');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await launch.click();
  await expect(dialog).toBeVisible();
  await page.goBack();
  await expect(dialog).not.toBeVisible();
});
