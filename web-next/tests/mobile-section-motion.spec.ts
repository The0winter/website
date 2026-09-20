import {test, expect, type Page, type BrowserContext} from '@playwright/test';

for (const width of [320, 390]) test(`${width}px every section follows each touch move and settles the remaining distance over 400ms`, async ({page, context}, info) => {
  await page.setViewportSize({width, height: 844});
  await setup(page);
  for (const [path, direction] of [['/library', -1], ['/', 1], ['/forum', 1], ['/', -1]] as const) {
    await expect(page.locator('.mobile-section-snapshot')).toHaveCount(0);
    const originalUrl = page.url();
    const nav = await page.locator('.mh-bottom:visible').boundingBox();
    const cdp = await context.newCDPSession(page), x = width * (direction > 0 ? .8 : .2), y = 320;
    await hold(page);
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y, id: 1}]});
    for (const distance of [30, 75, 120, 95, 140]) {
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: x - direction * distance, y, id: 1}]});
      await expect(page.locator('html')).toHaveAttribute('data-mobile-section-transition', 'dragging');
      await expect.poll(() => page.locator('[data-section-pane=outgoing]').evaluate(element => element.getBoundingClientRect().x), {timeout: 300}).toBeCloseTo(-direction * distance, 0);
      const positions = await page.locator('.mobile-section-snapshot').evaluateAll(elements => elements.map(element => ({pane: (element as HTMLElement).dataset.sectionPane, x: element.getBoundingClientRect().x, animations: element.getAnimations().length})));
      expect(positions.find(p => p.pane === 'outgoing')!.x).toBeCloseTo(-direction * distance, 0);
      expect(positions.find(p => p.pane === 'preview')!.x).toBeCloseTo(direction * (width - distance), 0);
      expect(positions.every(p => p.animations === 0)).toBe(true);
      expect(page.url()).toBe(originalUrl);
      expect(await page.locator('.mh-bottom:visible').boundingBox()).toEqual(nav);
      await page.waitForTimeout(100);
    }
    await page.screenshot({path: info.outputPath('drag-' + path.replaceAll('/', '_') + '.png')});
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
    await cdp.detach();
    const frames = await pause(page);
    expect(frames.map(frame => frame.duration)).toEqual([400, 400]);
    const initial = await page.locator('[data-section-pane=outgoing]').evaluate(element => (element.getAnimations()[0].effect as KeyframeEffect).getKeyframes()[0].transform);
    expect(await page.evaluate(transform => new DOMMatrix(transform as string).m41, initial)).toBe(-direction * 140);
    await expect(page).toHaveURL(base + path);
    await finish(page);
  }
});

test('reversing through the start and cancelling returns home without navigating or opening a book', async ({page, context}) => {
  await setup(page);
  const cdp = await context.newCDPSession(page), x = 195, y = 320;
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y, id: 1}]});
  for (const dx of [70, 110, 45, -35, -100, -40]) {
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: x + dx, y, id: 1}]});
    await expect(page.locator('html')).toHaveAttribute('data-mobile-section-transition', 'dragging');
    expect(await page.locator('[data-section-pane=outgoing]').evaluate(element => element.getBoundingClientRect().x)).toBeCloseTo(dx, 0);
  }
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchCancel', touchPoints: []});
  await cdp.detach();
  await expect(page.locator('.mobile-section-snapshot, .mobile-section-backdrop')).toHaveCount(0);
  await expect(page).toHaveURL(base + '/');
});

for (const distance of [55, 260, 380]) test(`a ${distance}px flick immediately starts a full 400ms settling motion`, async ({page, context}) => {
  await setup(page);
  // Warm the static forum route so this measures motion, not home SSR latency.
  await page.locator('.mh-bottom:visible [data-section=forum]').click();
  await expect(page.locator('.mobile-section-snapshot')).toHaveCount(0);
  await page.locator('.mh-bottom:visible [data-section=home]').click();
  await expect(page.locator('.mobile-section-snapshot')).toHaveCount(0);
  await page.evaluate(() => {
    document.addEventListener('touchstart', () => Object.assign(window, {flickStarted: performance.now()}), {once: true});
    const animate = Element.prototype.animate;
    Element.prototype.animate = function(frames, options) {
      if (this.classList.contains('mobile-section-snapshot')) Object.assign(window, {flickAnimationAt: performance.now()});
      return animate.call(this, frames, options);
    };
  });
  await hold(page);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: 385, y: 320, id: 1}]});
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: 385 - distance, y: 320, id: 1}]});
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  await cdp.detach();
  const frames = await pause(page);
  const elapsed = await page.evaluate(() => {
    const state = window as unknown as {flickStarted: number; flickAnimationAt: number};
    return state.flickAnimationAt - state.flickStarted;
  });
  expect(elapsed).toBeLessThan(300);
  expect(frames.map(frame => frame.duration)).toEqual([400, 400]);
  const origin = await page.locator('[data-section-pane=outgoing]').evaluate(element => new DOMMatrix((element.getAnimations()[0].effect as KeyframeEffect).getKeyframes()[0].transform as string).m41);
  expect(origin).toBe(-distance);
  await finish(page);
});

