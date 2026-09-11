import {test, expect} from '@playwright/test';

const base = 'http://127.0.0.1:3000', book = '000000000000000000000101';

for (const mode of ['horizontal', 'vertical', 'scroll']) {
  test(`catalog backdrops never paint over a revealed ${mode} chapter`, async ({browser}, testInfo) => {
    const context = await browser.newContext({viewport: {width: 393, height: 851}, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true});
    const page = await context.newPage();
    try {
      await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
      await page.addInitScript(mode => {
        localStorage.setItem('has-seen-reading-hint', 'true');
        localStorage.setItem('reader_themeColor', '"green"');
        localStorage.setItem('reader_turnMode', JSON.stringify(mode));
        Object.assign(window, {catalogFrames: []});
        let generation = 0;
        window.addEventListener('chapter-entry-start', () => {
          const run = ++generation, frames: {covered: boolean; catalog: boolean; ready: boolean}[] = [];
          Object.assign(window, {catalogFrames: frames});
          let remaining = 240;
          const sample = () => {
            if (run !== generation) return;
            const cover = document.querySelector('.chapter-loading-page');
            const catalog = [...document.querySelectorAll('.book-catalog-overlay')].some(element => {
              const box = element.getBoundingClientRect(), style = getComputedStyle(element);
              return box.width > 0 && box.height > 0 && style.visibility === 'visible' && Number(style.opacity) > 0;
            });
            frames.push({covered: Boolean(cover && getComputedStyle(cover).visibility === 'visible'), catalog,
              ready: [...document.querySelectorAll('[data-reader-ready=true]')].some(element => element.getBoundingClientRect().width > 0)});
            if (--remaining) requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        });
      }, mode);
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', {rate: 4});
      await page.goto(`${base}/book/${book}`);
      // Keep the ordinary exit fade long enough to exercise the race even on
      // slower CI. Neither the reader nor requestAnimationFrame is paused.
      await page.addStyleTag({content: '.book-catalog-overlay,.book-catalog-sheet {transition-duration:800ms}'});
      for (const origin of ['details-cold', 'reader', 'details-cached', 'details-cached-again']) {
        if (origin === 'reader') {
          await page.keyboard.press('m');
          await page.locator('.reader-tools:visible').getByRole('button', {name: '目录', exact: true}).click();
        } else {
          if (origin !== 'details-cold') {
            await page.goBack();
            await expect(page).toHaveURL(`${base}/book/${book}`);
            await expect(page.locator('html')).not.toHaveAttribute('data-book-transition', /.+/);
          }
          await page.getByRole('button', {name: /^目录 /}).click();
        }
        const dialog = page.getByRole('dialog', {name: '全部目录'});
        await expect(dialog.getByRole('region')).toHaveAttribute('aria-busy', 'false');
        await expect.poll(() => dialog.evaluate(element => getComputedStyle(element).transform)).toBe('matrix(1, 0, 0, 1, 0, 0)');
        const link = dialog.locator('.book-catalog-chapter').nth(origin === 'reader' ? 2 : 1);
        const href = await link.getAttribute('href');
        await link.tap();
        await expect(page).toHaveURL(base + href);
        await expect(page.locator('.chapter-loading-page')).toHaveCount(0);
        await page.waitForTimeout(900);
        const frames = await page.evaluate(() => (window as unknown as {catalogFrames: {covered: boolean; catalog: boolean; ready: boolean}[]}).catalogFrames);
        await testInfo.attach(origin, {body: JSON.stringify(frames), contentType: 'application/json'});
        expect(frames.some(frame => frame.covered)).toBe(true);
        expect(frames.some(frame => !frame.covered && frame.ready)).toBe(true);
        expect(frames.filter(frame => !frame.covered && frame.catalog), `${origin}: no fading catalog may darken the revealed text`).toEqual([]);
      }
    } finally {await context.close();}
  });
}

test('a pointer-inert catalog backdrop still blocks the loading-to-text handoff', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.addInitScript(() => localStorage.setItem('has-seen-reading-hint', 'true'));
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto(`${base}/book/${book}`);
  await page.getByRole('button', {name: /^目录 /}).click();
  // Reproduce a still-painted exit backdrop that hit testing cannot detect.
  const hold = await page.addStyleTag({content: '.reader-entry-content .book-catalog-overlay {visibility:visible!important;opacity:.5!important;pointer-events:none!important}'});
  await page.getByRole('dialog', {name: '全部目录'}).locator('.book-catalog-chapter').nth(1).click();
  await expect(page.locator('.reader-pages-root')).toHaveAttribute('data-reader-ready', 'true');
  await page.waitForTimeout(300);
  await expect(page.locator('.chapter-loading-page')).toBeVisible();
  await hold.evaluate(element => element.remove());
  await expect(page.locator('.chapter-loading-page')).toHaveCount(0);
  await expect(page.locator('.reader-text-window')).toBeVisible();
});
