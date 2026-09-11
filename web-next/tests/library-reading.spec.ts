import {test, expect, type Page} from '@playwright/test';

const base = 'http://127.0.0.1:3000';
const book = '000000000000000000000101', first = book, last = '000000000000000000000103';
const user = {id: '000000000000000000000001', username: '书架阅读验证', role: 'reader'};
async function shelf(page: Page, chapterId: string | null, firstChapterId: string | null = first) {
  await page.route('**/api/auth/session', route => route.fulfill({json: {user, profile: user}}));
  await page.route('**/api/users/*/history', route => route.fulfill({json: {success: true}}));
  await page.route('**/api/users/*/library?*', route => route.fulfill({json: [{bookId: book, book: {id: book, title: '山海行记', author: '隔离作者'}, chapterId, firstChapterId}]}));
  await page.goto(base + '/library');
  await expect(page.locator('.shelf-book')).toBeVisible();
}
test.beforeEach(async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.addInitScript(() => localStorage.setItem('has-seen-reading-hint', 'true'));
});

test('an unread shelf book opens the first chapter directly, with details still in the menu', async ({page}) => {
  await shelf(page, null);
  await expect(page.locator('.shelf-book')).toHaveAttribute('href', `/book/${book}/${first}`);
  await page.locator('.shelf-more-button').click();
  await expect(page.getByRole('menuitem', {name: '详情'})).toHaveAttribute('href', `/book/${book}`);
  await page.keyboard.press('Escape');
  await page.locator('.shelf-book').click();
  await expect(page.locator('.reader-pages-root:visible')).toHaveAttribute('data-reader-chapter', first);
  await expect(page.locator('.reader-pages-root:visible')).toHaveAttribute('data-reader-ready', 'true');
  await expect(page.locator('[data-reader-page]:visible')).toContainText(/^1\//);
});

for (const mode of ['horizontal', 'scroll']) {
  test(`server reading history resumes the saved chapter and position in ${mode} mode`, async ({page}) => {
    await page.addInitScript(({id, mode}) => {
      localStorage.setItem('reader_turnMode', JSON.stringify(mode));
      localStorage.setItem(`reader-page:${id}`, JSON.stringify({fraction: .45}));
    }, {id: last, mode});
    await shelf(page, last);
    await expect(page.locator('.shelf-book')).toHaveAttribute('href', `/book/${book}/${last}`);
    await page.locator('.shelf-book').click();
    await expect(page.locator('.reader-pages-root:visible')).toHaveAttribute('data-reader-chapter', last);
    await expect(page.locator('.reader-pages-root:visible')).toHaveAttribute('data-reader-ready', 'true');
    await expect(page.locator('[data-reader-page]:visible')).not.toContainText(/^1\//);
    expect(await page.evaluate(id => JSON.parse(localStorage.getItem(`reader-page:${id}`)!).fraction, last)).toBeGreaterThan(.25);
  });
}

test('the latest chapter on this device wins over a cached shelf response', async ({page}) => {
  await page.addInitScript(({book, last}) => localStorage.setItem('reader-recent-chapters:v1', JSON.stringify([[book, last]])), {book, last});
  await shelf(page, first);
  await expect(page.locator('.shelf-book')).toHaveAttribute('href', `/book/${book}/${last}`);
  await page.locator('.shelf-book').click();
  await expect(page.locator('.reader-pages-root:visible')).toHaveAttribute('data-reader-chapter', last);
});

test('books without readable chapters show a message and can still be managed', async ({page}) => {
  await shelf(page, null, null);
  await page.locator('.shelf-book').click();
  await expect(page).toHaveURL(base + '/library');
  await expect(page.getByRole('status')).toContainText('暂无可读章节');
  await page.getByRole('button', {name: '管理', exact: true}).click();
  await page.locator('.shelf-book').click();
  await expect(page.getByRole('checkbox')).toBeChecked();
});

for (const mode of ['horizontal', 'vertical', 'scroll']) {
  test(`shelf reader returns to the shelf after turns, overlays, reload and forward in ${mode} mode`, async ({page}) => {
    await page.addInitScript(mode => localStorage.setItem('reader_turnMode', JSON.stringify(mode)), mode);
    await shelf(page, null);
    const length = await page.evaluate(() => history.length);
    await page.locator('.shelf-book').click();
    const reader = page.locator('.reader-pages-root:visible');
    await expect(reader).toHaveAttribute('data-reader-ready', 'true');
    expect(await page.evaluate(() => history.length)).toBe(length + 1);
    await page.keyboard.press('Control+ArrowRight');
    await expect(reader).toHaveAttribute('data-reader-chapter', '000000000000000000000102');
    await page.keyboard.press('m');
    await page.locator('.reader-tools:visible').getByRole('button', {name: '目录', exact: true}).click();
    const dialog = page.getByRole('dialog', {name: '全部目录'});
    await expect(dialog).toBeVisible();
    await page.goBack(); await expect(dialog).not.toBeVisible();
    await page.keyboard.press('m');
    await page.locator('.reader-tools:visible').getByRole('button', {name: '目录', exact: true}).click();
    await dialog.getByRole('link', {name: '第3章 山间来信', exact: true}).click();
    await expect(reader).toHaveAttribute('data-reader-chapter', last);
    await page.reload();
    await expect(reader).toHaveAttribute('data-reader-ready', 'true');
    await page.goBack();
    await expect(page).toHaveURL(base + '/library');
    await expect(page.locator('.shelf-book')).toBeVisible();
    await expect(page.locator('html')).not.toHaveAttribute('data-book-transition', /.+/);
    await page.goForward();
    await expect(reader).toHaveAttribute('data-reader-chapter', last);
    await expect(reader).toHaveAttribute('data-reader-ready', 'true');
    await page.keyboard.press('m');
    await expect(page.locator('.reader-return:visible')).toHaveAttribute('href', '/library');
    await page.getByRole('link', {name: /^返回书架：/}).click();
    await expect(page).toHaveURL(base + '/library');
    await expect(page.locator('.shelf-book')).toBeVisible();
  });
}

test('opening shelf details before reading still returns to those details', async ({page}) => {
  await shelf(page, null);
  await page.locator('.shelf-more-button').click();
  await page.getByRole('menuitem', {name: '详情'}).click();
  await expect(page.locator('.book-detail')).toBeVisible();
  await page.getByRole('link', {name: '立即阅读', exact: true}).click();
  await expect(page.locator('.reader-pages-root:visible')).toHaveAttribute('data-reader-ready', 'true');
  await page.keyboard.press('m');
  await page.getByRole('link', {name: /^返回书籍详情：/}).click();
  await expect(page).toHaveURL(`${base}/book/${book}`);
  await expect(page.locator('.book-detail')).toBeVisible();
  await page.goBack(); await expect(page).toHaveURL(base + '/library');
});
