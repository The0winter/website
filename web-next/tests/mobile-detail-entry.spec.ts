import {test, expect, type Page} from '@playwright/test';

const base = process.env.ENTRY_BASE_URL || 'http://127.0.0.1:3000';
const book = process.env.ENTRY_BOOK_ID || '000000000000000000000101';
const chapter = process.env.ENTRY_CHAPTER_ID || '000000000000000000000102';
const detail = `${base}/book/${book}`, href = `/book/${book}/${chapter}`;

async function setup(page: Page, width: number) {
  await page.setViewportSize({width, height: 844});
  await page.addInitScript(({book, chapter}) => {
    localStorage.setItem('reader-recent-chapters:v1', JSON.stringify([[book, chapter]]));
    localStorage.setItem('has-seen-reading-hint', 'true');
    Object.defineProperty(navigator, 'connection', {value: {saveData: true, addEventListener() {}, removeEventListener() {}}});
  }, {book, chapter});
  await page.route('**/api/books/*/views', route => route.fulfill({json: {success: true, counted: false}}));
  await page.goto(detail);
  await expect(page.locator('.read-now:visible')).toHaveText('继续阅读');
}

async function entryLink(page: Page, origin: string) {
  if (origin === 'continue') return page.locator('.read-now:visible');
  await page.getByRole('button', {name: /^目录 /}).click();
  const sheet = page.getByRole('dialog', {name: '全部目录'});
  await expect(sheet.getByRole('region')).toHaveAttribute('aria-busy', 'false');
  await expect.poll(() => sheet.evaluate(element => getComputedStyle(element).transform)).toBe('matrix(1, 0, 0, 1, 0, 0)');
  expect(await sheet.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(244, 236, 230)');
  return sheet.locator(`a[href="${href}"]`);
}

for (const width of [320, 390]) for (const origin of ['continue', 'catalog']) {
  test(`${width}px detail ${origin} preserves its source during a 400ms slide and repeats with a cached chapter`, async ({page}, testInfo) => {
    await setup(page, width);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const cached of [false, true]) {
      const link = await entryLink(page, origin);
      let release!: () => void;
      const gate = new Promise<void>(resolve => {release = resolve;});
      if (!cached) await page.route(`**${href}?_rsc=*`, async route => {await gate; await route.continue();});
      try {
        await link.click();
        const loader = page.locator('.chapter-loading-page');
        await expect(loader).toHaveAttribute('data-entry-motion', origin === 'catalog' ? 'catalog' : 'enter');
        // Pause an actual browser animation midway, including on a cached route.
        const motion = await page.evaluate(origin => {
          const element = document.querySelector(origin === 'catalog' ? '.chapter-catalog-snapshot' : '.chapter-loading-page')!;
          const animation = element.getAnimations()[0];
          if (!animation) return null;
          animation.pause(); animation.currentTime = 160;
          return {duration: animation.effect!.getTiming().duration, easing: animation.effect!.getTiming().easing};
        }, origin);
        expect(motion).toEqual({duration: 400, easing: 'cubic-bezier(0.22, 0.7, 0.25, 1)'});
        await expect(page.locator('.chapter-entry-snapshot')).toHaveCount(1);
        const moving = page.locator(origin === 'catalog' ? '.chapter-catalog-snapshot' : '.chapter-loading-page');
        const x = await moving.evaluate(element => element.getBoundingClientRect().x);
        expect(x).toBeGreaterThan(0); expect(x).toBeLessThan(width + 24);
        if (origin === 'catalog') {
          expect(await moving.evaluate(element => ({background: getComputedStyle(element).backgroundColor, shadow: getComputedStyle(element).boxShadow})))
            .toEqual({background: 'rgba(0, 0, 0, 0)', shadow: 'none'});
          if (cached) await expect(loader).toHaveAttribute('data-text-revealed', 'true');
        } else await expect(loader).toHaveAttribute('data-text-revealed', 'false');
        await testInfo.attach(`${origin}-${cached ? 'cached' : 'slow'}-mid-slide`, {body: await page.screenshot({path: testInfo.outputPath(`${origin}-${cached}-mid-slide.png`)}), contentType: 'image/png'});
        await moving.evaluate(element => element.getAnimations()[0].play());
        await expect(page.locator('.chapter-entry-snapshot')).toHaveCount(0);
        if (!cached) {
          await expect(loader).toHaveAttribute('data-text-revealed', 'false');
          await expect(loader).toBeVisible();
        }
        release();
        await expect(loader).toHaveCount(0);
        await expect(page).toHaveURL(`${base}${href}`);
        await expect(page.locator('.reader-pages-root:visible')).toHaveAttribute('data-reader-ready', 'true');
        await testInfo.attach(`${origin}-${cached ? 'cached' : 'slow'}-ready`, {body: await page.screenshot({path: testInfo.outputPath(`${origin}-${cached}-ready.png`)}), contentType: 'image/png'});
        await page.goBack();
        await expect(page).toHaveURL(detail);
        await expect(page.locator('.book-detail:visible')).toBeVisible();
        await expect(page.locator('.book-transition-snapshot')).toHaveCount(0);
      } finally {release(); await page.unroute(`**${href}?_rsc=*`);}
    }
    expect(errors).toEqual([]);
  });
}

for (const origin of ['continue', 'catalog']) {
  test(`Back cancels the mobile detail ${origin} animation and its pending loader`, async ({page}) => {
    await setup(page, 390);
    const link = await entryLink(page, origin);
    await link.click();
    await expect(page.locator('.chapter-loading-page')).toHaveCount(1);
    await page.goBack();
    await expect(page).toHaveURL(detail);
    await expect(page.locator('.chapter-loading-page,.chapter-entry-snapshot')).toHaveCount(0);
    await expect(page.locator('.book-detail:visible')).toBeVisible();
  });
}

test('mobile detail entry respects reduced motion', async ({page}) => {
  await page.emulateMedia({reducedMotion: 'reduce'});
  await setup(page, 390);
  await page.locator('.read-now:visible').click();
  await expect(page.locator('.chapter-entry-snapshot')).toHaveCount(0);
  await expect(page.locator('.chapter-loading-page')).toHaveCount(0);
  await expect(page.locator('.reader-pages-root:visible')).toHaveAttribute('data-reader-ready', 'true');
});