test('a slow route does not stop a released swipe or replay motion when it arrives', async ({page, context}) => {
  await setup(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  await page.route('**/forum?_rsc=*', async route => {await gate; await route.continue();});
  try {
    await hold(page);
    await swipe(page, context, 1);
    const frames = await pause(page, false);
    expect(frames.map(frame => frame.duration)).toEqual([400, 400]);
    expect(await page.locator('[data-section-pane=outgoing]').evaluate(element => new DOMMatrix((element.getAnimations()[0].effect as KeyframeEffect).getKeyframes()[0].transform as string).m41)).toBe(-138);
    await page.locator('.mobile-section-snapshot').evaluateAll(elements => elements.forEach(element => element.getAnimations().forEach(animation => animation.finish())));
    await expect(page.locator('html')).toHaveAttribute('data-mobile-section-transition', 'loading');
    expect(await page.locator('[data-section-pane=outgoing]').evaluate(element => element.getBoundingClientRect().x)).toBe(-390);
    expect(await page.locator('[data-section-pane=incoming]').evaluate(element => element.getBoundingClientRect().x)).toBe(0);
    release();
    // Any second animation would pause again and leave an overlay behind.
    await expect(page.locator('.mobile-section-snapshot, .mobile-section-header')).toHaveCount(0);
    await expect(page).toHaveURL(base + '/forum');
  } finally {release();}
});

const base = process.env.MOBILE_SECTIONS_BASE || 'http://127.0.0.1:3000';
const user = {id: '000000000000000000000001', username: '栏目动画验证', role: 'reader'};
test.use({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});

async function setup(page: Page, path = '/') {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'connection', {value: {saveData: true, addEventListener() {}, removeEventListener() {}}});
    document.addEventListener('DOMContentLoaded', () => {const style = document.createElement('style'); style.textContent = 'nextjs-portal{display:none}'; document.head.append(style);});
    const animate = Element.prototype.animate;
    Element.prototype.animate = function(frames, options) {
      const animation = animate.call(this, frames, options);
      if (this.classList.contains('mobile-section-snapshot') && (window as unknown as {holdSectionMotion?: boolean}).holdSectionMotion) {
        animation.pause(); animation.currentTime = Number(animation.effect!.getTiming().duration) / 2;
      }
      return animation;
    };
  });
  await page.route('**/api/auth/session', route => route.fulfill({json: {user, profile: user}}));
  await page.route('**/api/users/*/library?*', route => route.fulfill({json: [{bookId: '1', book: {id: '1', title: '栏目动画里的书架', author: '测试作者'}}]}));
  await page.route('**/api/forum/posts*', route => route.fulfill({json: []}));
  await page.goto(base + path);
  await expect(page.locator('.mobile-account-initial:visible')).toHaveText('栏');
}

async function swipe(page: Page, context: BrowserContext, direction: number, options: {duringMotion?: boolean; beforeEnd?: () => Promise<void>} = {}) {
  if (!options.duringMotion) await expect(page.locator('.mobile-section-snapshot')).toHaveCount(0);
  const cdp = await context.newCDPSession(page), width = page.viewportSize()!.width;
  const x = width * (direction > 0 ? .8 : .2), y = 320;
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y, id: 1}]});
  for (let step = 1; step <= 6; step++) {
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: x - direction * step * 23, y, id: 1}]});
    await page.waitForTimeout(16);
  }
  await options.beforeEnd?.();
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  await cdp.detach();
}

