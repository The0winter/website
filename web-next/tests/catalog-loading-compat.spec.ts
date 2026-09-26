import type {Locator} from '@playwright/test';
import {test, expect} from './fixtures/without-analytics';

const base = process.env.COMPAT_BASE || 'http://127.0.0.1:3000';
const book = process.env.COMPAT_BOOK || '000000000000000000000101';
const detail = `${base}/book/${book}`;

test.beforeEach(async ({context}, info) => {
  await context.addInitScript(legacy => {
    if (legacy) {
      for (const key of ['any', 'timeout']) Object.defineProperty(AbortSignal, key, {value: undefined, configurable: true});
      Object.defineProperty(AbortSignal.prototype, 'throwIfAborted', {value: undefined, configurable: true});
    }
    Object.defineProperty(navigator, 'connection', {value: {saveData: true, addEventListener() {}, removeEventListener() {}}});
    localStorage.setItem('has-seen-reading-hint', 'true');
  }, info.project.name === 'Quark-capabilities');
  await context.route('**/traffic-observer.js', route => route.abort());
  await context.route('**/api/traffic/observe', route => route.fulfill({status: 204}));
  await context.route('**/api/books/*/views', route => route.fulfill({json: {counted: false}}));
});

async function singleLine(text: Locator) {
  await expect(text).toBeVisible();
  const boxes = await text.evaluate(element => {
    const label = element.firstElementChild!;
    const range = document.createRange(); range.selectNodeContents(label);
    return {display: getComputedStyle(element).display, padding: getComputedStyle(element).padding, lines: [...range.getClientRects()].map(rect => Math.round(rect.y)), text: label.getBoundingClientRect().toJSON(),
      dots: element.lastElementChild!.getBoundingClientRect().toJSON(), container: element.getBoundingClientRect().toJSON()};
  });
  expect(new Set(boxes.lines).size, JSON.stringify(boxes)).toBe(1);
  expect(boxes.dots.x).toBeGreaterThanOrEqual(boxes.text.right - 1);
  expect(boxes.container.width).toBeGreaterThanOrEqual(boxes.text.width + boxes.dots.width);
}

test('catalog loads, retries and opens chapters without recent AbortSignal methods', async ({page}, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  let fail = true, reads = 0;
  await page.route(`**/api/books/${book}/catalog*`, async route => {
    reads++;
    if (fail) return route.fulfill({status: 503, json: {error: 'temporary test failure'}});
    await route.continue();
  });
  await page.goto(detail);
  await page.locator('.mobile-catalog').click();
  const sheet = page.getByRole('dialog', {name: '全部目录'});
  await expect(sheet.getByRole('button', {name: '重试', exact: true})).toBeVisible();
  expect(reads).toBeGreaterThan(0);
  fail = false;
  await sheet.getByRole('button', {name: '重试', exact: true}).click();
  await expect(sheet.locator('.book-catalog-chapter').first()).toBeVisible();
  await expect(sheet.getByRole('alert')).toHaveCount(0);
  await page.screenshot({path: info.outputPath('verified-catalog.png')});
  await sheet.locator('.book-catalog-chapter').first().click();
  // Allow the request deadline and rendering when the public chapter is cold.
  await expect(page.locator('.reader-pages-root:visible')).toHaveAttribute('data-reader-ready', 'true', {timeout: 20000});
  await expect(page.locator('.chapter-loading-page')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('book and chapter loading messages keep the Chrome single-line layout', async ({page}, info) => {
  await page.goto(base);
  // Carousel clones have layout boxes but are deliberately hidden from users.
  const link = page.locator('.mobile-home a[href^="/book/"]:not([aria-hidden="true"]):visible').first();
  await link.focus();
  const href = await link.getAttribute('href');
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  await page.route(`**${href}?_rsc=*`, async route => {await gate; await route.continue();});
  try {
    await link.click();
    await expect.poll(() => page.locator('.book-navigation-loading').evaluate(element => Math.round(element.getBoundingClientRect().x))).toBe(0);
    await singleLine(page.locator('.book-navigation-loading .loading-text'));
    await page.screenshot({path: info.outputPath('verified-book-loading.png')});
  } finally {release();}
  await expect(page.locator('.book-detail')).toBeVisible();
  await expect(page.locator('.book-navigation-loading')).toHaveCount(0);
  const hold = await page.addStyleTag({content: '.reader-entry-content {transform:translateX(100vw)!important}'});
  await page.locator('.read-now:visible').click();
  try {
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({width, height: 844});
      await singleLine(page.locator('.chapter-loading-message .loading-text'));
      await page.screenshot({path: info.outputPath(`verified-chapter-loading-${width}.png`)});
    }
  } finally {await hold.evaluate(element => (element as HTMLElement).remove());}
  await expect(page.locator('.chapter-loading-page')).toHaveCount(0);
});

test('account, writer and review loading use the same single-line text', async ({context}, info) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  await context.route('**/api/auth/session', async route => {await gate; await route.continue();});
  await context.route(`**/api/books/${book}/reviews?*`, async route => {await gate; await route.continue();});
  try {
    for (const [path, selector] of [['/profile', '.account-loading'], ['/writer', '.writer-page'], [`/book/${book}`, '.book-review-loading']]) {
      // Each stalled session belongs to its own page; leaving it must not race
      // an unauthenticated redirect against the next loading-state check.
      const page = await context.newPage();
      try {
        await page.goto(base + path);
        for (const width of [320, 390]) {
          await page.setViewportSize({width, height: 844});
          await singleLine(page.locator(`${selector} .loading-text`).first());
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        }
        await page.screenshot({path: info.outputPath(`verified-${selector.slice(1)}.png`)});
      } finally {await page.close();}
    }
  } finally {release();}
});
