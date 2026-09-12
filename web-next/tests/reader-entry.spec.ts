import {test, expect, type Page} from '@playwright/test';

const base = 'http://127.0.0.1:3000', book = '000000000000000000000101';
const first = book, second = '000000000000000000000102', last = '00000000000000000000010c';
const detail = `${base}/book/${book}`, reader = `${detail}/${first}`;
const root = (page: Page) => page.locator('.reader-pages-root:visible');
const loader = (page: Page) => page.locator('.chapter-loading-page');
const dialog = (page: Page) => page.getByRole('dialog', {name: '全部目录'});

test.use({viewport: {width: 390, height: 844}, hasTouch: true});
test.setTimeout(40000);
test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {
    window.addEventListener('DOMContentLoaded', () => {const style = document.createElement('style'); style.textContent = 'nextjs-portal{display:none!important}'; document.head.append(style);});
    localStorage.setItem('reader_turnMode', JSON.stringify('scroll'));
    localStorage.setItem('has-seen-reading-hint', 'true');
    Object.defineProperty(navigator, 'connection', {value: {saveData: true, addEventListener() {}, removeEventListener() {}}});
  });
  await page.route('**/api/books/*/views', route => route.fulfill({json: {success: true, counted: false}}));
});
async function openCatalog(page: Page) {
  await page.keyboard.press('m');
  await page.locator('.reader-tools:visible').getByRole('button', {name: '目录', exact: true}).click();
  await expect(dialog(page)).toBeVisible();
}
async function chapterStart(page: Page, id: string) {
  await expect(root(page)).toHaveAttribute('data-reader-chapter', id);
  await expect(root(page)).toHaveAttribute('data-reader-ready', 'true');
  await expect(loader(page)).toHaveCount(0);
  const heading = root(page).locator(`[data-scroll-chapter="${id}"] h1`);
  await expect(heading).toBeVisible();
  await expect.poll(() => heading.evaluate(el => Math.abs(el.getBoundingClientRect().top - el.closest('.reader-scroll-window')!.getBoundingClientRect().top - parseFloat(getComputedStyle(el).marginTop)))).toBeLessThan(2);
}
async function enterCatalog(page: Page, origin: string) {
  await page.goto(origin === 'details' ? detail : reader);
  if (origin === 'details') await page.getByRole('button', {name: /^目录 /}).click();
  else {await expect(root(page)).toHaveAttribute('data-reader-ready', 'true'); await openCatalog(page);}
}
const requestPattern = (origin: string) => origin === 'details' ? `**/book/${book}/${last}?_rsc=*` : `**/api/chapters/${last}?navigation=1`;

for (const origin of ['details', 'reader']) {
  test(`${origin} catalog keeps its entry screen and ignores gestures until the selected chapter is ready`, async ({page, context}) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await enterCatalog(page, origin);
    let release!: () => void; const gate = new Promise<void>(resolve => {release = resolve;});
    await page.route(requestPattern(origin), async route => {await gate; await route.continue();});
    try {
      await dialog(page).getByRole('link', {name: '第12章 山间来信', exact: true}).click();
      await expect(loader(page)).toHaveAttribute('data-chapter-loading', last);
      await expect(loader(page).getByRole('status')).toHaveText('第12章 山间来信正在加载');
      await expect(loader(page)).toHaveAttribute('data-loading-visible', 'true');
      await expect.poll(() => page.evaluate(() => Boolean(document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest('.chapter-loading-page')))).toBe(true);
      await page.mouse.wheel(0, 1600); await page.keyboard.press('PageDown');
      // Even a queued scroll event from the old viewport cannot win over the selection.
      if (origin === 'reader') await page.locator('.reader-scroll-window').evaluate(el => {el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event('scroll'));});
      const cdp = await context.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: 180, y: 650, id: 1}]});
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: 180, y: 460, id: 1}]});
      await page.screenshot({path: `../artifacts/chapter-entry-${origin}-loading.png`});
      release();
      await expect(root(page)).toHaveAttribute('data-reader-chapter', last);
      await expect(root(page)).toHaveAttribute('data-reader-ready', 'true');
      await expect(loader(page)).toBeVisible();
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: 180, y: 250, id: 1}]});
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
      await chapterStart(page, last);
      await page.screenshot({path: `../artifacts/chapter-entry-${origin}-ready.png`});
      await page.goBack(); await expect(page).toHaveURL(detail);
      await expect(page.locator('.book-detail:visible')).toBeVisible(); expect(errors).toEqual([]);
    } finally {release();}
  });
  test(`Back cancels a delayed ${origin} catalog selection without a late jump`, async ({page}) => {
    await enterCatalog(page, origin);
    let release!: () => void; const gate = new Promise<void>(resolve => {release = resolve;});
    await page.route(requestPattern(origin), async route => {await gate; await route.continue();});
    try {
      await dialog(page).getByRole('link', {name: '第12章 山间来信', exact: true}).click(); await expect(loader(page)).toBeVisible();
      await page.goBack(); await expect(loader(page)).toHaveCount(0); await expect(page).toHaveURL(detail);
      release(); await page.waitForTimeout(500); await expect(page).toHaveURL(detail);
      await expect(page.locator('.book-detail:visible')).toBeVisible();
    } finally {release();}
  });
}

