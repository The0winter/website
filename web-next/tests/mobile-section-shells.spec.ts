import {test, expect, type Page, type BrowserContext} from '@playwright/test';

const base = process.env.MOBILE_SECTIONS_BASE || 'http://127.0.0.1:3000';
test.use({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
const routes = [
  ['/', 'library', '/library'], ['/', 'forum', '/forum'],
  ['/library', 'home', '/'], ['/forum', 'home', '/'],
  ['/library', 'forum', '/forum'], ['/forum', 'library', '/library'],
] as const;

async function setup(page: Page, path: string) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {const style = document.createElement('style'); style.textContent = 'nextjs-portal{display:none}'; document.head.append(style);});
    Object.defineProperty(navigator, 'connection', {value: {saveData: true, addEventListener() {}, removeEventListener() {}}});
    // Inspect the otherwise private transition surfaces without altering them.
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function(init) {
      const shadow = attach.call(this, init);
      Object.assign(this, {testShadow: shadow});
      return shadow;
    };
    const animate = Element.prototype.animate;
    Element.prototype.animate = function(frames, options) {
      const animation = animate.call(this, frames, options);
      if (this.classList.contains('mobile-section-snapshot') && (window as unknown as {holdMotion: boolean}).holdMotion) {
        animation.pause(); animation.currentTime = 200;
      }
      return animation;
    };
  });
  const user = {id: '000000000000000000000001', username: '框架验证', role: 'reader'};
  await page.route('**/api/auth/session', route => route.fulfill({json: {user, profile: user}}));
  await page.route('**/api/users/*/library?*', route => route.fulfill({json: [{bookId: '1', book: {id: '1', title: '书架框架验证', author: '作者'}}]}));
  await page.route('**/api/forum/posts*', route => route.fulfill({json: []}));
  await page.goto(base + path);
  await expect(page.locator('.mobile-account-initial:visible')).toHaveText('框');
  await page.evaluate(() => document.fonts.ready);
  expect(errors).toEqual([]);
  return errors;
}

async function screenshotGesture(page: Page, context: BrowserContext) {
  const cdp = await context.newCDPSession(page);
  // Fingers arrive separately, as on a phone, then move down together before
  // the OS cancels the web touch sequence to take its screenshot.
  const fingers = [{x: 70, y: 310, id: 1}, {x: 150, y: 315, id: 2}, {x: 240, y: 310, id: 3}];
  for (let count = 1; count <= 3; count++) await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: fingers.slice(0, count)});
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: fingers.map(point => ({...point, y: point.y + 80}))});
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchCancel', touchPoints: []});
  await cdp.detach();
}

async function frameMetrics(page: Page, path: string, preview: boolean) {
  return page.evaluate(({path, preview}) => {
    const pane = document.querySelector('[data-section-pane=incoming]') as HTMLElement & {testShadow: ShadowRoot};
    const scope: ParentNode = preview ? pane.testShadow : document;
    const selector = path === '/library' ? '.shelf-tabs button, .shelf-actions button, .shelf-sort>span'
      : path === '/forum' ? '.forum-feed-toolbar button' : '.mh-shortcuts>*, .mh-section h2, .mh-section header>button, .mh-section header>a';
    return [...scope.querySelectorAll<HTMLElement>(selector)].map(element => {
      const box = element.getBoundingClientRect(), style = getComputedStyle(element);
      return {text: element.textContent?.trim(), x: box.x, y: box.y, width: box.width, height: box.height,
        font: style.fontFamily, size: style.fontSize, weight: style.fontWeight, lineHeight: style.lineHeight,
        color: style.color, border: style.borderBottomColor};
    });
  }, {path, preview});
}

for (const width of [320, 390]) for (const [from, section, to] of routes) {
  test(`${width}px cold ${from} to ${to} keeps real controls and survives a screenshot while the route is delayed`, async ({page, context}, info) => {
    await page.setViewportSize({width, height: 844});
    let release!: () => void;
    const gate = new Promise<void>(resolve => {release = resolve;});
    // Gate before the first render: signed-in sessions eagerly prefetch shelf.
    await page.route(url => url.pathname === to && url.searchParams.has('_rsc'), async route => {await gate; await route.continue();});
    try {
      const errors = await setup(page, from);
      await page.locator(`.mh-bottom:visible [data-section=${section}]`).tap();
      await expect(page.locator('html')).toHaveAttribute('data-mobile-section-transition', 'loading');
      const before = await frameMetrics(page, to, true);
      expect(before.length).toBeGreaterThan(2);
      await page.screenshot({path: info.outputPath('loading.png')});
      await screenshotGesture(page, context);
      await expect(page.locator('html')).toHaveAttribute('data-mobile-section-transition', 'loading');
      await expect(page.locator('[data-section-pane=incoming]')).toHaveAttribute('data-section-path', to);
      expect(await frameMetrics(page, to, true)).toEqual(before);
      await page.setViewportSize({width, height: 790});
      await expect(page.locator('html')).toHaveAttribute('data-mobile-section-transition', 'loading');
      await page.setViewportSize({width, height: 844});
      release();
      await expect(page).toHaveURL(base + to);
      await expect(page.locator('.mobile-section-snapshot, .mobile-section-header')).toHaveCount(0);
      const after = await frameMetrics(page, to, false);
      // The content rows may have different heights, but the fixed toolbar and
      // the first home section must match down to the font and pixel geometry.
      const count = to === '/' ? 5 : before.length;
      expect(after.slice(0, count)).toEqual(before.slice(0, count));
      await page.screenshot({path: info.outputPath('ready.png')});
      expect(errors).toEqual([]);
    } finally {release();}
  });
}

for (const [from, section, to] of routes) test(`three fingers preserve the running animation from ${from} to ${to}`, async ({page, context}) => {
  await setup(page, from);
  await page.evaluate(() => Object.assign(window, {holdMotion: true}));
  await page.locator(`.mh-bottom:visible [data-section=${section}]`).tap();
  await expect(page).toHaveURL(base + to);
  await expect(page.locator('html')).toHaveAttribute('data-mobile-section-transition', 'animating');
  await screenshotGesture(page, context);
  await expect(page.locator('html')).toHaveAttribute('data-mobile-section-transition', 'animating');
  await expect(page.locator('[data-section-pane=incoming]')).toHaveAttribute('data-section-path', to);
  await page.locator('.mobile-section-snapshot').evaluateAll(elements => elements.forEach(element => element.getAnimations().forEach(animation => animation.finish())));
  await expect(page.locator('.mobile-section-snapshot')).toHaveCount(0);
  await expect(page).toHaveURL(base + to);
});

test('an intentional tap can use the arrived shelf before its animation finishes', async ({page}) => {
  await setup(page, '/');
  await page.evaluate(() => Object.assign(window, {holdMotion: true}));
  await page.locator('.mh-bottom:visible [data-section=library]').tap();
  await expect(page).toHaveURL(base + '/library');
  await expect(page.locator('html')).toHaveAttribute('data-mobile-section-transition', 'animating');
  await page.getByRole('button', {name: '管理', exact: true}).tap();
  await expect(page.locator('.mobile-section-snapshot')).toHaveCount(0);
  await expect(page.locator('.library-page')).toHaveAttribute('data-managing', 'true');
});
