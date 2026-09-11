import {test, expect, type Page} from '@playwright/test';

const base = 'http://127.0.0.1:3000', book = '000000000000000000000101';
const chapter = '000000000000000000000102', detail = `${base}/book/${book}`;
const reader = (page: Page) => page.locator('.reader-pages-root:visible');
const idle = (page: Page) => expect(page.locator('html')).not.toHaveAttribute('data-book-transition', /.+/);

test.use({viewport: {width: 390, height: 844}, hasTouch: true});
test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem('has-seen-reading-hint', 'true');
    Object.defineProperty(navigator, 'connection', {value: {saveData: true, addEventListener() {}, removeEventListener() {}}});
  });
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
});

for (const origin of ['details', 'shelf']) {
  test(`reader return to ${origin} takes 400ms for the button and browser Back`, async ({page}) => {
    await page.addInitScript(() => {
      const durations: number[] = []; Object.assign(window, {readerExitDurations: durations});
      const animate = Element.prototype.animate;
      Element.prototype.animate = function(keyframes, options) {
        if (this.classList.contains('book-transition-snapshot') && this.getAttribute('data-motion') === 'exit') {
          durations.push(typeof options === 'number' ? options : Number(options?.duration));
        }
        return animate.call(this, keyframes, options);
      };
    });
    if (origin === 'shelf') {
      const user = {id: '000000000000000000000001', username: '返回动画验证', role: 'reader'};
      await page.route('**/api/auth/session', route => route.fulfill({json: {user, profile: user}}));
      await page.route('**/api/users/*/library?*', route => route.fulfill({json: [{bookId: book, book: {id: book, title: '山海行记'}, firstChapterId: book}]}));
      await page.route('**/api/users/*/history', route => route.fulfill({json: {success: true}}));
    }
    const destination = origin === 'shelf' ? `${base}/library` : detail;
    await page.goto(destination);
    for (const action of ['button', 'back']) {
      await (origin === 'shelf' ? page.locator('.shelf-book') : page.getByRole('link', {name: '立即阅读', exact: true})).click();
      await expect(reader(page)).toHaveAttribute('data-reader-ready', 'true'); await idle(page);
      if (action === 'button') {await page.keyboard.press('m'); await page.locator('.reader-return:visible').click();}
      else await page.goBack();
      await expect(page).toHaveURL(destination); await idle(page);
    }
    expect(await page.evaluate(() => (window as unknown as {readerExitDurations: number[]}).readerExitDurations)).toEqual([400, 400]);
  });
}

for (const mode of ['horizontal', 'vertical', 'scroll']) {
  test(`detail catalog stays on screen until a single ready ${mode} reader handoff`, async ({page}) => {
    await page.addInitScript(mode => localStorage.setItem('reader_turnMode', JSON.stringify(mode)), mode);
    await page.goto(detail);
    // Cover both the first visit and re-entering after a return to details.
    for (let visit = 0; visit < 2; visit++) {
      await page.getByRole('button', {name: /^目录 /}).click();
      let release!: () => void; const gate = new Promise<void>(resolve => {release = resolve;});
      const target = visit ? '000000000000000000000103' : chapter;
      const pattern = `**/book/${book}/${target}?_rsc=*`;
      await page.route(pattern, async route => {await gate; await route.continue();});
      const hold = await page.addStyleTag({content: '.reader-entry-content {visibility:hidden!important}'});
      try {
        await page.getByRole('dialog', {name: '全部目录'}).locator(`a[href="/book/${book}/${target}"]`).tap();
        const guard = page.locator('.chapter-loading-page');
        await expect(guard).toHaveAttribute('data-loading-visible', 'false');
        await page.waitForTimeout(350);
        await expect(guard).toHaveAttribute('data-loading-visible', 'false');
        await expect(page.locator('.chapter-entry-snapshot')).toBeVisible();
        release();
        await expect(page.locator('.reader-pages-root')).toHaveAttribute('data-reader-ready', 'true');
        await page.waitForTimeout(250);
        await expect(guard).toHaveAttribute('data-loading-visible', 'false');
        const result = page.evaluate(() => new Promise<{covered: boolean; surface: boolean; ready: boolean}[]>(resolve => {
          const frames: {covered: boolean; surface: boolean; ready: boolean}[] = [];
          let remaining = 45;
          const sample = () => {
            const root = document.querySelector('.reader-pages-root');
            const guard = document.querySelector('.chapter-loading-page');
            const frame = root?.querySelector('.reader-frame')?.getBoundingClientRect();
            frames.push({covered: Boolean(document.querySelector('.chapter-entry-snapshot')), surface: guard?.getAttribute('data-loading-visible') === 'true', ready: root?.getAttribute('data-reader-ready') === 'true' && frame?.top === 0 && Boolean(frame?.height)});
            if (--remaining) requestAnimationFrame(sample); else resolve(frames);
          }; requestAnimationFrame(sample);
        }));
        await hold.evaluate(element => (element as HTMLElement).remove());
        const frames = await result;
        expect(frames.some(frame => !frame.covered)).toBe(true);
        expect(frames.every(frame => !frame.surface && (frame.covered || frame.ready))).toBe(true);
        await expect(guard).toHaveCount(0);
        await expect(reader(page)).toHaveAttribute('data-reader-chapter', target);
        await page.goBack(); await expect(page).toHaveURL(detail); await idle(page);
      } finally {release(); await page.unroute(pattern); await hold.evaluate(element => (element as HTMLElement).remove()).catch(() => {});}
    }
  });
}

test('a catalog captured during its slide stays still instead of replaying the slide', async ({page}) => {
  // Keep the closed snapshot inspectable for this visual-state regression.
  await page.addInitScript(() => {
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function(options) {return attach.call(this, {...options, mode: 'open'});};
  });
  await page.goto(detail);
  await page.getByRole('button', {name: /^目录 /}).click();
  await page.getByRole('dialog', {name: '全部目录'}).getByRole('link').first().waitFor();
  let release!: () => void; const gate = new Promise<void>(resolve => {release = resolve;});
  await page.route(`**/book/${book}/${chapter}?_rsc=*`, async route => {await gate; await route.continue();});
  try {
    const original = await page.evaluate(({book, chapter}) => {
      const sheet = document.querySelector<HTMLElement>('.book-catalog-sheet')!;
      sheet.style.transition = 'none'; sheet.style.transform = 'translateX(32px)';
      const box = sheet.getBoundingClientRect();
      document.querySelector<HTMLAnchorElement>(`.book-catalog-sheet a[href="/book/${book}/${chapter}"]`)!.click();
      return {x: box.x, width: box.width};
    }, {book, chapter});
    const snapshot = page.locator('.chapter-entry-snapshot .book-catalog-sheet');
    await expect(snapshot).toHaveCSS('transition-duration', '0s');
    const captured = (await snapshot.boundingBox())!;
    expect(captured.x).toBe(original.x); expect(captured.width).toBe(original.width);
    await page.waitForTimeout(350);
    expect(await snapshot.boundingBox()).toEqual(captured);
    release(); await expect(page.locator('.chapter-loading-page')).toHaveCount(0);
  } finally {release();}
});
