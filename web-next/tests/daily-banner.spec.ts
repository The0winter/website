import {test, expect, type Page} from '@playwright/test';
const base = process.env.FEATURED_BASE || 'http://127.0.0.1:3000';
test.use({hasTouch: true});

for (const width of [320, 390, 767]) test(`first banner stays visible through delayed hydration and reload at ${width}px`, async ({page}, info) => {
  await page.setViewportSize({width, height: 844});
  await page.addInitScript(() => {
    const samples: string[] = [];
    (window as typeof window & {initialBannerFrames: string[]}).initialBannerFrames = samples;
    function sample() {
      const rail = document.querySelector('.mh-banner-track');
      const bounds = rail?.getBoundingClientRect();
      if (bounds?.width && bounds.height) {
        const slide = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + 60)?.closest('.mh-banner');
        if (slide) samples.push(slide.getAttribute('href')!);
      }
      requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  });
  let releaseScripts = () => {};
  let scripts = Promise.resolve();
  await page.route('**/_next/**', async route => {
    if (route.request().resourceType() === 'script') await scripts;
    await route.continue();
  });
  for (const navigation of ['load', 'reload']) {
    scripts = new Promise<void>(resolve => {releaseScripts = resolve;});
    try {
      if (navigation === 'load') await page.goto(base, {waitUntil: 'commit'});
      else await page.reload({waitUntil: 'commit'});
      const rail = page.locator('.mh-banner-track');
      const first = rail.locator('.mh-banner:not([data-banner-clone])').first();
      await expect(rail).toBeVisible();
      await expect(rail).toHaveCSS('overflow-x', 'auto');
      const href = await first.getAttribute('href');
      // Hold the scripts after SSR has painted, as on a slow phone/network.
      await page.waitForTimeout(350);
      await page.screenshot({path: info.outputPath(`verified-${navigation}-before-hydration.png`)});
      const frames = () => page.evaluate(() => (window as typeof window & {initialBannerFrames: string[]}).initialBannerFrames);
      expect(new Set(await frames())).toEqual(new Set([href]));
      releaseScripts();
      await expect.poll(() => rail.evaluate(el => Math.abs(el.scrollLeft - el.clientWidth))).toBeLessThan(2);
      await expect(first).toHaveAttribute('aria-hidden', 'false');
      await page.waitForTimeout(350);
      expect(new Set(await frames())).toEqual(new Set([href]));
      await page.screenshot({path: info.outputPath(`verified-${navigation}-after-hydration.png`)});
      // Refresh after using the carousel too, not only from its initial slide.
      await page.locator('.mh-banner-dots button').nth(2).click();
      await expect.poll(() => rail.evaluate(el => Math.abs(el.scrollLeft - el.clientWidth * 3))).toBeLessThan(2);
    } finally {
      releaseScripts();
    }
  }
});

async function drag(page: Page, dx: number, dy = 0) {
  const bounds = (await page.locator('.mh-banner-track').boundingBox())!;
  const x = dx < 0 ? bounds.x + bounds.width - 35 : bounds.x + 35, y = bounds.y + 65;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y, id: 1}]});
  for (let i = 1; i <= 8; i++) {
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: x + dx * i / 8, y: y + dy * i / 8, id: 1}]});
    await page.waitForTimeout(20);
  }
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []}); await cdp.detach();
}

