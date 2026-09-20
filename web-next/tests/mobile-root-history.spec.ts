import {test, expect, type Page} from '@playwright/test';

const base = process.env.MOBILE_ROOT_BASE || 'http://127.0.0.1:3118';
const outside = 'https://outside.example.test/';
const user = {id: '000000000000000000000001', username: '返回验证', role: 'reader'};
test.use({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});

async function setup(page: Page, path = '/') {
  await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style'); style.textContent = 'nextjs-portal{display:none!important}'; document.head.append(style);
  }));
  await page.route(outside, route => route.fulfill({contentType: 'text/html', body: '<title>Outside</title><p>Previous website</p>'}));
  await page.route('**/api/auth/session', route => route.fulfill({json: {user, profile: user}}));
  await page.route('**/api/users/*/library?*', route => route.fulfill({json: []}));
  await page.route('**/api/forum/posts*', route => route.fulfill({json: []}));
  await page.route('**/api/writer/works?*', route => route.fulfill({json: []}));
  await page.goto(outside);
  await page.goto(base + path);
  await expect.poll(() => page.evaluate(() => Boolean(history.state?.mobileRoot))).toBe(true);
  if (page.viewportSize()!.width < 768) await expect(page.locator('.mh-bottom:visible [data-section=library]')).toHaveAttribute('href', '/library');
}

async function tab(page: Page, name: string) {
  await expect(page.locator('.mobile-section-snapshot')).toHaveCount(0);
  await page.locator(`.mh-bottom:visible [data-section=${name}]`).click();
  await expect(page).toHaveURL(base + (name === 'home' ? '/' : '/' + name));
  await expect(page.locator('.mobile-section-snapshot')).toHaveCount(0);
}

async function exit(page: Page) {
  await expect(page).toHaveURL(base + '/');
  await expect(page.locator('.mobile-home:visible')).toBeVisible();
  expect(await page.evaluate(() => history.state.mobileRoot.index)).toBe(0);
  await page.goBack();
  await expect(page).toHaveURL(outside);
}

for (const destination of ['library', 'forum']) test(`${destination}: one animated Back reaches Featured after many section changes, then exits`, async ({page}, info) => {
  await setup(page);
  for (const name of ['library', 'forum', 'home', 'forum', 'library', 'home', destination]) await tab(page, name);
  await page.evaluate(() => {
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      const animation = animate.apply(this, args);
      if ((this as HTMLElement).dataset.sectionPane) animation.pause();
      return animation;
    };
  });
  await page.goBack();
  await expect(page).toHaveURL(base + '/');
  await expect(page.locator('[data-section-pane=outgoing]')).toHaveCount(1);
  const frames = await page.locator('[data-section-pane=outgoing]').evaluate(element => {
    const effect = element.getAnimations()[0].effect as KeyframeEffect;
    return {duration: effect.getTiming().duration, frames: effect.getKeyframes().map(frame => frame.transform)};
  });
  expect(frames.duration).toBe(400);
  expect(frames.frames[0]).not.toBe(frames.frames[1]);
  await page.screenshot({path: info.outputPath('final-section-return.png')});
  await page.evaluate(() => document.getAnimations().forEach(animation => animation.finish()));
  await expect(page.locator('.mobile-section-snapshot')).toHaveCount(0);
  await exit(page);
});

