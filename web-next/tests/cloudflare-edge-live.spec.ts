import {test, expect} from './fixtures/without-analytics';
import fs from 'node:fs/promises';
import path from 'node:path';

// Explicit opt-in: this checks the real edge without creating accounts or content.
test.skip(process.env.TEST1_EDGE_LIVE !== '1', 'Set TEST1_EDGE_LIVE=1 for the live edge check');
const base = 'https://jiutianxiaoshuo.com';
const output = path.resolve('.runtime/task-artifacts/cloudflare-guard-20260927');

for (const width of [390, 1440]) test(`Cloudflare preserves reading and login at ${width}px`, async ({page, request}) => {
  await page.setViewportSize({width, height:900});
  await page.route('**/api/books/*/views', route => route.fulfill({json:{success:true, counted:false}}));
  await page.route('**/api/chapters/*/read', route => route.fulfill({json:{success:true, counted:false}}));
  await page.route('**/api/traffic/observe', route => route.fulfill({status:204}));
  await page.addInitScript(() => localStorage.setItem('has-seen-reading-hint', 'true'));
  const failures: string[] = [];
  page.on('response', r => {if (r.url().startsWith(base) && [429,500,502,503,520,521,522,525,526].includes(r.status())) failures.push(`${r.status()} ${r.url()}`);});
  const booksResponse = await request.get(base+'/api/books?limit=1');
  expect(booksResponse.status()).toBe(200);
  expect(booksResponse.headers()['cf-ray']).toBeTruthy();
  const [book] = await booksResponse.json();
  const bookId = book.id || book._id;
  const chaptersResponse = await request.get(`${base}/api/books/${bookId}/chapters?limit=2`);
  const chapters = await chaptersResponse.json();
  const first = chapters[0].id || chapters[0]._id;
  const second = chapters[1].id || chapters[1]._id;
  const response = await page.goto(`${base}/book/${bookId}/${first}`);
  expect(response?.status()).toBe(200);
  expect(response?.headers()['cf-ray']).toBeTruthy();
  const reader = page.locator('.reader-pages-root:visible');
  await expect(reader).toHaveAttribute('data-reader-ready', 'true', {timeout:30000});
  await expect(reader).toHaveAttribute('data-reader-chapter', first);
  await page.keyboard.press('Control+ArrowRight');
  await expect(reader).toHaveAttribute('data-reader-chapter', second, {timeout:20000});
  await expect(reader).toHaveAttribute('data-reader-ready', 'true');
  await fs.mkdir(output, {recursive:true});
  await page.screenshot({path:path.join(output,`verified-reader-${width}.png`)});
  expect((await page.goto(base+'/login'))?.status()).toBe(200);
  await expect(page.locator('input[type="password"]')).toBeVisible();
  await page.screenshot({path:path.join(output,`verified-login-${width}.png`)});
  expect(failures).toEqual([]);
});
