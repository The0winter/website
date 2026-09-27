import {test, expect} from './fixtures/without-analytics';
import fs from 'node:fs/promises';
import path from 'node:path';

// Explicit opt-in: check the live public route without creating accounts or content.
test.skip(process.env.TEST1_EDGE_LIVE !== '1', 'Set TEST1_EDGE_LIVE=1 for the live edge check');
const base = 'https://jiutianxiaoshuo.com';
const expectProxy = process.env.TEST1_EDGE_EXPECT_PROXY === '1';
const output = path.resolve(process.env.TEST1_EDGE_OUTPUT || '.runtime/task-artifacts/cloudflare-guard-20260927');

for (const width of [390, 1440]) test(`Public home and book navigation stay responsive at ${width}px`, async ({page}, info) => {
  await page.setViewportSize({width, height:900});
  await page.route('**/api/books/*/views', route => route.fulfill({json:{success:true, counted:false}}));
  await page.route('**/api/traffic/observe', route => route.fulfill({status:204}));
  const failures: string[] = [];
  const timings: {homeMs:number; detailMs:number}[] = [];
  const documents: object[] = [];
  page.on('requestfinished', request => {
    if (request.resourceType() === 'document' && request.url().startsWith(base))
      documents.push({path:new URL(request.url()).pathname, timing:request.timing()});
  });
  page.on('pageerror', error => failures.push(error.message));
  page.on('response', response => {
    if (response.url().startsWith(base) && (response.status() >= 500 || response.status() === 429))
      failures.push(`${response.status()} ${new URL(response.url()).pathname}`);
  });
  // Leave normal visible-link prefetch enabled: isolated API checks and saveData
  // tests missed proxy response stalls during normal page traffic.
  for (let attempt = 0; attempt < 2; attempt++) {
    const start = Date.now();
    const response = await page.goto(base, {waitUntil:'domcontentloaded', timeout:10000});
    expect(response?.status()).toBe(200);
    expect(Boolean(response?.headers()['cf-ray'])).toBe(expectProxy);
    const home = page.locator(width < 768 ? '.mobile-home' : '.desktop-home');
    await expect(home).toBeVisible({timeout:8000});
    const homeMs = Date.now() - start;
    const href = await home.locator('a[href^="/book/"]:visible').first().getAttribute('href');
    expect(href).toMatch(/^\/book\/[a-f0-9]{24}$/);
    const click = Date.now();
    await home.locator(`a[href="${href}"]:visible`).first().click();
    await expect(page.locator('.book-detail:visible')).toBeVisible({timeout:8000});
    expect(new URL(page.url()).pathname).toBe(href);
    timings.push({homeMs, detailMs:Date.now() - click});
    await info.attach(`navigation-${attempt}`, {body:JSON.stringify({timings,documents}), contentType:'application/json'});
    expect(homeMs).toBeLessThan(8000);
    expect(timings.at(-1)!.detailMs).toBeLessThan(8000);
  }
  await fs.mkdir(output, {recursive:true});
  await fs.writeFile(path.join(output, `verified-navigation-${width}.json`), JSON.stringify(timings, null, 2));
  await info.attach('navigation-timings', {body:JSON.stringify(timings), contentType:'application/json'});
  await page.screenshot({path:path.join(output, `verified-navigation-${width}.png`)});
  expect(failures).toEqual([]);
});

for (const width of [390, 1440]) test(`Public reading, catalog, ranking and login at ${width}px`, async ({page, request}) => {
  await page.setViewportSize({width, height:900});
  await page.route('**/api/books/*/views', route => route.fulfill({json:{success:true, counted:false}}));
  await page.route('**/api/chapters/*/read', route => route.fulfill({json:{success:true, counted:false}}));
  await page.route('**/api/traffic/observe', route => route.fulfill({status:204}));
  await page.addInitScript(() => localStorage.setItem('has-seen-reading-hint', 'true'));
  const failures: string[] = [];
  page.on('response', r => {if (r.url().startsWith(base) && (r.status() >= 500 || r.status() === 429)) failures.push(`${r.status()} ${new URL(r.url()).pathname}`);});
  const booksResponse = await request.get(base+'/api/books?limit=1');
  expect(booksResponse.status()).toBe(200);
  expect(Boolean(booksResponse.headers()['cf-ray'])).toBe(expectProxy);
  const [book] = await booksResponse.json();
  const bookId = book.id || book._id;
  const chaptersResponse = await request.get(`${base}/api/books/${bookId}/chapters?limit=2`);
  const chapters = await chaptersResponse.json();
  const first = chapters[0].id || chapters[0]._id;
  const second = chapters[1].id || chapters[1]._id;
  const response = await page.goto(`${base}/book/${bookId}/${first}`);
  expect(response?.status()).toBe(200);
  expect(Boolean(response?.headers()['cf-ray'])).toBe(expectProxy);
  const reader = page.locator('.reader-pages-root:visible');
  await expect(reader).toHaveAttribute('data-reader-ready', 'true', {timeout:30000});
  await expect(reader).toHaveAttribute('data-reader-chapter', first);
  await page.keyboard.press('Control+ArrowRight');
  await expect(reader).toHaveAttribute('data-reader-chapter', second, {timeout:20000});
  await expect(reader).toHaveAttribute('data-reader-ready', 'true');
  await fs.mkdir(output, {recursive:true});
  await page.screenshot({path:path.join(output,`verified-reader-${width}.png`)});
  expect((await page.goto(`${base}/book/${bookId}`))?.status()).toBe(200);
  const catalog = page.getByRole('region', {name:'章节目录', exact:true});
  await expect(catalog).toHaveAttribute('aria-busy', 'false', {timeout:8000});
  await catalog.getByRole('button', {name:width < 768 ? /^目录/ : /查看完整目录/}).click();
  const dialog = page.getByRole('dialog', {name:'全部目录'});
  await expect(dialog.getByRole('region', {name:'阅读目录'})).toHaveAttribute('aria-busy', 'false', {timeout:8000});
  await expect(dialog.locator(`a[href="/book/${bookId}/${first}"]`)).toBeVisible();
  expect((await page.goto(base+'/ranking'))?.status()).toBe(200);
  await expect(page.locator('.ranking-row').first()).toBeVisible({timeout:8000});
  expect((await page.goto(base+'/login'))?.status()).toBe(200);
  await expect(page.locator('input[type="password"]')).toBeVisible();
  await page.screenshot({path:path.join(output,`verified-login-${width}.png`)});
  expect(failures).toEqual([]);
});