for (const source of ['library', 'forum', 'home']) test(`writer launched from ${source} reveals its original section with the full circular exit`, async ({page}, info) => {
  await setup(page);
  await tab(page, 'forum');
  await tab(page, 'library');
  await tab(page, source);
  if (source === 'library') {
    await page.getByRole('tab', {name: '浏览记录', exact: true}).click();
    await expect(page.getByRole('tab', {name: '浏览记录', exact: true})).toHaveAttribute('aria-selected', 'true');
  }
  if (source === 'forum') {
    await page.getByRole('button', {name: '热榜', exact: true}).click();
    await expect(page.getByRole('button', {name: '热榜', exact: true})).toHaveAttribute('aria-current', 'page');
  }
  const originalUrl = page.url();
  const originalPosition = await page.evaluate(() => history.state.mobileRoot.index);
  await page.getByRole('button', {name: '创作', exact: true}).click();
  await expect(page.locator('.mw-dialog')).toHaveAttribute('data-ready', 'true');
  await page.locator('.mw-dialog').getByRole('link', {name: /新建作品/}).click();
  await expect(page.locator('.mw-view-panel')).toHaveAttribute('data-ready', 'true');
  await page.goBack();
  await expect(page.locator('.mw-view')).toHaveCount(0);
  await expect(page.locator('.mw-dialog')).toBeVisible();
  await page.evaluate(() => {
    const frames: {closing: boolean; transform: string; path: string}[] = [];
    Object.assign(window, {rootReturnFrames: frames});
    const sample = () => {
      const dialog = document.querySelector<HTMLElement>('.mw-dialog');
      if (!dialog) return;
      frames.push({closing: dialog.dataset.closing === 'true', transform: getComputedStyle(dialog.querySelector('.mw-reveal')!).transform,
        path: location.pathname + location.search});
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  // Cover both browser/system Back and the center's visible Back button.
  if (source === 'forum') await page.getByRole('button', {name: '返回上一页', exact: true}).click();
  else await page.goBack();
  await expect(page.locator('.mw-dialog')).toHaveCount(0);
  const frames = await page.evaluate(() => (window as Window & {rootReturnFrames?: {closing: boolean; transform: string; path: string}[]}).rootReturnFrames!);
  expect(frames.filter(frame => frame.closing).length).toBeGreaterThan(2);
  expect(new Set(frames.filter(frame => frame.closing).map(frame => frame.transform)).size).toBeGreaterThan(2);
  expect(frames.filter(frame => frame.closing).every(frame => new URL(frame.path, base).href === originalUrl)).toBe(true);
  await info.attach('final-writer-motion', {body: JSON.stringify(frames), contentType: 'application/json'});
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  await expect(page).toHaveURL(originalUrl);
  expect(await page.evaluate(() => history.state.mobileRoot.index)).toBe(originalPosition);
  if (source === 'library') await expect(page.getByRole('tab', {name: '浏览记录', exact: true})).toHaveAttribute('aria-selected', 'true');
  if (source === 'forum') await expect(page.getByRole('button', {name: '热榜', exact: true})).toHaveAttribute('aria-current', 'page');
  if (source !== 'home') {
    await page.goBack();
    await expect(page.locator('.mobile-section-snapshot')).toHaveCount(0);
  }
  await exit(page);
});

for (const path of ['/library', '/forum']) test(`direct ${path} and reload reuse a single Featured predecessor`, async ({page}) => {
  await setup(page, path);
  const length = await page.evaluate(() => history.length);
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(history.state?.mobileRoot))).toBe(true);
  expect(await page.evaluate(() => history.length)).toBe(length);
  await page.goBack();
  await expect(page.locator('.mobile-section-snapshot')).toHaveCount(0);
  await exit(page);
});

test('Featured reached by a tab tap exits without replaying previous sections', async ({page}) => {
  await setup(page);
  for (const name of ['forum', 'library', 'forum', 'home']) await tab(page, name);
  await exit(page);
});

test('shelf management consumes its own Back before the main screen returns home', async ({page}) => {
  await setup(page);
  await page.unroute('**/api/users/*/library?*');
  await page.route('**/api/users/*/library?*', route => route.fulfill({json: [{bookId: '1', book: {id: '1', title: '返回验证'}}]}));
  await page.reload();
  await tab(page, 'library');
  await page.getByRole('button', {name: '管理', exact: true}).click();
  await page.goBack();
  await expect(page.locator('.library-page')).not.toHaveAttribute('data-managing', 'true');
  await expect(page).toHaveURL(base + '/library');
  await page.goBack();
  await expect(page.locator('.mobile-section-snapshot')).toHaveCount(0);
  await exit(page);
});

test('desktop keeps normal browser Back between sections', async ({page}) => {
  await setup(page);
  await tab(page, 'forum');
  await tab(page, 'library');
  await page.setViewportSize({width: 1440, height: 900});
  await page.goBack();
  await expect(page).toHaveURL(base + '/forum');
  await page.goBack();
  await expect(page).toHaveURL(base + '/');
});

test('reader and book details still return one level at a time before leaving Featured', async ({page}) => {
  await setup(page);
  await page.locator('.mobile-home a[href^="/book/"]').first().click();
  await expect(page.locator('.book-detail:visible')).toBeVisible();
  const detail = page.url();
  await expect(page.locator('html')).not.toHaveAttribute('data-book-transition', /.+/);
  await page.getByRole('link', {name: '立即阅读', exact: true}).click();
  await expect(page.locator('.reader-pages-root:visible')).toHaveAttribute('data-reader-ready', 'true');
  await expect(page.locator('html')).not.toHaveAttribute('data-book-transition', /.+/);
  await page.goBack();
  await expect(page).toHaveURL(detail);
  await expect(page.locator('.book-detail:visible')).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-book-transition', /.+/);
  await page.goBack();
  await expect(page.locator('html')).not.toHaveAttribute('data-book-transition', /.+/);
  await exit(page);
});

test('writer Back after reload returns to its source without requesting Featured', async ({page}) => {
  await setup(page, '/forum');
  await page.getByRole('button', {name: '创作', exact: true}).click();
  await expect(page.locator('.mw-dialog')).toHaveAttribute('data-ready', 'true');
  const length = await page.evaluate(() => history.length);
  await page.reload();
  await expect(page.locator('.mw-dialog')).toHaveAttribute('data-ready', 'true');
  expect(await page.evaluate(() => history.length)).toBe(length);
  let homeRequests = 0;
  await page.route(url => url.origin === new URL(base).origin && url.pathname === '/' && url.searchParams.has('_rsc'), async route => {
    homeRequests++;
    await route.continue();
  });
  await page.goBack();
  await expect(page.locator('.mw-dialog')).toHaveCount(0);
  await expect(page).toHaveURL(base + '/forum');
  expect(homeRequests).toBe(0);
  await page.goBack();
  await expect(page.locator('.mobile-section-snapshot')).toHaveCount(0);
  await exit(page);
});

test('reduced motion keeps the same return and exit boundary', async ({page}) => {
  await page.emulateMedia({reducedMotion: 'reduce'});
  await setup(page);
  await tab(page, 'forum');
  await tab(page, 'library');
  await page.goBack();
  await expect(page.locator('.mobile-section-snapshot')).toHaveCount(0);
  await exit(page);
});
