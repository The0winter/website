import {test, expect, type Page} from '@playwright/test';

const base = process.env.MOBILE_SECTIONS_BASE || 'http://127.0.0.1:3100';
const user = {id: '000000000000000000000001', username: '浏览验证', role: 'reader'};
test.use({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'connection', {value: {saveData: true, addEventListener() {}, removeEventListener() {}}});
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function(init) {const shadow = attach.call(this, init); Object.assign(this, {testShadow: shadow}); return shadow;};
    document.addEventListener('DOMContentLoaded', () => {const style = document.createElement('style'); style.textContent = 'nextjs-portal{display:none}'; document.head.append(style);});
  });
  await page.route('**/api/auth/session', route => route.fulfill({json: {user, profile: user}}));
  await page.route('**/api/users/*/library?*', route => route.fulfill({json: Array.from({length: 20}, (_, i) => ({bookId: String(i + 1), book: {id: String(i + 1), title: `用于顶栏滚动验证的书籍 ${i + 1}`, author: '测试作者'}}))}));
  await page.route('**/api/forum/posts*', route => route.fulfill({json: Array.from({length: 20}, (_, i) => ({id: String(i + 1), title: `用于顶栏滚动验证的问题 ${i + 1}`, type: 'question'}))}));
});

async function ready(page: Page, path = '/') {
  await page.goto(base + path);
  await expect(page.locator('.mobile-account-initial:visible')).toHaveText('浏');
  await page.evaluate(() => document.fonts.ready);
}
async function idle(page: Page) {await expect(page.locator('.mobile-section-snapshot')).toHaveCount(0);}
async function tab(page: Page, section: string) {
  await idle(page);
  await page.locator(`.mh-bottom:visible [data-section=${section}]`).tap();
  await expect(page).toHaveURL(base + (section === 'home' ? '/' : '/' + section));
  await idle(page);
}
async function drag(page: Page, x: number, y: number, dx: number, beforeEnd?: () => Promise<void>) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y, id: 1}]});
  for (let i = 1; i <= 8; i++) {
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: x + dx * i / 8, y, id: 1}]});
    await page.waitForTimeout(20);
  }
  await beforeEnd?.();
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  await cdp.detach();
}

for (const width of [320, 390]) test(`${width}px ratings align with row titles and stay on shelf cover corners`, async ({page}, info) => {
  await page.setViewportSize({width, height: 844});
  await ready(page);
  const row = page.locator('.mh-book').first();
  await expect(row.locator('.mh-book-rating svg')).toBeVisible();
  await expect(row.locator('.mh-book-rating')).toHaveCSS('font-size', '14px');
  const aligned = await row.evaluate(element => {
    const title = element.querySelector('h3')!.getBoundingClientRect(), score = element.querySelector('.mh-book-rating')!.getBoundingClientRect();
    return Math.abs(title.y + title.height / 2 - score.y - score.height / 2);
  });
  expect(aligned).toBeLessThan(1);
  await expect(page.locator('.mh-section-rows').first()).toHaveCSS('padding-top', '16px');
  await page.screenshot({path: info.outputPath('verified-top.png')});
  const shelf = page.locator('.mh-shelf').first();
  await shelf.scrollIntoViewIfNeeded();
  const positions = await shelf.locator('.mh-shelf-book').evaluateAll(books => books.map(book => {
    const cover = book.querySelector('.mh-cover')!.getBoundingClientRect(), score = book.querySelector('.mh-book-rating')!.getBoundingClientRect(), title = book.querySelector('h3')!.getBoundingClientRect();
    return {inside: score.top >= cover.top && score.bottom <= cover.bottom && score.right <= cover.right, fullTitle: Math.abs(title.width - cover.width) < 1};
  }));
  expect(positions.every(position => position.inside && position.fullTitle)).toBe(true);
  await page.screenshot({path: info.outputPath('verified-shelf.png')});
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.screenshot({path: info.outputPath('verified-dark-shelf.png')});
});

for (const path of ['/', '/library', '/forum']) test(`${path} keeps its search header visible after vertical scrolling`, async ({page}, info) => {
  await ready(page, path);
  if (path === '/library') await expect(page.locator('.shelf-row:visible')).toHaveCount(20);
  if (path === '/forum') await expect(page.locator('.forum-mobile-feed article').first()).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 520));
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(480);
  const header = page.locator('.mh-topbar:visible');
  await expect.poll(() => header.evaluate(element => Math.abs(element.getBoundingClientRect().top))).toBeLessThan(1);
  await expect(header.locator('input')).toBeInViewport();
  expect(await header.locator('input').evaluate(element => {
    const box = element.getBoundingClientRect();
    return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === element;
  })).toBe(true);
  await page.screenshot({path: info.outputPath('verified-sticky-header.png')});
});

