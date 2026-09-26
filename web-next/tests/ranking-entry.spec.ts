import {test, expect} from './fixtures/without-analytics';

const base = process.env.RANKING_ENTRY_BASE || 'http://127.0.0.1:3000';
test.use({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36 Quark/7.0.0'});

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'connection', {value: {saveData: true, addEventListener() {}, removeEventListener() {}}});
    const timing = {tap: 0, animation: 0, styleReads: 0};
    Object.assign(window, {rankingEntryTiming: timing});
    document.addEventListener('pointerup', event => {
      if ((event.target as Element).closest('.mh-shortcuts a[href="/ranking"]')) {
        timing.tap = performance.now(); timing.styleReads = 0;
      }
    }, true);
    const computed = window.getComputedStyle;
    window.getComputedStyle = (...args) => {
      if (timing.tap && !timing.animation) timing.styleReads++;
      return computed(...args);
    };
    const animate = Element.prototype.animate;
    Element.prototype.animate = function(frames, options) {
      if (this.classList.contains('ranking-navigation-loading')) timing.animation = performance.now();
      return animate.call(this, frames, options);
    };
  });
});

test('cold ranking starts moving before the route response on a throttled Android touch device', async ({page}, info) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => {release = resolve;});
  let blocked = 0;
  await page.route('**/ranking?_rsc=*', async route => {blocked++; await pending; await route.continue();});
  const cdp = await page.context().newCDPSession(page);
  try {
    await page.goto(base);
    await page.waitForFunction(() => Boolean(history.state?.bookNavigation));
    await cdp.send('Emulation.setCPUThrottlingRate', {rate: 6});
    await page.locator('.mh-shortcuts a[href="/ranking"]').tap();
    await expect(page.locator('.ranking-navigation-loading')).toBeVisible();
    await expect.poll(() => blocked).toBeGreaterThan(0);
    await expect(page.locator('main .ranking-page')).toHaveCount(0);
    const timing = await page.evaluate(() => (window as unknown as {rankingEntryTiming: {tap: number; animation: number; styleReads: number}}).rankingEntryTiming);
    expect(timing.animation - timing.tap).toBeGreaterThanOrEqual(0);
    expect(timing.animation - timing.tap).toBeLessThan(350);
    expect(timing.styleReads).toBeLessThan(20);
    await info.attach('entry-timing', {body: JSON.stringify({...timing, delayMs: timing.animation - timing.tap}), contentType: 'application/json'});
    await page.screenshot({path: info.outputPath('verified-ranking-pending-route.png')});
    release();
    await expect(page.locator('.ranking-navigation-loading')).toHaveCount(0);
    await expect(page.locator('main .ranking-header')).toBeVisible();
    await expect(page.locator('html')).not.toHaveAttribute('data-book-transition', /.+/);
  } finally {release(); await cdp.send('Emulation.setCPUThrottlingRate', {rate: 1});}
});

for (const mode of ['normal', 'reduced', 'missing-animation'] as const) test(`pending ranking can return without late reopening: ${mode}`, async ({page}) => {
  if (mode === 'reduced') await page.emulateMedia({reducedMotion: 'reduce'});
  if (mode === 'missing-animation') await page.addInitScript(() => {Object.defineProperty(Element.prototype, 'animate', {value: undefined, configurable: true});});
  let release!: () => void;
  const pending = new Promise<void>(resolve => {release = resolve;});
  await page.route('**/ranking?_rsc=*', async route => {await pending; await route.continue();});
  try {
    await page.goto(base);
    await page.waitForFunction(() => Boolean(history.state?.bookNavigation));
    await page.locator('.mh-shortcuts a[href="/ranking"]').tap();
    await expect(page.locator('.ranking-navigation-loading')).toBeVisible();
    await page.locator('.ranking-navigation-loading .ranking-back').tap();
    await expect(page).toHaveURL(base + '/');
    await expect(page.locator('html')).not.toHaveAttribute('data-book-transition', /.+/);
    release();
    await page.waitForTimeout(750);
    await expect(page).toHaveURL(base + '/');
    await expect(page.locator('.book-transition-snapshot')).toHaveCount(0);
    await expect(page.locator('.mh-shortcuts')).toBeVisible();
  } finally {release();}
});

test('a stalled ranking route offers retry and keeps its back control usable', async ({page}) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => {release = resolve;});
  await page.route('**/ranking?_rsc=*', async route => {await pending; await route.continue();});
  try {
    await page.goto(base);
    await page.waitForFunction(() => Boolean(history.state?.bookNavigation));
    await page.locator('.mh-shortcuts a[href="/ranking"]').tap();
    await expect(page.locator('.ranking-navigation-loading [role=alert]')).toContainText('排行榜暂时未能加载', {timeout: 25000});
    await expect(page.locator('.ranking-navigation-loading').getByRole('button', {name: '重试'})).toBeVisible();
    await page.locator('.ranking-navigation-loading .ranking-back').tap();
    await expect(page).toHaveURL(base + '/');
    await expect(page.locator('.ranking-navigation-loading')).toHaveCount(0);
  } finally {release();}
});

for (const top of [0, 120]) test(`ranking entry preserves the home underneath at scroll ${top}`, async ({page}) => {
  await page.addInitScript(() => {
    const roots: {host: Element; root: ShadowRoot}[] = [];
    Object.assign(window, {rankingSnapshotRoots: roots});
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function(options) {
      const root = attach.call(this, options); roots.push({host: this, root}); return root;
    };
  });
  let release!: () => void;
  const pending = new Promise<void>(resolve => {release = resolve;});
  await page.route('**/ranking?_rsc=*', async route => {await pending; await route.continue();});
  try {
    await page.goto(base);
    await page.waitForFunction(() => Boolean(history.state?.bookNavigation));
    await page.evaluate(top => scrollTo(0, top), top);
    const selectors = ['.mh-topbar', '.mh-bottom', '.mh-shortcuts', '.mh-carousel'];
    const before = await page.evaluate(selectors => selectors.map(selector => {
      const r = document.querySelector('.mobile-home')!.querySelector(selector)!.getBoundingClientRect();
      return {x: r.x, y: r.y, width: r.width, height: r.height};
    }), selectors);
    // A DOM click avoids Playwright scrolling the partially visible shortcut.
    await page.locator('.mh-shortcuts a[href="/ranking"]').evaluate(el => (el as HTMLElement).click());
    const after = await page.evaluate(selectors => {
      const roots = (window as unknown as {rankingSnapshotRoots: {host: Element; root: ShadowRoot}[]}).rankingSnapshotRoots;
      const snapshot = roots.find(({host}) => host.isConnected && host.classList.contains('book-transition-snapshot'))!.root;
      return selectors.map(selector => {
        const r = snapshot.querySelector(`${selector}:not([data-snapshot-spacer])`)!.getBoundingClientRect();
        return {x: r.x, y: r.y, width: r.width, height: r.height};
      });
    }, selectors);
    expect(after).toEqual(before);
    await page.goBack();
    await expect(page).toHaveURL(base + '/');
  } finally {release();}
});
