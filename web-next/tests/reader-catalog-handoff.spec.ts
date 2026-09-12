import {test, expect} from '@playwright/test';

const base = 'http://127.0.0.1:3000', book = '000000000000000000000101';

for (const mode of ['horizontal', 'vertical', 'scroll']) {
  test(`reader catalog slides without dimming while a ${mode} chapter starts loading immediately`, async ({browser}, testInfo) => {
    const context = await browser.newContext({viewport: {width: mode === 'vertical' ? 320 : 390, height: 844}, isMobile: true, hasTouch: true});
    const page = await context.newPage(), target = '00000000000000000000010c';
    let release!: () => void;
    const gate = new Promise<void>(resolve => {release = resolve;});
    try {
      await page.addInitScript(mode => {
        localStorage.setItem('has-seen-reading-hint', 'true');
        localStorage.setItem('reader_turnMode', JSON.stringify(mode));
        Object.defineProperty(navigator, 'connection', {value: {saveData: true, addEventListener() {}, removeEventListener() {}}});
      }, mode);
      await page.goto(`${base}/book/${book}/${book}`);
      await expect(page.locator('.reader-pages-root:visible')).toHaveAttribute('data-reader-ready', 'true');
      await page.touchscreen.tap((mode === 'vertical' ? 320 : 390) / 2, 422);
      const tools = page.locator('.reader-tools:visible');
      await expect(tools).toHaveAttribute('aria-hidden', 'false');
      await expect(tools.getByRole('link', {name: '详情', exact: true})).toHaveCount(0);
      await expect(tools.getByRole('button')).toHaveText(['设置', '目录', '夜间']);
      await tools.getByRole('button', {name: '目录', exact: true}).tap();
      const sheet = page.getByRole('dialog', {name: '全部目录'});
      await expect(sheet.getByRole('region')).toHaveAttribute('aria-busy', 'false');
      await expect.poll(() => sheet.evaluate(element => getComputedStyle(element).transform)).toBe('matrix(1, 0, 0, 1, 0, 0)');
      let requestDelay = Infinity;
      await page.route(`**/api/chapters/${target}?navigation=1`, async route => {
        requestDelay = await page.evaluate(() => performance.now() - (window as unknown as {catalogClick: number}).catalogClick);
        await gate; await route.continue();
      });
      await page.evaluate(() => {
        const frames: {time: number; x: number; chapters: number; loading: boolean; opacity: string; background: string; shadow: string; catalogAboveLoading: boolean}[] = [];
        Object.assign(window, {exitFrames: frames, entryDelay: 0});
        document.addEventListener('click', event => {
          if (!(event.target as Element).closest('.book-catalog-chapter')) return;
          const start = performance.now();
          Object.assign(window, {catalogClick: start});
          window.addEventListener('chapter-entry-start', () => Object.assign(window, {entryDelay: performance.now() - start}), {once: true});
          const sample = () => {
            const sheet = document.querySelector('.book-catalog-sheet')!;
            const overlay = sheet.parentElement!, cover = document.querySelector('.chapter-loading-page');
            const style = getComputedStyle(overlay);
            frames.push({time: performance.now() - start, x: sheet.getBoundingClientRect().x,
              chapters: sheet.querySelectorAll('.book-catalog-chapter').length, loading: Boolean(cover),
              opacity: style.opacity, background: style.backgroundColor, shadow: getComputedStyle(sheet).boxShadow,
              catalogAboveLoading: Boolean(cover && Number(style.zIndex) > Number(getComputedStyle(cover).zIndex))});
            if (overlay.getAttribute('data-selecting') === 'true' && frames.length < 180) requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        }, {capture: true, once: true});
      });
      await sheet.locator(`a[href$="/${target}"]`).tap();
      await expect(page.locator('.chapter-loading-page')).toHaveAttribute('data-chapter-loading', target);
      await expect(page.locator('.book-catalog-overlay[data-selecting=true]')).toHaveCount(0);
      const trace = await page.evaluate(() => {
        const state = window as unknown as {exitFrames: {time: number; x: number; chapters: number; loading: boolean; opacity: string; background: string; shadow: string; catalogAboveLoading: boolean}[]; entryDelay: number};
        return {frames: state.exitFrames, entryDelay: state.entryDelay};
      });
      await testInfo.attach('catalog-exit', {body: JSON.stringify(trace), contentType: 'application/json'});
      expect(trace.entryDelay).toBeLessThan(100);
      expect(requestDelay).toBeLessThan(250);
      expect(trace.frames.at(-1)!.time).toBeGreaterThanOrEqual(390);
      expect(trace.frames.at(-1)!.time).toBeLessThan(900);
      const moving = trace.frames.filter(frame => frame.x > 1 && frame.x < 300);
      expect(moving.length).toBeGreaterThan(2);
      expect(moving.every(frame => frame.chapters > 0 && frame.loading && frame.catalogAboveLoading
        && frame.opacity === '1' && frame.background === 'rgba(0, 0, 0, 0)' && frame.shadow === 'none')).toBe(true);
      await expect(page.locator('.book-catalog-overlay')).toBeHidden();
      release();
      await expect(page.locator('.chapter-loading-page')).toHaveCount(0);
      await expect(page.locator('.reader-pages-root:visible')).toHaveAttribute('data-reader-chapter', target);
      await expect(page.locator('.reader-pages-root:visible')).toHaveAttribute('data-reader-ready', 'true');
      await page.goBack();
      await expect(page).toHaveURL(`${base}/book/${book}`);
    } finally {release(); await context.close();}
  });
}

test('a cached chapter reveals under the still-sliding opaque catalog', async ({page}, testInfo) => {
  const target = '000000000000000000000102';
  await page.setViewportSize({width: 390, height: 844});
  await page.addInitScript(() => localStorage.setItem('has-seen-reading-hint', 'true'));
  await page.goto(`${base}/book/${book}/${book}`);
  await expect(page.locator('.reader-pages-root:visible')).toHaveAttribute('data-reader-ready', 'true');
  await expect(page.locator('.reader-pages-root:visible')).toHaveAttribute('data-reader-next', target);
  await page.keyboard.press('m');
  await page.locator('.reader-tools:visible').getByRole('button', {name: '目录', exact: true}).click();
  const sheet = page.getByRole('dialog', {name: '全部目录'});
  await expect(sheet.getByRole('region')).toHaveAttribute('aria-busy', 'false');
  await expect.poll(() => sheet.evaluate(element => getComputedStyle(element).transform)).toBe('matrix(1, 0, 0, 1, 0, 0)');
  await page.evaluate(() => {
    const frames: {time: number; x: number; revealed: boolean; active: string | null}[] = [];
    Object.assign(window, {cachedExitFrames: frames});
    window.addEventListener('chapter-entry-start', () => {
      const start = performance.now();
      const sample = () => {
        const overlay = document.querySelector('.book-catalog-overlay[data-selecting=true]');
        if (!overlay) return;
        frames.push({time: performance.now() - start, x: overlay.querySelector('.book-catalog-sheet')!.getBoundingClientRect().x,
          revealed: document.querySelector('.chapter-loading-page')?.getAttribute('data-text-revealed') === 'true',
          active: overlay.querySelector('[aria-current=location]')?.getAttribute('href') ?? null});
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }, {once: true});
  });
  await sheet.locator(`a[href$="/${target}"]`).click();
  await expect(page.locator('.book-catalog-overlay[data-selecting=true]')).toHaveCount(0);
  await expect(page.locator('.chapter-loading-page')).toHaveCount(0);
  const frames = await page.evaluate(() => (window as unknown as {cachedExitFrames: {time: number; x: number; revealed: boolean; active: string | null}[]}).cachedExitFrames);
  await testInfo.attach('cached-catalog-exit', {body: JSON.stringify(frames), contentType: 'application/json'});
  expect(frames.some(frame => frame.time < 390 && frame.x > 0 && frame.x < 390 && frame.revealed)).toBe(true);
  expect(frames.every(frame => frame.active === `/book/${book}/${book}`)).toBe(true);
  await expect(page.locator('.reader-pages-root:visible')).toHaveAttribute('data-reader-chapter', target);
});

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`reader catalog exit can be cancelled and respects ${reducedMotion}`, async ({page}) => {
    await page.setViewportSize({width: 390, height: 844});
    await page.emulateMedia({reducedMotion});
    await page.addInitScript(() => localStorage.setItem('has-seen-reading-hint', 'true'));
    await page.goto(`${base}/book/${book}/${book}`);
    await expect(page.locator('.reader-pages-root:visible')).toHaveAttribute('data-reader-ready', 'true');
    await page.keyboard.press('m');
    await page.locator('.reader-tools:visible').getByRole('button', {name: '目录', exact: true}).click();
    const sheet = page.getByRole('dialog', {name: '全部目录'});
    await expect(sheet.getByRole('region')).toHaveAttribute('aria-busy', 'false');
    await expect.poll(() => sheet.evaluate(element => getComputedStyle(element).transform)).toBe('matrix(1, 0, 0, 1, 0, 0)');
    await sheet.locator('.book-catalog-chapter').nth(1).click();
    if (reducedMotion === 'no-preference') {
      await page.goBack();
      await page.waitForTimeout(600);
      await expect(page).toHaveURL(`${base}/book/${book}`);
      await expect(page.locator('.chapter-loading-page')).toHaveCount(0);
      await expect(page.locator('.book-catalog-overlay[data-selecting=true]')).toHaveCount(0);
      return;
    }
    await expect(page).toHaveURL(`${base}/book/${book}/000000000000000000000102`);
    await expect(page.locator('.chapter-loading-page')).toHaveCount(0);
  });
}

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
              return box.width > 0 && box.height > 0 && style.visibility === 'visible' && Number(style.opacity) > 0
                && style.backgroundColor !== 'rgba(0, 0, 0, 0)';
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
  await expect(page.locator('.reader-pages-root:visible')).toHaveAttribute('data-reader-ready', 'true');
  await page.waitForTimeout(300);
  await expect(page.locator('.chapter-loading-page')).toBeVisible();
  await hold.evaluate(element => element.parentNode?.removeChild(element));
  await expect(page.locator('.chapter-loading-page')).toHaveCount(0);
  await expect(page.locator('.reader-text-window')).toBeVisible();
});
