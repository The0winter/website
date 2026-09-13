import {test, expect, type Page, type BrowserContext} from '@playwright/test';

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
        animation.pause(); animation.currentTime = 200;
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

async function swipe(page: Page, context: BrowserContext, direction: number) {
  await expect(page.locator('.mobile-section-snapshot')).toHaveCount(0);
  const cdp = await context.newCDPSession(page), width = page.viewportSize()!.width;
  const x = width * (direction > 0 ? .8 : .2), y = 320;
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y, id: 1}]});
  for (let step = 1; step <= 6; step++) await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: x - direction * step * 23, y, id: 1}]});
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  await cdp.detach();
}

async function pause(page: Page) {
  await expect(page.locator('html')).toHaveAttribute('data-mobile-section-transition', 'animating');
  return page.locator('.mobile-section-snapshot').evaluateAll(elements => elements.map(element => {
    const animation = element.getAnimations()[0];
    animation.pause(); animation.currentTime = 200;
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

for (const width of [320, 390]) for (const method of ['tap', 'swipe']) test(`${width}px ${method} slides both pages for 400ms and leaves navigation fixed`, async ({page, context}, info) => {
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

test('a slow destination keeps the old screen, then receives the full animation', async ({page}) => {
  await setup(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  await page.route('**/forum?_rsc=*', async route => {await gate; await route.continue();});
  try {
    await hold(page);
    await page.locator('.mh-bottom:visible [data-section=forum]').click();
    await expect(page.locator('html')).toHaveAttribute('data-mobile-section-transition', 'loading');
    await page.waitForTimeout(450);
    await expect(page.locator('[data-section-pane=outgoing]')).toHaveCount(1);
    await expect(page.locator('[data-section-pane=incoming]')).toHaveCount(0);
    release();
    const frames = await pause(page);
    expect(frames.map(frame => frame.duration)).toEqual([400, 400]);
    await finish(page);
  } finally {release();}
});

test('Back cancels a pending section without leaving an overlay or a late navigation', async ({page}) => {
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
    await expect(page).toHaveURL(base + '/library');
    await expect(page.locator('.mobile-section-snapshot')).toHaveCount(0);
    release();
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(base + '/library');
  } finally {release();}
});

test('reduced motion stays still for 400ms and resizing clears a running slide', async ({page}) => {
  await setup(page);
  await page.emulateMedia({reducedMotion: 'reduce'});
  await hold(page);
  await page.locator('.mh-bottom:visible [data-section=library]').click();
  const frames = await pause(page);
  expect(frames.map(frame => frame.x)).toEqual([0, 0]);
  expect(frames.map(frame => frame.duration)).toEqual([400, 400]);
  await finish(page);
  await page.emulateMedia({reducedMotion: 'no-preference'});
  await hold(page);
  await page.locator('.mh-bottom:visible [data-section=home]').click();
  await pause(page);
  await page.setViewportSize({width: 768, height: 844});
  await expect(page.locator('.mobile-section-snapshot')).toHaveCount(0);
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
