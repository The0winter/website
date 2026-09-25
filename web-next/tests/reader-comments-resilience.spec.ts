import {test, expect} from './fixtures/without-analytics';
import type {Page} from '@playwright/test';

const base = process.env.READER_COMMENTS_BASE || 'http://127.0.0.1:3000';
const book = process.env.READER_COMMENTS_BOOK || '000000000000000000000101';
let chapter = process.env.READER_COMMENTS_CHAPTER || book;
const reader = (page: Page) => page.locator('.reader-pages-root:visible');
const countsUrl = /\/api\/chapters\/[^/]+\/paragraph-comments$/;
const discussionUrl = /\/api\/chapters\/[^/]+\/paragraph-comments\/[^/?]+(?:\?.*)?$/;

test.beforeAll(async ({request}) => {
  if (process.env.READER_COMMENTS_BOOK && !process.env.READER_COMMENTS_CHAPTER) {
    const response = await request.get(`${base}/api/books/${book}/chapters?limit=1`);
    expect(response.ok()).toBe(true); chapter = (await response.json())[0].id;
  }
});
test.beforeEach(async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('has-seen-reading-hint', 'true'));
  await page.route('**/api/books/*/views', route => route.fulfill({json: {success: true, counted: false}}));
  await page.route('**/api/traffic/observe', route => route.fulfill({json: {}}));
});
async function enter(page: Page, mode = 'horizontal') {
  await page.addInitScript(mode => localStorage.setItem('reader_turnMode', JSON.stringify(mode)), mode);
  await page.goto(`${base}/book/${book}/${chapter}`);
  await expect(reader(page)).toHaveAttribute('data-reader-ready', 'true');
}
async function openDiscussion(page: Page) {
  await reader(page).locator('.reader-paragraph').first().click({button: 'right', position: {x: 25, y: 12}});
  await page.getByRole('menuitem', {name: '评论', exact: true}).click();
  await expect(page.getByRole('dialog', {name: /段落评论/})).toBeVisible();
}
async function continueReading(page: Page, mode: string) {
  if (mode === 'scroll') {
    const viewport = page.locator('.reader-scroll-window');
    const before = await viewport.evaluate(element => element.scrollTop);
    await viewport.hover(); await page.mouse.wheel(0, 350);
    await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBeGreaterThan(before);
  } else {
    const number = reader(page).locator('.reader-page-window > .reader-page-surface [data-reader-page]');
    const before = await number.innerText();
    await page.keyboard.press(mode === 'vertical' ? 'ArrowDown' : 'ArrowRight');
    await expect(number).not.toHaveText(before);
  }
}

for (const width of [390, 1440]) {
  test.describe(`${width}px`, () => {
    test.use({viewport: {width, height: 844}, hasTouch: width === 390, isMobile: width === 390});
    for (const mode of ['horizontal', 'vertical', 'scroll']) {
      test(`background counts fail quietly and recover without reopening in ${mode}`, async ({page}, info) => {
        let healthy = false, calls = 0, key = '';
        const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
        await page.route(countsUrl, route => {
          if (new URL(route.request().url()).pathname === `/api/chapters/${chapter}/paragraph-comments`) calls++;
          return route.fulfill(healthy ? {json: {counts: {[key]: 2}}} : mode === 'vertical' ? {json: {counts: null}} : {status: 502, body: 'Bad gateway'});
        });
        await enter(page, mode);
        await expect.poll(() => calls).toBeGreaterThan(0);
        await expect(page.getByText(/段评.*(?:不可用|继续阅读)/)).toHaveCount(0);
        key = (await reader(page).locator('.reader-paragraph').first().getAttribute('data-paragraph-key'))!;
        healthy = true;
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        await expect(reader(page).getByRole('button', {name: '2条段落评论'}).first()).toBeVisible();
        const loaded = calls;
        await page.evaluate(() => {for (let i = 0; i < 5; i++) window.dispatchEvent(new Event('focus'));});
        await page.waitForTimeout(100);
        expect(calls).toBe(loaded); // Focus does not discard fresh cached counts.
        await continueReading(page, mode);
        await expect(page.locator('.paragraph-sheet-backdrop')).toHaveCount(0);
        expect(errors).toEqual([]);
        await page.screenshot({path: info.outputPath('verified-reading.png')});
      });
      test(`discussion errors retry and close while reading continues in ${mode}`, async ({page}) => {
        let failing = true;
        await page.route(countsUrl, route => route.fulfill({json: {counts: {}}}));
        await page.route(discussionUrl, route => failing ? route.fulfill({status: 503, body: '<h1>Unavailable</h1>'}) : route.fulfill({json: {items: [], total: 0}}));
        await enter(page, mode); await openDiscussion(page);
        await expect(page.locator('.paragraph-sheet').getByRole('alert')).toContainText('段评暂不可用');
        await page.getByRole('button', {name: '关闭段落评论'}).click();
        await expect(page.getByRole('dialog', {name: /段落评论/})).toHaveCount(0);
        await openDiscussion(page);
        await expect(page.locator('.paragraph-sheet').getByRole('alert')).toBeVisible();
        failing = false;
        await page.getByRole('button', {name: '重试', exact: true}).click();
        await expect(page.getByText('还没有评论，来说说你的看法吧')).toBeVisible();
        await expect(page.locator('.paragraph-sheet').getByRole('alert')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(page.locator('.paragraph-sheet-backdrop')).toHaveCount(0);
        await continueReading(page, mode);
      });
    }
    test('a stalled discussion times out and remains dismissible before and after timeout', async ({page}) => {
      await page.route(countsUrl, route => route.fulfill({json: {counts: {}}}));
      await page.route(discussionUrl, () => {}); // Leave the transport pending.
      await enter(page); await openDiscussion(page);
      await expect(page.getByText('正在加载评论…')).toBeVisible();
      await page.getByRole('button', {name: '关闭段落评论'}).click();
      await expect(page.locator('.paragraph-sheet-backdrop')).toHaveCount(0);
      await openDiscussion(page);
      await expect(page.locator('.paragraph-sheet').getByRole('alert')).toContainText('段评加载超时', {timeout: 14000});
      await expect(page.getByText('正在加载评论…')).toHaveCount(0);
      await page.getByRole('button', {name: '关闭段落评论'}).click();
      await continueReading(page, 'horizontal');
    });
  });
}
