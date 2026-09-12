import {test, expect, type Page} from '@playwright/test';

const base = process.env.BOOK_BACK_BASE || 'http://127.0.0.1:3000';
const book = process.env.BOOK_BACK_BOOK || '000000000000000000000101';
const detail = `${base}/book/${book}`;
const homeCard = (page: Page) => page.locator(page.viewportSize()!.width < 768 ? '.mobile-home' : '.desktop-home').locator(`a[href="/book/${book}"]:visible`).first();
const idle = (page: Page) => expect(page.locator('html')).not.toHaveAttribute('data-book-transition', /.+/);
const home = async (page: Page) => {
  await expect(page).toHaveURL(base + '/'); await idle(page);
  await expect(page.locator('.mobile-home:visible, .desktop-home:visible')).toBeVisible();
};
const ready = async (page: Page) => {
  await expect(page).toHaveURL(detail); await idle(page);
  await expect(page.locator('.book-detail:visible')).toHaveAttribute('data-book-id', book);
};

test.beforeEach(async ({page}) => {
  await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'connection', {value: {saveData: true, addEventListener() {}, removeEventListener() {}}});
    localStorage.setItem('has-seen-reading-hint', 'true');
  });
});

for (const scenario of [
  {width: 320, back: 'browser', wait: 0, reduced: false},
  {width: 1440, back: 'escape', wait: 0, reduced: false},
  {width: 390, back: 'browser', wait: 700, reduced: false},
  {width: 390, back: 'escape', wait: 700, reduced: true},
]) {
  test(`first home visit keeps ${scenario.back} on home during loading at ${scenario.width}px, wait ${scenario.wait}, reduced ${scenario.reduced}`, async ({page}, info) => {
    await page.setViewportSize({width: scenario.width, height: 844});
    await page.emulateMedia({reducedMotion: scenario.reduced ? 'reduce' : 'no-preference'});
    await page.goto(base); await home(page);
    const length = await page.evaluate(() => history.length);
    const link = homeCard(page);
    let release!: () => void;
    const gate = new Promise<void>(resolve => {release = resolve;});
    await page.route(`**/book/${book}?_rsc=*`, async route => {await gate; await route.continue();});
    try {
      await link.click();
      await expect(page.locator('.book-navigation-loading')).toBeVisible();
      await expect(page).toHaveURL(detail);
      expect(await page.evaluate(() => history.length)).toBe(length + 1);
      if (scenario.wait) await page.waitForTimeout(scenario.wait);
      if (scenario.back === 'browser') await page.goBack(); else await page.keyboard.press('Escape');
      await home(page);
      await expect(page.locator('.book-transition-snapshot')).toHaveCount(0);
      release(); await page.waitForTimeout(500); await home(page);
      await page.screenshot({path: info.outputPath('cancelled-on-home.png')});
      // The reserved entry must load real details on Forward, then reuse the
      // visited route normally without adding a second detail history slot.
      await page.goForward(); await ready(page);
      expect(await page.evaluate(() => history.length)).toBe(length + 1);
      await page.goBack(); await home(page);
      await link.click(); await ready(page);
      expect(await page.evaluate(() => history.length)).toBe(length + 1);
      await page.goBack(); await home(page);
    } finally {release();}
  });
}

for (const width of [320, 1440]) {
  test(`detail exit runs for 400ms on first and cached visits at ${width}px`, async ({page}, info) => {
    await page.setViewportSize({width, height: 844});
    await page.addInitScript(() => {
      const exits: {duration: number; elapsed?: number}[] = [];
      Object.assign(window, {detailExits: exits});
      const animate = Element.prototype.animate;
      Element.prototype.animate = function(frames, options) {
        const animation = animate.call(this, frames, options);
        if (this.classList.contains('book-transition-snapshot') && this.getAttribute('data-motion') === 'exit') {
          const start = performance.now();
          const exit = {duration: Number(animation.effect!.getTiming().duration), elapsed: undefined as number | undefined};
          exits.push(exit);
          animation.finished.then(() => {exit.elapsed = performance.now() - start;}).catch(() => {});
        }
        return animation;
      };
    });
    await page.goto(base); await home(page);
    for (let visit = 0; visit < 2; visit++) {
      await homeCard(page).click(); await ready(page);
      await page.goBack(); await home(page);
    }
    const exits = await page.evaluate(() => (window as unknown as {detailExits: {duration: number; elapsed: number}[]}).detailExits);
    expect(exits).toHaveLength(2);
    exits.forEach(exit => {expect(exit.duration).toBe(400); expect(exit.elapsed).toBeGreaterThanOrEqual(380);});
    await info.attach('detail-exit-timing', {body: JSON.stringify(exits), contentType: 'application/json'});
  });
}
