import {test, expect} from '@playwright/test';

const base = 'http://127.0.0.1:3000', book = '000000000000000000000101';
const second = '000000000000000000000102';
test.use({viewport: {width: 390, height: 844}, hasTouch: true});
test.beforeEach(async ({page}) => {
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.route('**/api/books/*/views', route => route.fulfill({json: {success: true, counted: false}}));
  await page.addInitScript(() => localStorage.setItem('has-seen-reading-hint', 'true'));
});

for (const mode of ['horizontal', 'vertical', 'scroll']) test(`${mode}: reading retains progress without loading a catalog; clicks reuse the current version`, async ({page}) => {
  await page.addInitScript(value => localStorage.setItem('reader_turnMode', JSON.stringify(value)), mode);
  const catalogs: string[] = [], errors: string[] = [];
  page.on('request', request => {if (request.url().includes('/catalog')) catalogs.push(request.url());});
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/book/${book}/${book}`);
  const reader = page.locator('.reader-pages-root:visible');
  await expect(reader).toHaveAttribute('data-reader-ready', 'true');
  await expect(reader).toHaveAttribute('data-mode', mode);
  const progress = reader.locator('.reader-progress:visible').first();
  await expect(progress).toContainText('%');
  await page.clock.setSystemTime(new Date(Date.now() + 90_000));
  await page.keyboard.press('m');
  expect(catalogs).toHaveLength(0);
  await page.locator('.reader-tools:visible').getByRole('button', {name: '目录', exact: true}).click();
  const dialog = page.getByRole('dialog', {name: '全部目录'});
  await expect(dialog.getByRole('link', {name: '第2章 山间来信', exact: true})).toBeVisible();
  expect(catalogs.filter(url => !url.endsWith('/version'))).toHaveLength(1);
  await dialog.getByRole('link', {name: '第2章 山间来信', exact: true}).click();
  await expect(reader).toHaveAttribute('data-reader-chapter', second);
  await expect(reader).toHaveAttribute('data-reader-ready', 'true');
  await expect(page.locator('.chapter-loading-page')).toHaveCount(0);
  await expect(progress).toContainText('%');
  await page.clock.setSystemTime(new Date(Date.now() + 5 * 60_000));
  await page.keyboard.press('m');
  expect(catalogs.filter(url => !url.endsWith('/version'))).toHaveLength(1);
  await page.locator('.reader-tools:visible').getByRole('button', {name: '目录', exact: true}).click();
  await expect(dialog.locator('[aria-current="location"]')).toHaveAttribute('href', `/book/${book}/${second}`);
  await expect.poll(() => catalogs.filter(url => url.endsWith('/version')).length).toBeGreaterThan(0);
  expect(catalogs.filter(url => !url.endsWith('/version'))).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('book details keep chapter previews and defer the full catalog until clicked', async ({page}) => {
  const catalogs: string[] = [];
  page.on('request', request => {if (request.url().includes('/catalog')) catalogs.push(request.url());});
  await page.goto(`${base}/book/${book}`);
  await expect(page.locator('.book-detail:visible')).toBeVisible();
  expect(catalogs).toHaveLength(0);
  await page.getByRole('button', {name: /^目录 /}).click();
  await expect(page.getByRole('dialog', {name: '全部目录'}).getByRole('link', {name: '第1章 山间来信', exact: true})).toBeVisible();
  expect(catalogs.length).toBeGreaterThan(0);
});
