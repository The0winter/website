import {test, expect, type Page} from '@playwright/test';

const base = process.env.READER_PAGES_BASE || 'http://127.0.0.1:3000';
const book = '000000000000000000000101';
const detail = `${base}/book/${book}`, reader = `${detail}/${book}`;
const active = (page: Page) => page.evaluate(() => Boolean(document.fullscreenElement));
test.use({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true});

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem('reader_fullscreen', 'true');
    localStorage.setItem('has-seen-reading-hint', 'true');
    localStorage.setItem('reader_fullscreenHintDismissed', 'true');
    Object.defineProperty(navigator, 'connection', {value: {saveData: true, addEventListener() {}, removeEventListener() {}}});
  });
  await page.route('**/api/books/*/views', route => route.fulfill({json: {success: true, counted: false}}));
});

async function ready(page: Page) {
  await expect(page.locator('.reader-pages-root:visible')).toHaveAttribute('data-reader-ready', 'true');
  await expect(page.locator('.chapter-loading-page,.reader-fullscreen-cover')).toHaveCount(0);
}
async function detailsReady(page: Page) {
  await expect(page).toHaveURL(detail);
  await expect(page.locator('.book-detail')).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-book-transition', /.+/);
  expect(await active(page)).toBe(false);
}
async function shelfReady(page: Page) {
  await expect(page).toHaveURL(base + '/library');
  await expect(page.locator('#shelf-content .shelf-book')).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-book-transition', /.+/);
  expect(await active(page)).toBe(false);
}
async function enter(page: Page, shelf = false, waitForReader = true) {
  if (shelf) {
    const user = {id: '000000000000000000000001', username: '全屏返回验证', role: 'reader'};
    await page.route('**/api/auth/session', route => route.fulfill({json: {user, profile: user}}));
    await page.route('**/api/users/*/history', route => route.fulfill({json: {success: true}}));
    await page.route('**/api/users/*/library?*', route => route.fulfill({json: [{bookId: book, book: {id: book, title: '测试书籍', author: '作者'}, chapterId: book, firstChapterId: book}]}));
    await page.goto(base + '/library');
    await page.locator('#shelf-content .shelf-book').tap();
  } else {
    await page.goto(detail);
    await page.locator('.read-now:visible').tap();
  }
  if (waitForReader) {await ready(page); expect(await active(page)).toBe(true);}
}
// Desktop automation cannot dispatch Android's OS gesture. A native exit
// reproduces the resulting fullscreenchange without a history traversal.
const nativeBack = (page: Page) => page.evaluate(() => document.exitFullscreen());