async function pause(page: Page, waitForRoute = true) {
  await expect(page.locator('html')).toHaveAttribute('data-mobile-section-transition', 'animating');
  if (waitForRoute) {
    const path = await page.locator('[data-section-pane=incoming]').getAttribute('data-section-path');
    await expect.poll(() => new URL(page.url()).pathname).toBe(path);
    await expect(page.locator(path === '/library' ? '.library-page' : path === '/forum' ? '.forum-page' : '.mobile-home')).toBeVisible();
  }
  return page.locator('.mobile-section-snapshot').evaluateAll(elements => elements.map(element => {
    const animation = element.getAnimations()[0];
    animation.pause(); animation.currentTime = Number(animation.effect!.getTiming().duration) / 2;
    return {pane: (element as HTMLElement).dataset.sectionPane, x: element.getBoundingClientRect().x,
      width: element.getBoundingClientRect().width, duration: animation.effect!.getTiming().duration};
  }));
}

async function hold(page: Page) {
  await page.evaluate(() => Object.assign(window, {holdSectionMotion: true}));
}

async function finish(page: Page) {
  await page.evaluate(() => Object.assign(window, {holdSectionMotion: false}));
  await page.locator('.mobile-section-snapshot').evaluateAll(elements => elements.forEach(element => element.getAnimations().forEach(animation => animation.play())));
  await expect(page.locator('.mobile-section-snapshot')).toHaveCount(0);
  await expect(page.locator('html')).not.toHaveAttribute('data-mobile-section-transition', /.+/);
}

for (const width of [320, 390]) test(`${width}px a fresh swipe takes over a running section slide in either direction`, async ({page, context}) => {
  await page.setViewportSize({width, height: 844});
  await setup(page);
  await hold(page);
  await swipe(page, context, -1);
  await pause(page);
  // Continue into history before the incoming shelf has finished sliding.
  await swipe(page, context, -1, {duringMotion: true});
  await expect(page.getByRole('tab', {name: '浏览记录'})).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.mobile-section-snapshot')).toHaveCount(0);
  await expect(page.locator('.shelf-viewport')).not.toHaveAttribute('data-switching', 'true');
  await swipe(page, context, 1);
  await expect(page.locator('.shelf-viewport')).not.toHaveAttribute('data-switching', 'true');
  await swipe(page, context, 1);
  await pause(page);
  await expect(page).toHaveURL(base + '/');
  // Continue through home and into the forum without waiting for either slide.
  await swipe(page, context, 1, {duringMotion: true});
  await pause(page);
  await expect(page).toHaveURL(base + '/forum');
  await swipe(page, context, 1, {duringMotion: true});
  await expect(page.getByRole('button', {name: '热榜', exact: true})).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.mobile-section-snapshot')).toHaveCount(0);
  await swipe(page, context, -1);
  await expect(page.getByRole('button', {name: '推荐', exact: true})).toHaveAttribute('aria-current', 'page');
  await swipe(page, context, -1);
  await expect(page).toHaveURL(base + '/');
  await pause(page);
  await swipe(page, context, -1, {duringMotion: true});
  await pause(page);
  await expect(page).toHaveURL(base + '/library');
  // Reverse direction while the shelf is still arriving.
  await swipe(page, context, 1, {duringMotion: true});
  await pause(page);
  await expect(page).toHaveURL(base + '/');
  await swipe(page, context, 1, {duringMotion: true});
  await pause(page);
  await swipe(page, context, -1, {duringMotion: true});
  await pause(page);
  await expect(page).toHaveURL(base + '/');
  await finish(page);
});

for (const width of [320, 390]) test(`${width}px only the two terminal pages resist an outward drag`, async ({page, context}) => {
  await page.setViewportSize({width, height: 844});
  await setup(page, '/library');
  const shelfX = () => page.locator('#shelf-content').evaluate(element => new DOMMatrix(getComputedStyle(element).transform).m41);
  const forumX = () => page.locator('.forum-mobile-feed > div').evaluate(element => new DOMMatrix(getComputedStyle(element).transform).m41);
  await swipe(page, context, 1, {beforeEnd: async () => {expect(await shelfX()).toBe(0);}});
  await expect(page).toHaveURL(base + '/');
  await swipe(page, context, 1);
  await expect(page).toHaveURL(base + '/forum');
  await swipe(page, context, -1, {beforeEnd: async () => {expect(await forumX()).toBe(0);}});
  await expect(page).toHaveURL(base + '/');
  await swipe(page, context, -1);
  await expect(page.locator('.mobile-section-snapshot')).toHaveCount(0);
  await page.getByRole('tab', {name: '浏览记录'}).tap();
  await expect(page.locator('.shelf-viewport')).not.toHaveAttribute('data-switching', 'true');
  await swipe(page, context, -1, {beforeEnd: async () => {expect(await shelfX()).toBeGreaterThan(0);}});
  await expect(page.getByRole('tab', {name: '浏览记录'})).toHaveAttribute('aria-selected', 'true');
  await expect.poll(shelfX).toBe(0);
  await page.locator('.mh-bottom:visible [data-section=forum]').tap();
  await expect(page.locator('.mobile-section-snapshot')).toHaveCount(0);
  await page.getByRole('button', {name: '关注', exact: true}).tap();
  const endX = -2 * await page.locator('.forum-mobile-feed').evaluate(element => element.clientWidth);
  await expect.poll(forumX).toBe(endX);
  await swipe(page, context, 1, {beforeEnd: async () => {expect(await forumX()).toBeLessThan(endX);}});
  await expect(page.getByRole('button', {name: '关注', exact: true})).toHaveAttribute('aria-current', 'page');
  await expect.poll(forumX).toBe(endX);
  await expect(page).toHaveURL(base + '/forum');
});