for (const index of [0, 2]) test(`section drag preserves carousel cover and dot ${index + 1} in its outgoing frame`, async ({page}, info) => {
  await ready(page);
  await page.emulateMedia({reducedMotion: 'reduce'});
  if (index) await page.locator('.mh-banner-dots button').nth(index).click();
  const rail = page.locator('.mh-banner-track');
  await expect.poll(() => rail.evaluate((element, index) => Math.abs(element.scrollLeft - element.clientWidth * (index + 1)), index)).toBeLessThan(2);
  await page.emulateMedia({reducedMotion: 'no-preference'});
  const expected = await page.locator('.mh-banner[aria-hidden=false]').getAttribute('aria-label');
  await drag(page, 300, 355, -150, async () => {
    await expect(page.locator('html')).toHaveAttribute('data-mobile-section-transition', 'dragging');
    const copy = await page.locator('[data-section-pane=outgoing]').evaluate(element => {
      const shadow = (element as HTMLElement & {testShadow: ShadowRoot}).testShadow;
      const rail = shadow.querySelector('.mh-banner-track')!, slide = shadow.querySelector('.mh-banner[aria-hidden=false]')!;
      return {label: slide.getAttribute('aria-label'), offset: slide.getBoundingClientRect().x - rail.getBoundingClientRect().x,
        dot: [...shadow.querySelectorAll('.mh-banner-dots button')].findIndex(button => button.getAttribute('aria-pressed') === 'true')};
    });
    expect(copy.label).toBe(expected);
    expect(copy.dot).toBe(index);
    expect(Math.abs(copy.offset)).toBeLessThan(2);
    await page.screenshot({path: info.outputPath('verified-drag-frame.png')});
  });
  await expect(page).toHaveURL(base + '/forum');
  await idle(page);
  await tab(page, 'home');
  await expect(page.locator('.mh-banner[aria-hidden=false]')).toHaveAttribute('aria-label', expected!);
});

test('manual carousel swipe starts a fresh six-second autoplay countdown', async ({page}) => {
  await ready(page);
  await page.waitForTimeout(2200);
  const bounds = (await page.locator('.mh-banner-track').boundingBox())!;
  await drag(page, 330, bounds.y + 65, -230);
  await expect(page.locator('.mh-banner-dots button').nth(1)).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(5000);
  await expect(page.locator('.mh-banner-dots button').nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.mh-banner-dots button').nth(2)).toHaveAttribute('aria-pressed', 'true', {timeout: 2200});
});

for (const method of ['tap', 'swipe']) test(`${method} returns Featured to its previous scroll position across main sections`, async ({page}, info) => {
  await ready(page);
  await page.locator('.mh-shelf').first().evaluate(element => {element.scrollLeft = 150;});
  await page.evaluate(() => window.scrollTo(0, 480));
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(480);
  if (method === 'tap') await tab(page, 'forum');
  else {
    await drag(page, 300, 400, -170);
    await expect(page).toHaveURL(base + '/forum');
    await idle(page);
  }
  await tab(page, 'library');
  await tab(page, 'home');
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(480);
  await page.screenshot({path: info.outputPath('verified-restored-home.png')});
  await expect.poll(() => page.locator('.mh-shelf').first().evaluate(element => element.scrollLeft)).toBe(150);
  await tab(page, 'forum');
  await page.goBack();
  await idle(page);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(480);
});

for (const minutes of [1, 6]) test(`returning after ${minutes} minutes in details ${minutes < 5 ? 'keeps' : 'expires'} Featured position`, async ({page}) => {
  await ready(page);
  const book = page.locator('.mh-book').nth(5);
  await book.scrollIntoViewIfNeeded();
  const top = await page.evaluate(() => scrollY);
  expect(top).toBeGreaterThan(200);
  await book.click();
  await expect(page.locator('.book-detail')).toBeVisible();
  await page.clock.setSystemTime((await page.evaluate(() => Date.now())) + minutes * 60 * 1000);
  await page.goBack();
  await expect(page.locator('.mobile-home:visible')).toBeVisible();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(minutes < 5 ? top : 0);
});

test('leaving the website clears Featured scroll even when browser Back restores the document', async ({page}) => {
  const outside = 'https://outside.example.test/';
  await page.route(outside, route => route.fulfill({contentType: 'text/html', body: '<p>Outside</p>'}));
  await ready(page);
  await page.evaluate(() => window.scrollTo(0, 480));
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(480);
  await page.goto(outside);
  await page.goBack();
  await expect(page.locator('.mobile-home:visible')).toBeVisible();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
});

for (const minutes of [1, 6]) test(`returning after ${minutes} minutes in the reader ${minutes < 5 ? 'keeps' : 'expires'} Featured position`, async ({page}) => {
  await ready(page);
  const book = page.locator('.mh-book').nth(5);
  await book.scrollIntoViewIfNeeded();
  const top = await page.evaluate(() => scrollY);
  await book.click();
  await expect(page.locator('.book-detail:visible')).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-book-transition', /.+/);
  await page.getByRole('link', {name: '立即阅读', exact: true}).click();
  await expect(page.locator('.reader-pages-root:visible')).toHaveAttribute('data-reader-ready', 'true');
  await expect(page.locator('html')).not.toHaveAttribute('data-book-transition', /.+/);
  await page.clock.setSystemTime((await page.evaluate(() => Date.now())) + minutes * 60 * 1000);
  await page.goBack();
  await expect(page.locator('.book-detail:visible')).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-book-transition', /.+/);
  await page.goBack();
  await expect(page.locator('.mobile-home:visible')).toBeVisible();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(minutes < 5 ? top : 0);
});
