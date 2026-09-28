import {test, expect} from './fixtures/without-analytics';
import type {Page} from '@playwright/test';

const base = process.env.FEATURED_ENTRY_BASE || 'http://127.0.0.1:3000';
// UA selects a test profile; CPU/API simulations are not a real QQ/X5 device.
test.use({viewport: {width: 393, height: 851}, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36 MQQBrowser/15.0'});

type Probe = {tap: number; animation: number; styles: number; roots: {host: Element; root: ShadowRoot}[]};
async function setup(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('has-seen-reading-hint', 'true');
    Object.defineProperty(navigator, 'connection', {value: {saveData: true, addEventListener() {}, removeEventListener() {}}});
    const state: Probe = {tap: 0, animation: 0, styles: 0, roots: []};
    Object.assign(window, {featuredEntry: state});
    document.addEventListener('pointerup', event => {
      if ((event.target as Element).closest('.mobile-home a[href^="/book/"]')) state.tap = performance.now();
    }, true);
    const computed = window.getComputedStyle;
    window.getComputedStyle = (...args) => {
      if (state.tap && !state.animation) state.styles++;
      return computed(...args);
    };
    const animate = Element.prototype.animate;
    Element.prototype.animate = function(frames, options) {
      if (this.classList.contains('book-navigation-loading')) state.animation = performance.now();
      return animate.call(this, frames, options);
    };
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function(options) {
      const root = attach.call(this, options); state.roots.push({host: this, root}); return root;
    };
  });
  await page.route('**/api/books/*/views', route => route.fulfill({json: {success: true, counted: false}}));
  await page.goto(base);
  await page.waitForFunction(() => history.state?.bookNavigation?.kind === 'home');
}

test('cold featured detail starts promptly before the route response on a slow CPU', async ({page}, info) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  let requests = 0;
  await page.route('**/book/*?_rsc=*', async route => {requests++; await gate; await route.continue();});
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const cdp = await page.context().newCDPSession(page);
  try {
    await setup(page);
    await cdp.send('Emulation.setCPUThrottlingRate', {rate: 6});
    const link = page.locator('.mobile-home .mh-book:visible').first();
    const href = await link.getAttribute('href');
    await link.tap();
    await expect(page.locator('.book-navigation-loading')).toBeVisible();
    await expect.poll(() => requests).toBeGreaterThan(0);
    await expect(page.locator('.book-detail')).toHaveCount(0);
    const timing = await page.evaluate(() => {
      const state = (window as unknown as {featuredEntry: Probe}).featuredEntry;
      const snapshot = state.roots.find(({host}) => host.isConnected && host.classList.contains('book-transition-snapshot'))!.root;
      return {latency: state.animation - state.tap, styles: state.styles,
        mobile: snapshot.querySelectorAll('.mobile-home').length, desktop: snapshot.querySelectorAll('.desktop-home').length};
    });
    expect(timing.styles).toBeLessThan(30);
    expect(timing.latency).toBeGreaterThan(0);
    expect(timing.latency).toBeLessThan(250);
    expect(timing.mobile).toBe(1); expect(timing.desktop).toBe(0);
    await info.attach('tap-to-motion', {body: JSON.stringify(timing), contentType: 'application/json'});
    release();
    await expect(page.locator('.book-detail:visible')).toBeVisible();
    await expect(page.locator('.book-transition-snapshot')).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL(base + '/');
    await expect(page.locator('.book-transition-snapshot')).toHaveCount(0);
    await page.goForward();
    await expect(page).toHaveURL(base + href);
    await expect(page.locator('.book-detail:visible')).toBeVisible();
    await expect(page.locator('.book-transition-snapshot')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {release(); await cdp.send('Emulation.setCPUThrottlingRate', {rate: 1});}
});

for (const width of [320, 393]) test(`scrolled featured entry preserves header, banner and horizontal shelf at ${width}px`, async ({page}, info) => {
  await page.setViewportSize({width, height: 851});
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  await page.route('**/book/*?_rsc=*', async route => {await gate; await route.continue();});
  try {
    await setup(page);
    const shelf = page.locator('.mobile-home .mh-shelf').first();
    await shelf.scrollIntoViewIfNeeded();
    await shelf.evaluate(element => {element.scrollLeft = 160;});
    const selectors = ['.mh-topbar', '.mh-bottom', '.mh-banner[aria-hidden="false"]', '.mh-shelf-book:nth-child(3)'];
    const before = await page.evaluate(selectors => selectors.map(selector => {
      const rect = document.querySelector('.mobile-home')!.querySelector(selector)!.getBoundingClientRect();
      return {x: rect.x, y: rect.y, width: rect.width, height: rect.height};
    }), selectors);
    await shelf.locator('.mh-shelf-book').nth(2).evaluate(element => (element as HTMLElement).click());
    await expect(page.locator('.book-navigation-loading')).toBeVisible();
    const after = await page.evaluate(selectors => {
      const state = (window as unknown as {featuredEntry: Probe}).featuredEntry;
      const snapshot = state.roots.find(({host}) => host.isConnected && host.classList.contains('book-transition-snapshot'))!.root;
      return selectors.map(selector => {
        const rect = snapshot.querySelector(`${selector}:not([data-snapshot-spacer])`)!.getBoundingClientRect();
        return {x: rect.x, y: rect.y, width: rect.width, height: rect.height};
      });
    }, selectors);
    for (let index = 0; index < before.length; index++) for (const axis of ['x', 'y', 'width', 'height'] as const) {
      expect(Math.abs(after[index][axis] - before[index][axis]), selectors[index] + ':' + axis).toBeLessThan(1);
    }
    await info.attach('preserved-snapshot', {body: await page.screenshot({path: info.outputPath('verified-snapshot.png')}), contentType: 'image/png'});
    await page.goBack();
    await expect(page).toHaveURL(base + '/');
    await expect(page.locator('.book-transition-snapshot')).toHaveCount(0);
  } finally {release();}
});

for (const mode of ['reduced', 'missing-animation', 'style-fallback'] as const) test(`pending featured entry can be cancelled: ${mode}`, async ({page}) => {
  if (mode === 'reduced') await page.emulateMedia({reducedMotion: 'reduce'});
  await page.addInitScript(mode => {
    if (mode === 'missing-animation') Reflect.deleteProperty(Element.prototype, 'animate');
    if (mode === 'style-fallback') {
      Reflect.deleteProperty(ShadowRoot.prototype, 'adoptedStyleSheets');
      Reflect.deleteProperty(window, 'requestIdleCallback');
      Reflect.deleteProperty(window, 'cancelIdleCallback');
    }
  }, mode);
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  await page.route('**/book/*?_rsc=*', async route => {await gate; await route.continue();});
  try {
    await setup(page);
    // Remove the test wrapper as well, so the application really sees no API.
    if (mode === 'missing-animation') await page.evaluate(() => {Reflect.deleteProperty(Element.prototype, 'animate');});
    await page.locator('.mobile-home .mh-book:visible').first().tap();
    await expect(page.locator('.book-navigation-loading')).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(base + '/');
    await expect(page.locator('.book-transition-snapshot')).toHaveCount(0);
    release();
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(base + '/');
    await expect(page.locator('.mobile-home')).toBeVisible();
  } finally {release();}
});