for (const width of [320, 390]) for (const method of ['tap', 'swipe']) test(`${width}px ${method} slides both pages from their current position and leaves navigation fixed`, async ({page, context}, info) => {
  await page.setViewportSize({width, height: 844});
  await setup(page);
  const navBounds = await page.locator('.mh-bottom:visible').boundingBox();
  for (const [section, path, direction] of [['library', '/library', -1], ['home', '/', 1], ['forum', '/forum', 1], ['home', '/', -1]] as const) {
    await hold(page);
    if (method === 'tap') await page.locator(`.mh-bottom:visible [data-section=${section}]`).tap();
    else await swipe(page, context, direction);
    const frames = await pause(page);
    expect(frames).toHaveLength(2);
    expect(frames.map(frame => frame.duration)).toEqual([400, 400]);
    expect(frames[0].x * direction).toBeLessThan(0);
    expect(frames[1].x * direction).toBeGreaterThan(0);
    expect(Math.abs((frames[1].x - frames[0].x) * direction - width)).toBeLessThan(1);
    expect(await page.locator('.mh-bottom:visible').boundingBox()).toEqual(navBounds);
    expect(await page.evaluate(() => Boolean(document.elementFromPoint(innerWidth - 8, innerHeight - 65)?.closest('.mh-create')))).toBe(true);
    await expect(page).toHaveURL(base + path);
    if (section === 'library') {
      const indicator = await page.locator('.shelf-tabs').evaluate(bar => ({
        selected: bar.querySelector('[aria-selected=true]')?.id,
        left: (bar.querySelector('[aria-selected=true]') as HTMLElement).offsetLeft,
        indicator: new DOMMatrix(getComputedStyle(bar, '::after').transform).m41,
        transitions: bar.getAnimations({subtree: true}).length,
      }));
      expect(indicator.selected).toBe('tab-shelf');
      expect(indicator.indicator).toBe(indicator.left);
      expect(indicator.transitions).toBe(0);
      await page.screenshot({path: info.outputPath('library-mid-slide.png')});
    }
    await finish(page);
  }
});

