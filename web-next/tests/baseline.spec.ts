import { test, expect } from '@playwright/test';
import path from 'node:path';
for (const width of [1440,390,320]) {
 test(`baseline ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.route('**/*', route => {
   const u = new URL(route.request().url());
   return ['127.0.0.1','localhost'].includes(u.hostname) || ['data:','blob:'].includes(u.protocol) ? route.continue() : route.abort();
  });
  for (const [name,url] of [['home','/'],['detail','/book/000000000000000000000101'],['reader','/book/000000000000000000000101/000000000000000000000101'],['writer','/writer'],['forum','/forum']]) {
   const res = await page.goto('http://127.0.0.1:3000'+url);
   expect(res?.status()).toBe(200);
   await expect(page.locator('body')).not.toContainText('Application error');
   await page.screenshot({ path: path.resolve('artifacts/current',`${name}-${width}.png`), fullPage: true });
  }
 });
}
