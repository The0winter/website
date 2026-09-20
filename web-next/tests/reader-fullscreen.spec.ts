import {test, expect, type Page} from '@playwright/test';

const base = process.env.READER_PAGES_BASE || 'http://127.0.0.1:3000';
const book = '000000000000000000000101';
const readerUrl = `${base}/book/${book}/${book}`;
const tools = (page: Page) => page.locator('.reader-tools');
const surface = (page: Page) => page.locator('.reader-pages-root:visible');
const isFullscreen = (page: Page) => page.evaluate(() => Boolean(document.fullscreenElement));

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem('has-seen-reading-hint', 'true');
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = 'nextjs-portal{display:none!important}';
      document.head.append(style);
    });
  });
  await page.route('**/api/books/*/views', route => route.fulfill({json: {success: true, counted: false}}));
});

async function openTools(page: Page) {
  if (await tools(page).getAttribute('aria-hidden') === 'true') await page.keyboard.press('m');
  await expect(tools(page)).toHaveAttribute('aria-hidden', 'false');
}

for (const mode of ['horizontal', 'vertical', 'scroll']) {
  test(`fullscreen survives ${mode} reading, menus and chapter changes`, async ({page}) => {
    await page.setViewportSize({width: 390, height: 844});
    await page.addInitScript(mode => localStorage.setItem('reader_turnMode', JSON.stringify(mode)), mode);
    await page.goto(readerUrl);
    await expect(surface(page)).toHaveAttribute('data-reader-ready', 'true');
    await openTools(page);
    await tools(page).getByRole('button', {name: '全屏阅读'}).click();
    await expect.poll(() => isFullscreen(page)).toBe(true);
    await expect(tools(page)).toHaveAttribute('aria-hidden', 'true');
    expect(await page.evaluate(() => document.fullscreenElement === document.documentElement)).toBe(true);

    if (mode === 'scroll') {
      await surface(page).locator('.reader-text-window').evaluate(el => el.scrollTo({top: 700, behavior: 'instant'}));
      await expect.poll(() => surface(page).locator('.reader-text-window').evaluate(el => el.scrollTop)).toBe(700);
    } else {
      await page.keyboard.press(mode === 'horizontal' ? 'ArrowRight' : 'ArrowDown');
      await expect(surface(page).locator('.reader-progress span').first()).toHaveText(/^2\//);
    }
    await openTools(page);
    await tools(page).getByRole('button', {name: '设置', exact: true}).click();
    await expect(page.getByRole('dialog', {name: '阅读设置'})).toBeVisible();
    await page.getByRole('button', {name: '关闭阅读设置'}).click();
    expect(await isFullscreen(page)).toBe(true);
    await tools(page).getByRole('button', {name: '目录', exact: true}).click();
    const catalog = page.getByRole('dialog', {name: '全部目录'});
    await expect(catalog).toBeVisible();
    const next = '000000000000000000000102';
    await catalog.locator(`a[href="/book/${book}/${next}"]`).click();
    await expect(surface(page)).toHaveAttribute('data-reader-chapter', next);
    await expect(catalog).toHaveCount(0);
    await expect(page.locator('.reader-entry-content')).toHaveAttribute('data-entry-pending', 'false');
    await expect(page.locator('.chapter-entry-snapshot')).toHaveCount(0);
    await expect(page.locator('.chapter-loading-sheet')).toHaveCount(0);
    expect(await isFullscreen(page)).toBe(true);
    await openTools(page);
    await expect(tools(page).getByRole('button', {name: '退出全屏'})).toHaveAttribute('aria-pressed', 'true');
    await tools(page).getByRole('button', {name: '退出全屏'}).click();
    await expect.poll(() => isFullscreen(page)).toBe(false);
    await expect(tools(page).getByRole('button', {name: '全屏阅读'})).toHaveAttribute('aria-pressed', 'false');

    // A browser/system exit must update the controls and never force reentry.
    await tools(page).getByRole('button', {name: '全屏阅读'}).click();
    await expect.poll(() => isFullscreen(page)).toBe(true);
    await page.evaluate(() => document.exitFullscreen());
    await openTools(page);
    await expect(tools(page).getByRole('button', {name: '全屏阅读'})).toHaveAttribute('aria-pressed', 'false');
    await tools(page).getByRole('button', {name: '全屏阅读'}).click();
    await expect.poll(() => isFullscreen(page)).toBe(true);
    await openTools(page);
    await page.locator('.reader-return:visible').click();
    await expect(page).toHaveURL(`${base}/book/${book}`);
    await expect.poll(() => isFullscreen(page)).toBe(false);
  });
}

test('fullscreen rejection is recoverable and unsupported browsers keep reading tools', async ({page}) => {
  await page.setViewportSize({width: 320, height: 740});
  await page.goto(readerUrl);
  await expect(surface(page)).toHaveAttribute('data-reader-ready', 'true');
  await openTools(page);
  await page.evaluate(() => {
    const original = Element.prototype.requestFullscreen;
    Element.prototype.requestFullscreen = function(options) {
      Element.prototype.requestFullscreen = original;
      return Promise.reject(new TypeError(String(options?.navigationUI)));
    };
  });
  await tools(page).getByRole('button', {name: '全屏阅读'}).click();
  await expect(page.locator('.reader-navigation-error')).toContainText('未能切换全屏');
  await expect(tools(page).getByRole('button', {name: '全屏阅读'})).toBeEnabled();
  expect(await isFullscreen(page)).toBe(false);
  await tools(page).getByRole('button', {name: '全屏阅读'}).click();
  await expect.poll(() => isFullscreen(page)).toBe(true);
  await expect(page.locator('.reader-navigation-error')).toHaveCount(0);
  await page.reload();
  await expect.poll(() => isFullscreen(page)).toBe(false);
  await page.evaluate(() => Object.defineProperty(document, 'fullscreenEnabled', {value: false, configurable: true}));
  await page.evaluate(() => document.dispatchEvent(new Event('fullscreenchange')));
  await openTools(page);
  await expect(tools(page).getByRole('button', {name: '全屏阅读'})).toHaveCount(0);
  await expect(tools(page).getByRole('button', {name: '设置', exact: true})).toBeVisible();
});

test('desktop fullscreen has a discoverable side control', async ({page}) => {
  await page.setViewportSize({width: 1440, height: 900});
  await page.goto(readerUrl);
  await expect(surface(page)).toHaveAttribute('data-reader-ready', 'true');
  const sidebar = page.locator('aside');
  await sidebar.getByRole('button', {name: '全屏阅读'}).click();
  await expect.poll(() => isFullscreen(page)).toBe(true);
  await expect(sidebar.getByRole('button', {name: '退出全屏'})).toBeVisible();
  await sidebar.getByRole('button', {name: '退出全屏'}).click();
  await expect.poll(() => isFullscreen(page)).toBe(false);
});

test('a failed chapter keeps its recovery controls accessible in fullscreen', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  const unavailable = '00000000000000000000010c';
  await page.route(`**/api/chapters/${unavailable}?navigation=1`, route => route.fulfill({status: 503, json: {message: '测试章节暂时不可用'}}));
  await page.goto(readerUrl);
  await expect(surface(page)).toHaveAttribute('data-reader-ready', 'true');
  await openTools(page);
  await tools(page).getByRole('button', {name: '全屏阅读'}).click();
  await expect(tools(page)).toHaveAttribute('aria-hidden', 'true');
  await openTools(page);
  await tools(page).getByRole('button', {name: '目录', exact: true}).click();
  await page.getByRole('dialog', {name: '全部目录'}).locator(`a[href="/book/${book}/${unavailable}"]`).click();
  const error = page.locator('.chapter-loading-page');
  await expect(error).toHaveAttribute('aria-busy', 'false');
  expect(await isFullscreen(page)).toBe(true);
  const retry = error.getByRole('button', {name: '重试'});
  await expect(retry).toBeVisible();
  expect(await retry.evaluate(el => {
    const box = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  })).toBe(true);
  await page.evaluate(() => document.exitFullscreen());
  await expect.poll(() => isFullscreen(page)).toBe(false);
});
