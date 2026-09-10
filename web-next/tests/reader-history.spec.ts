import {test, expect, type Page} from '@playwright/test';

const base = 'http://127.0.0.1:3000';
const book = '000000000000000000000101';
const first = '000000000000000000000101';
const second = '000000000000000000000102';
const detail = `${base}/book/${book}`;
const reader = `${detail}/${first}`;
const root = (page: Page) => page.locator('.reader-pages-root:visible');

test.beforeEach(async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.addInitScript(() => localStorage.setItem('has-seen-reading-hint', 'true'));
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
});

async function expectDetails(page: Page) {
  await expect(page).toHaveURL(detail);
  await expect(page.locator('.book-detail')).toBeVisible();
  await expect(root(page)).toHaveCount(0);
  await expect(page.locator('html')).not.toHaveAttribute('data-book-transition', /.+/);
}

test('direct entry, chapter changes, reload and forward all keep Back pointed at details', async ({page}) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(reader);
  await expect(root(page)).toHaveAttribute('data-reader-ready', 'true');
  const entries = await page.evaluate(() => history.length);
  await page.keyboard.press('Control+ArrowRight');
  await expect(page).toHaveURL(`${detail}/${second}`);
  await page.reload();
  await expect(root(page)).toHaveAttribute('data-reader-chapter', second);
  expect(await page.evaluate(() => history.length)).toBe(entries);
  await page.goBack();
  await expectDetails(page);
  await page.goForward();
  await expect(root(page)).toHaveAttribute('data-reader-chapter', second);
  expect(await page.evaluate(() => history.length)).toBe(entries);
  await page.goBack();
  await expectDetails(page);
  expect(errors).toEqual([]);
});

test('entering from details and using the return button does not create a back loop', async ({page}) => {
  await page.goto(base);
  await page.locator(`.mobile-home a[href="/book/${book}"]`).first().click();
  await expectDetails(page);
  const entries = await page.evaluate(() => history.length);
  await page.getByRole('link', {name: '立即阅读', exact: true}).click();
  await expect(root(page)).toHaveAttribute('data-reader-ready', 'true');
  await expect(page.locator('html')).not.toHaveAttribute('data-book-transition', /.+/);
  expect(await page.evaluate(() => history.length)).toBe(entries + 1);
  await page.keyboard.press('Control+ArrowRight');
  await expect(page).toHaveURL(`${detail}/${second}`);
  await page.keyboard.press('m');
  await page.locator('.reader-return:visible').click();
  await expectDetails(page);
  await page.getByRole('link', {name: '继续阅读', exact: true}).click();
  await expect(root(page)).toHaveAttribute('data-reader-chapter', second);
  await page.goBack();
  await expectDetails(page);
  await page.goBack();
  await expect(page).toHaveURL(`${base}/`);
  await page.goForward();
  await expectDetails(page);
});

for (const action of ['leave open', 'close', 'select chapter']) {
  test(`catalog ${action} does not consume the browser Back action`, async ({page}) => {
    await page.goto(reader);
    await expect(root(page)).toHaveAttribute('data-reader-ready', 'true');
    const entries = await page.evaluate(() => history.length);
    await page.keyboard.press('m');
    await page.locator('.reader-tools:visible').getByRole('button', {name: '目录', exact: true}).click();
    await expect(page.getByRole('heading', {name: '目录', exact: true})).toBeVisible();
    if (action === 'close') await page.getByRole('button', {name: '关闭目录'}).click();
    if (action === 'select chapter') {
      await page.getByRole('button', {name: '第2章 山间来信', exact: true}).click();
      await expect(page).toHaveURL(`${detail}/${second}`);
    }
    expect(await page.evaluate(() => history.length)).toBe(entries);
    await page.goBack();
    await expectDetails(page);
  });
}