for (const width of [320, 390, 767]) test(`daily three-book carousel swipes without section navigation at ${width}px`, async ({page, request}, info) => {
  await page.setViewportSize({width, height: 844});
  await page.goto(base);
  const books = await (await request.get(`${base}/api/books?orderBy=featured_daily&limit=3`)).json();
  const rail = page.locator('.mh-banner-track'), slides = rail.locator('.mh-banner:not([data-banner-clone])');
  await expect(slides).toHaveCount(3);
  expect(await slides.evaluateAll(links => links.map(link => link.getAttribute('href')))).toEqual(books.map((book: {id: string}) => `/book/${book.id}`));
  await drag(page, -(width - 90));
  await expect(slides.nth(1)).toHaveAttribute('aria-hidden', 'false');
  await expect(page).toHaveURL(base + '/');
  await expect(page.locator('[data-section-transition]')).toHaveCount(0);
  await page.getByRole('button', {name: `查看推荐：${books[2].title}`, exact: true}).click();
  await expect(slides.nth(2)).toHaveAttribute('aria-hidden', 'false');
  await expect.poll(() => rail.evaluate(el => Math.abs(el.scrollLeft - el.clientWidth * 3))).toBeLessThan(2);
  await drag(page, -(width - 90));
  await expect(slides.nth(0)).toHaveAttribute('aria-hidden', 'false');
  await expect.poll(() => rail.evaluate(el => Math.abs(el.scrollLeft - el.clientWidth))).toBeLessThan(2);
  await drag(page, width - 90);
  await expect(slides.nth(2)).toHaveAttribute('aria-hidden', 'false');
  await expect.poll(() => rail.evaluate(el => Math.abs(el.scrollLeft - el.clientWidth * 3))).toBeLessThan(2);
  await expect(page.locator('.mh-banner-pause')).toHaveCount(0);
  await expect(slides.nth(2).locator('.mh-cover')).toHaveCSS('width', '72px');
  await expect(slides.nth(2).locator('.mh-banner-backdrop')).toHaveCSS('filter', 'blur(20px)');
  expect(await slides.nth(2).locator('.mh-banner-backdrop img').getAttribute('src')).toBe(await slides.nth(2).locator('.mh-cover img').getAttribute('src'));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path: info.outputPath('verified-banner.png')});
  await slides.nth(2).click();
  await expect(page).toHaveURL(base + `/book/${books[2].id}`);
  await expect(page.locator('.book-detail')).toBeVisible();
  await page.goBack();
  await expect(slides).toHaveCount(3);
});

test('automatic rotation always moves left across the last-to-first seam and respects focus and reduced motion', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.goto(base); const slides = page.locator('.mh-banner-track .mh-banner:not([data-banner-clone])');
  await expect(slides).toHaveCount(3);
  await page.locator('.mh-banner-track').evaluate(rail => {
    const samples: number[] = [rail.scrollLeft];
    (window as typeof window & {bannerSamples: number[]}).bannerSamples = samples;
    rail.addEventListener('scroll', () => samples.push(rail.scrollLeft));
  });
  await expect(slides.nth(1)).toHaveAttribute('aria-hidden', 'false', {timeout: 10000});
  await expect(slides.nth(2)).toHaveAttribute('aria-hidden', 'false', {timeout: 10000});
  await expect(slides.nth(0)).toHaveAttribute('aria-hidden', 'false', {timeout: 10000});
  await expect.poll(() => page.locator('.mh-banner-track').evaluate(el => Math.abs(el.scrollLeft - el.clientWidth))).toBeLessThan(2);
  const motion = await page.locator('.mh-banner-track').evaluate(rail => {
    const samples = (window as typeof window & {bannerSamples: number[]}).bannerSamples;
    const changes = samples.slice(1).map((left, i) => left - samples[i]);
    return {backwards: changes.filter(delta => delta < -1), width: rail.clientWidth};
  });
  // The only backward movement is the instantaneous recenter between identical
  // copies, exactly three slide widths; no animated rewind across other books.
  expect(motion.backwards).toHaveLength(1);
  expect(motion.backwards[0]).toBeCloseTo(-motion.width * 3, 0);
  await slides.nth(0).focus();
  const current = await page.locator('.mh-banner-dots [aria-pressed=true]').getAttribute('aria-label');
  await page.waitForTimeout(6500);
  expect(await page.locator('.mh-banner-dots [aria-pressed=true]').getAttribute('aria-label')).toBe(current);
  await page.emulateMedia({reducedMotion: 'reduce'});
  await slides.nth(0).evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.waitForTimeout(6500);
  expect(await page.locator('.mh-banner-dots [aria-pressed=true]').getAttribute('aria-label')).toBe(current);
  await slides.nth(0).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(slides.nth(2)).toHaveAttribute('aria-hidden', 'false');
  await expect.poll(() => page.locator('.mh-banner-track').evaluate(el => Math.abs(el.scrollLeft - el.clientWidth * 3))).toBeLessThan(2);
  await page.setViewportSize({width: 767, height: 844});
  await expect.poll(() => page.locator('.mh-banner-track').evaluate(el => Math.abs(el.scrollLeft - el.clientWidth * 3))).toBeLessThan(2);
});