test('cached and current chapter selections restart at the title and clear old scroll momentum', async ({page}) => {
  await page.goto(reader); await expect(root(page)).toHaveAttribute('data-reader-ready', 'true');
  // Demand the adjacent chapter even with data saving enabled.
  await page.locator('.reader-scroll-window').evaluate(el => {el.scrollTop = el.scrollHeight - el.clientHeight - 400;});
  await expect(root(page)).toHaveAttribute('data-reader-next', second);
  await page.evaluate(() => {
    const seen: string[] = []; Object.assign(window, {entryScreens: seen});
    new MutationObserver(() => {const el = document.querySelector('.chapter-loading-page'); if (el) seen.push(el.textContent || '');}).observe(document.body, {subtree: true, childList: true});
  });
  const old = await page.locator('.reader-scroll-window').elementHandle();
  await openCatalog(page); await dialog(page).getByRole('link', {name: '第2章 山间来信', exact: true}).click();
  await chapterStart(page, second); expect(await old!.evaluate(el => el.isConnected)).toBe(false);
  await page.locator('.reader-scroll-window').evaluate(el => new Promise<void>(resolve => {
    el.addEventListener('scroll', () => requestAnimationFrame(() => requestAnimationFrame(() => resolve())), {once: true});
    el.scrollTop += 480;
  }));
  await openCatalog(page); await dialog(page).getByRole('link', {name: '第2章 山间来信', exact: true}).click();
  await chapterStart(page, second);
  expect(await page.evaluate(() => (window as unknown as {entryScreens: string[]}).entryScreens.some(text => text.includes('第2章 山间来信') && text.includes('正在加载')))).toBe(true);
});

test('a failed selection keeps its target and allows returning from the loading page', async ({page}) => {
  await enterCatalog(page, 'reader');
  await page.route(`**/api/chapters/${last}?navigation=1`, route => route.abort());
  await dialog(page).getByRole('link', {name: '第12章 山间来信', exact: true}).click();
  await expect(loader(page).getByRole('alert')).toContainText('第12章 山间来信');
  await expect(loader(page).getByRole('button', {name: '重试'})).toBeVisible();
  await loader(page).getByRole('button', {name: '返回'}).click();
  await expect(loader(page)).toHaveCount(0); await expect(page).toHaveURL(detail);
});

for (const [mode, width] of [['scroll', 390], ['horizontal', 390], ['vertical', 390], ['scroll', 1440]] as const) {
  test(`settings Back, Forward, refresh and close stay in the reader in ${mode} at ${width}px`, async ({page}) => {
    await page.setViewportSize({width, height: 844});
    await page.addInitScript(mode => localStorage.setItem('reader_turnMode', JSON.stringify(mode)), mode);
    await page.goto(reader); await expect(root(page)).toHaveAttribute('data-reader-ready', 'true');
    const settings = page.getByRole('dialog', {name: '阅读设置'});
    const initialPage = await root(page).locator('[data-reader-page]').innerText();
    await page.keyboard.press('m');
    for (let index = 0; index < 3; index++) {
      await page.locator('.reader-tools:visible').getByRole('button', {name: '设置', exact: true}).click();
      await expect(settings).toBeVisible();
      await expect(page.locator('.reader-tools')).toHaveAttribute('aria-hidden', 'false');
      await expect(page.locator('.reader-status-top')).toHaveAttribute('data-open', 'true');
      await page.goBack();
      await expect(settings).toHaveCount(0); await expect(page).toHaveURL(reader);
      await expect(page.locator('.reader-tools')).toHaveAttribute('aria-hidden', 'false');
      await expect(root(page).locator('[data-reader-page]')).toHaveText(initialPage);
    }
    await page.goForward(); await expect(settings).toBeVisible();
    const length = await page.evaluate(() => history.length);
    await page.reload(); await expect(settings).toBeVisible(); expect(await page.evaluate(() => history.length)).toBe(length);
    await settings.getByRole('button', {name: '上下滚屏', exact: true}).click();
    await settings.getByRole('button', {name: '关闭阅读设置'}).click(); await expect(settings).toHaveCount(0);
    await expect(root(page)).toHaveAttribute('data-mode', 'scroll'); await expect(page).toHaveURL(reader);
    await page.goBack(); await expect(page).toHaveURL(detail);
  });
}