test('the shelf underline starts under the selected tab on its first painted frame', async ({page}) => {
  await page.addInitScript(() => {
    const samples: {selected: string; delta: number; animations: number}[] = [];
    Object.assign(window, {shelfIndicatorSamples: samples});
    const sample = () => {
      const bar = document.querySelector<HTMLElement>('.shelf-tabs');
      const tab = bar?.querySelector<HTMLElement>('[aria-selected=true]');
      if (bar && tab && bar.getBoundingClientRect().width) samples.push({selected: tab.id,
        delta: new DOMMatrix(getComputedStyle(bar, '::after').transform).m41 - tab.offsetLeft,
        animations: bar.getAnimations({subtree: true}).length});
      if (samples.length < 15) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await setup(page, '/library');
  await expect.poll(() => page.evaluate(() => (window as unknown as {shelfIndicatorSamples: unknown[]}).shelfIndicatorSamples.length)).toBe(15);
  const samples = await page.evaluate(() => (window as unknown as {shelfIndicatorSamples: {selected: string; delta: number; animations: number}[]}).shelfIndicatorSamples);
  expect(samples.every(sample => sample.selected === 'tab-shelf' && Math.abs(sample.delta) < 1 && sample.animations === 0)).toBe(true);
  await page.getByRole('tab', {name: '浏览记录'}).click();
  await expect(page.locator('.shelf-tabs')).toHaveAttribute('data-turning', 'true');
  await expect(page.getByRole('tab', {name: '浏览记录'})).toHaveAttribute('aria-selected', 'true');
});

test('a tap slides immediately even while the destination is still loading', async ({page}) => {
  await setup(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  await page.route('**/forum?_rsc=*', async route => {await gate; await route.continue();});
  try {
    await hold(page);
    await page.locator('.mh-bottom:visible [data-section=forum]').click();
    const frames = await pause(page, false);
    expect(frames.map(frame => frame.duration)).toEqual([400, 400]);
    expect(frames[0].x).toBeLessThan(0);
    await page.locator('.mobile-section-snapshot').evaluateAll(elements => elements.forEach(element => element.getAnimations().forEach(animation => animation.finish())));
    await expect(page.locator('html')).toHaveAttribute('data-mobile-section-transition', 'loading');
    release();
    await expect(page.locator('.mobile-section-snapshot, .mobile-section-header')).toHaveCount(0);
    await expect(page).toHaveURL(base + '/forum');
  } finally {release();}
});

test('Back from a pending section reaches Featured without a late navigation, then exits', async ({page}) => {
  await setup(page, '/library');
  await page.locator('.mh-bottom:visible [data-section=home]').click();
  await expect(page).toHaveURL(base + '/');
  await expect(page.locator('.mobile-section-snapshot')).toHaveCount(0);
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  await page.route('**/forum?_rsc=*', async route => {await gate; await route.continue();});
  try {
    await page.locator('.mh-bottom:visible [data-section=forum]').click();
    await expect(page.locator('html')).toHaveAttribute('data-mobile-section-transition', 'loading');
    await page.goBack();
    await expect(page).toHaveURL(base + '/');
    await expect(page.locator('.mobile-section-snapshot')).toHaveCount(0);
    release();
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(base + '/');
    await page.goBack();
    await expect(page).toHaveURL('about:blank');
  } finally {release();}
});

test('reduced motion has no slide or minimum delay and resizing clears a running slide', async ({page}) => {
  await setup(page);
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.evaluate(() => {
    const durations: number[] = [];
    Object.assign(window, {sectionDurations: durations});
    const animate = Element.prototype.animate;
    Element.prototype.animate = function(frames, options) {
      if (this.classList.contains('mobile-section-snapshot')) durations.push(Number(typeof options === 'number' ? options : options?.duration));
      return animate.call(this, frames, options);
    };
  });
  await page.locator('.mh-bottom:visible [data-section=library]').click();
  await expect(page).toHaveURL(base + '/library');
  await expect(page.locator('.mobile-section-snapshot')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as {sectionDurations: number[]}).sectionDurations)).toEqual([0, 0]);
  await page.emulateMedia({reducedMotion: 'no-preference'});
  await hold(page);
  await page.locator('.mh-bottom:visible [data-section=home]').click();
  await pause(page);
  await page.setViewportSize({width: 768, height: 844});
  await expect(page.locator('.mobile-section-snapshot, .mobile-section-header')).toHaveCount(0);
  await expect(page.locator('html')).not.toHaveAttribute('data-mobile-section-transition', /.+/);
});

test('another navigation cancels the old slide, and returning from history still selects shelf immediately', async ({page}) => {
  await setup(page);
  await hold(page);
  await page.locator('.mh-bottom:visible [data-section=library]').click();
  await pause(page);
  await page.locator('.mh-bottom:visible [data-section=forum]').click();
  await pause(page);
  await expect(page).toHaveURL(base + '/forum');
  await finish(page);
  await page.locator('.mh-bottom:visible [data-section=library]').click();
  await expect(page.locator('.mobile-section-snapshot')).toHaveCount(0);
  await page.getByRole('tab', {name: '浏览记录'}).click();
  await expect(page.locator('.shelf-tabs')).not.toHaveAttribute('data-turning', 'true');
  await page.locator('.mh-bottom:visible [data-section=home]').click();
  await expect(page.locator('.mobile-section-snapshot')).toHaveCount(0);
  await hold(page);
  await page.locator('.mh-bottom:visible [data-section=library]').click();
  await pause(page);
  const indicator = await page.locator('.shelf-tabs').evaluate(bar => ({selected: bar.querySelector('[aria-selected=true]')?.id,
    delta: new DOMMatrix(getComputedStyle(bar, '::after').transform).m41 - (bar.querySelector('#tab-shelf') as HTMLElement).offsetLeft,
    animations: bar.getAnimations({subtree: true}).length}));
  expect(indicator).toEqual({selected: 'tab-shelf', delta: 0, animations: 0});
  await finish(page);
});