for (const mode of ['horizontal', 'vertical', 'scroll']) {
  test(`native fullscreen Back returns to details and retains ${mode} progress`, async ({page}) => {
    await page.addInitScript(mode => localStorage.setItem('reader_turnMode', JSON.stringify(mode)), mode);
    await enter(page);
    const progress = page.locator('.reader-pages-root:visible .reader-progress span').first();
    if (mode === 'scroll') {
      await page.locator('.reader-text-window').evaluate(el => el.scrollTo({top: 1400, behavior: 'instant'}));
    } else await page.keyboard.press(mode === 'horizontal' ? 'ArrowRight' : 'ArrowDown');
    await expect(progress).not.toHaveText(/^1\//);
    const before = await progress.textContent();
    await nativeBack(page); await detailsReady(page);
    expect(await page.evaluate(() => localStorage.getItem('reader_fullscreen'))).not.toBe('false');
    await page.locator('.read-now:visible').tap(); await ready(page);
    expect(await active(page)).toBe(true);
    await expect(progress).toHaveText(before!);
    await nativeBack(page); await detailsReady(page);
    await page.goBack(); await expect(page).toHaveURL(base + '/');
  });
}

for (const shelf of [false, true]) {
  for (const overlay of ['none', '设置', '目录']) {
    test(`native fullscreen Back from ${shelf ? 'shelf' : 'details'} with ${overlay} restores its entry page`, async ({page}) => {
      await enter(page, shelf);
      if (overlay !== 'none') {
        await page.keyboard.press('m');
        await page.locator('.reader-tools').getByRole('button', {name: overlay, exact: true}).tap();
        await expect(page.getByRole('dialog', {name: overlay === '设置' ? '阅读设置' : '全部目录'})).toBeVisible();
      }
      await nativeBack(page);
      if (shelf) await shelfReady(page);
      else await detailsReady(page);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.goBack(); await expect(page).toHaveURL(base + '/');
    });
  }
}

for (const trigger of ['native', 'header', 'native-with-history']) {
  test(`shelf return via ${trigger} restores the cached shelf after chapter changes without a route request`, async ({page}, info) => {
    await enter(page, true);
    await page.keyboard.press('Control+ArrowRight');
    await expect(page.locator('.reader-pages-root:visible')).toHaveAttribute('data-reader-chapter', '000000000000000000000102');
    await ready(page);
    const requests: string[] = [];
    await page.route('**/*', route => {
      const request = route.request();
      if (request.isNavigationRequest() || new URL(request.url()).searchParams.has('_rsc')) {
        requests.push(request.url()); return route.abort();
      }
      return route.fallback();
    });
    const start = Date.now();
    if (trigger === 'header') await page.locator('.reader-return').tap();
    else if (trigger === 'native-with-history') await page.evaluate(async () => {await document.exitFullscreen(); history.back();});
    else await nativeBack(page);
    await shelfReady(page);
    await info.attach('cached-return', {body: JSON.stringify({milliseconds: Date.now() - start, requests}), contentType: 'application/json'});
    expect(requests).toEqual([]);
    await page.waitForTimeout(200);
    await expect(page).toHaveURL(base + '/library');
    await page.unroute('**/*');
    await page.locator('#shelf-content .shelf-book').tap();
    await ready(page);
    expect(await active(page)).toBe(true);
    await expect(page.locator('.reader-pages-root:visible')).toHaveAttribute('data-reader-chapter', '000000000000000000000102');
  });
}

test('a native exit and real history Back together do not skip details', async ({page}) => {
  await enter(page);
  await page.evaluate(async () => {await document.exitFullscreen(); history.back();});
  await detailsReady(page);
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(detail);
});

test('background fullscreen loss stays on the reader when the page becomes visible again', async ({page}) => {
  await enter(page);
  await page.evaluate(async () => {
    Object.defineProperty(document, 'hidden', {configurable: true, value: true});
    document.dispatchEvent(new Event('visibilitychange'));
    await document.exitFullscreen();
  });
  await expect.poll(() => active(page)).toBe(false);
  await page.waitForTimeout(150);
  await page.evaluate(() => {delete (document as unknown as {hidden?: boolean}).hidden; document.dispatchEvent(new Event('visibilitychange'));});
  await page.waitForTimeout(200);
  await expect(page).toHaveURL(reader); await ready(page);
});

test('native fullscreen Back also cancels a reader that is still loading', async ({page}) => {
  await page.goto(detail);
  const viewport = await page.locator('meta[name=viewport]').getAttribute('content');
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  await page.route(`**/book/${book}/${book}?_rsc=*`, async route => {await gate; await route.continue();});
  try {
    await page.locator('.read-now:visible').tap();
    await expect.poll(() => active(page)).toBe(true);
    await nativeBack(page); await detailsReady(page);
    await expect(page.locator('meta[name=viewport]')).toHaveAttribute('content', viewport!);
  } finally {release();}
  await expect(page.locator('.chapter-loading-page')).toHaveCount(0);
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(detail);
});

test('desktop native fullscreen exit keeps reading', async ({page}) => {
  await page.setViewportSize({width: 1440, height: 900});
  await page.goto(reader); await ready(page);
  await page.locator('aside').getByRole('button', {name: '全屏阅读'}).click();
  await expect.poll(() => active(page)).toBe(true);
  await nativeBack(page);
  await expect.poll(() => active(page)).toBe(false);
  await page.waitForTimeout(200);
  await expect(page).toHaveURL(reader); await ready(page);
});

test('native fullscreen Back cancels a slow shelf entry without visiting details', async ({page}) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  await page.route(`**/book/${book}/${book}?_rsc=*`, async route => {await gate; await route.continue();});
  try {
    await enter(page, true, false);
    await expect.poll(() => active(page)).toBe(true);
    await nativeBack(page); await shelfReady(page);
    await expect(page.locator('.chapter-loading-page')).toHaveCount(0);
  } finally {release();}
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(base + '/library');
});
