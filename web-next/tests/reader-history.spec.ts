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

for (const mode of ['horizontal', 'scroll', 'vertical']) {
  test(`reader catalog Back and selection preserve the current page in ${mode} mode`, async ({page}) => {
    await page.addInitScript(mode => localStorage.setItem('reader_turnMode', JSON.stringify(mode)), mode);
    await page.goto(reader);
    await expect(root(page)).toHaveAttribute('data-reader-ready', 'true');
    const open = async () => {
      await page.keyboard.press('m');
      await page.locator('.reader-tools:visible').getByRole('button', {name: '目录', exact: true}).click();
      await expect(page.getByRole('dialog', {name: '全部目录'})).toBeVisible();
    };
    const dialog = page.getByRole('dialog', {name: '全部目录'});
    for (let index = 0; index < 3; index++) {
      await open();
      await expect(dialog.locator('[aria-current="location"]')).toHaveAttribute('href', `/book/${book}/${first}`);
      await expect(dialog.locator('.book-catalog-list')).toHaveCSS('overscroll-behavior-x', 'auto');
      await page.goBack();
      await expect(dialog).not.toBeVisible();
      await expect(page).toHaveURL(reader);
      await expect(root(page)).toHaveAttribute('data-reader-chapter', first);
    }
    await page.goForward(); await expect(dialog).toBeVisible();
    const entries = await page.evaluate(() => history.length);
    await page.reload(); await expect(dialog).toBeVisible();
    expect(await page.evaluate(() => history.length)).toBe(entries);
    await dialog.getByRole('button', {name: '关闭目录'}).click(); await expect(dialog).not.toBeVisible();
    await open();
    await dialog.getByRole('link', {name: '第2章 山间来信', exact: true}).click();
    await expect(page).toHaveURL(`${detail}/${second}`); await expect(dialog).not.toBeVisible();
    await page.goForward(); await expect(dialog).toBeVisible(); await expect(page).toHaveURL(`${detail}/${second}`);
    await page.goBack(); await expect(dialog).not.toBeVisible(); await expect(page).toHaveURL(`${detail}/${second}`);
    await page.goBack(); await expectDetails(page);
    await page.goBack(); await expect(page).toHaveURL(`${base}/`);
  });
}

for (const width of [320, 390, 768, 1440]) {
  test(`detail and reader share catalog layout and ordering at ${width}px`, async ({page}) => {
    await page.setViewportSize({width, height: 844});
    await page.goto(detail);
    await page.getByRole('button', {name: width < 768 ? /^目录 连载/ : /^查看完整目录/}).click();
    const dialog = page.getByRole('dialog', {name: '全部目录'});
    await expect(dialog).toBeVisible();
    const snapshot = () => dialog.evaluate(el => {
      const sheet = el.getBoundingClientRect(), row = el.querySelector('.book-catalog-chapter:not([aria-current])')!;
      const css = getComputedStyle(row);
      return {width: Math.round(sheet.width * 1000) / 1000, height: Math.round(sheet.height * 1000) / 1000, font: css.font, padding: css.padding, radius: css.borderRadius,
        order: el.querySelector('.book-catalog-actions button')?.textContent};
    });
    await expect(dialog.locator('.book-catalog-chapter').first()).toBeVisible();
    const detailLayout = await snapshot();
    await dialog.getByRole('link', {name: '第12章 山间来信', exact: true}).click();
    await expect(root(page)).toHaveAttribute('data-reader-ready', 'true');
    await expect(page.locator('html')).not.toHaveAttribute('data-book-transition', /.+/);
    await page.keyboard.press('m');
    await page.locator('.reader-tools:visible').getByRole('button', {name: '目录', exact: true}).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.book-catalog-chapter').first()).toBeVisible();
    expect(await snapshot()).toEqual(detailLayout);
    await dialog.getByRole('button', {name: '倒序', exact: true}).click();
    await expect(dialog.getByRole('button', {name: '正序', exact: true})).toBeVisible();
    await expect(dialog.locator('[aria-current="location"]')).toBeVisible();
    await page.addStyleTag({content: 'nextjs-portal{display:none!important}'});
    await page.screenshot({path: `../artifacts/catalog-unified-${width}.png`});
    await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible();
    await page.goBack(); await expectDetails(page);
  });
}

test('a long catalog retries, stays virtualized, and locates the active chapter after sorting', async ({page}) => {
  const rows = Array.from({length: 1238}, (_, index) => ({
    id: index < 12 ? (0x101 + index).toString(16).padStart(24, '0') : (0x1000 + index).toString(16).padStart(24, '0'),
    bookId: book, title: `第${index + 1}章 目录验证`, chapter_number: index + 1,
  }));
  let failing = true;
  await page.route(`**/api/books/${book}/chapters*`, route => {
    const params = new URL(route.request().url()).searchParams;
    const number = Number(params.get('page') || 1), limit = Number(params.get('limit') || 200);
    if (failing && number > 1) return route.fulfill({status: 503, json: {error: 'controlled failure'}});
    return route.fulfill({headers: {'X-Total-Count': String(rows.length)}, json: rows.slice((number - 1) * limit, number * limit)});
  });
  await page.goto(reader); await expect(root(page)).toHaveAttribute('data-reader-ready', 'true');
  await page.keyboard.press('m');
  await page.locator('.reader-tools:visible').getByRole('button', {name: '目录', exact: true}).click();
  const dialog = page.getByRole('dialog', {name: '全部目录'});
  await expect(dialog.getByRole('alert')).toBeVisible();
  failing = false; await dialog.getByRole('button', {name: '重试'}).click();
  await expect(dialog.getByRole('region')).toHaveAttribute('aria-busy', 'false');
  await expect(dialog.locator('[aria-current="location"]')).toBeVisible();
  expect(await dialog.locator('.book-catalog-chapter').count()).toBeLessThan(60);
  await dialog.getByRole('button', {name: '倒序', exact: true}).click();
  await expect(dialog.locator('.book-catalog-chapter').first()).toHaveText('第1章 目录验证');
  await dialog.locator('.book-catalog-list').evaluate(el => {el.scrollTop = el.scrollHeight;});
  await expect(dialog.getByRole('link', {name: '第1238章 目录验证', exact: true})).toBeVisible();
  expect(await dialog.locator('.book-catalog-chapter').count()).toBeLessThan(60);
  await page.goBack(); await expect(dialog).not.toBeVisible(); await expect(page).toHaveURL(reader);
});
