import {test, expect, type Page} from '@playwright/test';

const base = 'http://127.0.0.1:3000', book = '000000000000000000000101';
const first = '000000000000000000000101', second = '000000000000000000000102';
const detail = `${base}/book/${book}`, reader = `${detail}/${first}`;
const idle = (page: Page) => expect(page.locator('html')).not.toHaveAttribute('data-book-transition', /.+/);
const details = async (page: Page) => { await expect(page).toHaveURL(detail); await expect(page.locator('.book-detail:visible')).toBeVisible(); await idle(page); };
const home = async (page: Page) => { await expect(page).toHaveURL(`${base}/`); await idle(page); await expect(page.locator('.mobile-home')).toBeVisible(); };
const ready = async (page: Page, id = first) => { await expect(page.locator('.reader-pages-root:visible')).toHaveAttribute('data-reader-chapter', id); await expect(page.locator('.reader-pages-root:visible')).toHaveAttribute('data-reader-ready', 'true'); await idle(page); await expect(page.locator('.chapter-loading-page')).toHaveCount(0); };

test.beforeEach(async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.addInitScript(() => localStorage.setItem('has-seen-reading-hint', 'true'));
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
});

for (const width of [390, 1440]) {
  test(`home loader slides in before details are ready and keeps reader → details → home at ${width}px`, async ({page}) => {
    await page.setViewportSize({width, height: 844});
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'connection', {value: {saveData: true, addEventListener() {}, removeEventListener() {}}});
      const original = Element.prototype.animate;
      const animations: unknown[] = [];
      (window as Window & {bookAnimations?: unknown[]}).bookAnimations = animations;
      Element.prototype.animate = function(keyframes, options) {
        if (this.classList.contains('book-transition-snapshot')) animations.push({
          path: location.pathname,
          direction: document.documentElement.dataset.bookTransition,
          loading: this.classList.contains('book-navigation-loading'),
          duration: typeof options === 'object' ? options.duration : options,
          keyframes,
          detailReady: Boolean(document.querySelector('.book-detail')?.getBoundingClientRect().width),
        });
        return original.call(this, keyframes, options);
      };
    });
    await page.goto(base); await idle(page);
    const length = await page.evaluate(() => history.length);
    let requested = false;
    await page.route(`**/book/${book}?_rsc=*`, async route => {
      requested = true;
      await new Promise(resolve => setTimeout(resolve, 650));
      await route.continue();
    });
    await page.locator(width < 768 ? '.mobile-home' : '.desktop-home').locator(`a[href="/book/${book}"]:visible`).first().click();
    await expect.poll(() => requested).toBe(true);
    await expect(page.locator('html')).toHaveAttribute('data-book-transition-phase', 'loading');
    await expect(page.locator('.book-transition-snapshot')).toHaveCount(2);
    await expect(page.locator('.book-navigation-loading')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await details(page);
    expect(await page.evaluate(() => history.length)).toBe(length + 1);
    expect(await page.evaluate(() => (window as Window & {bookAnimations?: unknown[]}).bookAnimations)).toEqual([{
      path: '/', direction: 'enter', detailReady: false, loading: true, duration: 400,
      keyframes: [{transform: 'translateX(100%)'}, {transform: 'translateX(0)'}],
    }]);
    await page.getByRole('link', {name: width < 768 ? '立即阅读' : '开始阅读', exact: true}).click(); await ready(page);
    await page.goBack(); await details(page);
    await page.goBack(); await expect(page).toHaveURL(`${base}/`); await idle(page);
    await expect(page.locator(width < 768 ? '.mobile-home' : '.desktop-home')).toBeVisible();
    await expect(page.locator('.book-transition-snapshot')).toHaveCount(0);
    await page.goForward(); await details(page);
    await page.goBack(); await expect(page).toHaveURL(`${base}/`); await idle(page);
    expect(await page.evaluate(() => history.length)).toBe(length + 2);
  });
}

for (const origin of ['/ranking', '/search?q=山海', '/author/000000000000000000000001']) {
  for (const width of [320, 1440]) {
    test(`${origin} slides the white loader over the source and reveals details without another motion at ${width}px`, async ({page}, info) => {
      await page.setViewportSize({width, height: 844});
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'connection', {value: {saveData: true, addEventListener() {}, removeEventListener() {}}});
        const original = Element.prototype.animate;
        const motions: unknown[] = [];
        Object.assign(window, {entryMotions: motions});
        Element.prototype.animate = function(frames, options) {
          const animation = original.call(this, frames, options);
          if (this.classList.contains('book-transition-snapshot')) {
            motions.push({loading: this.classList.contains('book-navigation-loading'), duration: typeof options === 'object' ? options.duration : options});
            // Hold a real intermediate frame to inspect the source underneath.
            animation.pause(); animation.currentTime = 100;
          }
          return animation;
        };
      });
      await page.goto(base + origin);
      const link = page.locator(`a[href="/book/${book}"]:visible`).first();
      await expect(link).toBeVisible();
      let release!: () => void;
      const gate = new Promise<void>(resolve => {release = resolve;});
      await page.route(`**/book/${book}?_rsc=*`, async route => {await gate; await route.continue();});
      try {
        await link.click();
        const loader = page.locator('.book-navigation-loading');
        await expect(loader).toBeVisible();
        await expect(loader).toHaveCSS('background-color', 'rgb(255, 255, 255)');
        const x = await loader.evaluate(element => element.getBoundingClientRect().left);
        expect(x).toBeGreaterThan(0); expect(x).toBeLessThan(width);
        await expect(page.locator('.book-transition-snapshot')).toHaveCount(2);
        await page.screenshot({path: info.outputPath('loader-sliding.png')});
        await loader.evaluate(element => element.getAnimations().forEach(animation => animation.finish()));
        await expect(loader).toBeVisible();
        release(); await details(page);
        await expect(page.locator('.book-transition-snapshot')).toHaveCount(0);
        expect(await page.evaluate(() => (window as unknown as {entryMotions: unknown[]}).entryMotions)).toEqual([{loading: true, duration: 400}]);
        await page.screenshot({path: info.outputPath('detail-ready.png')});
      } finally {release();}
    });
  }
}

test('Back during the ranking loader slide cancels the pending request and both overlays', async ({page}) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'connection', {value: {saveData: true, addEventListener() {}, removeEventListener() {}}}));
  await page.goto(base + '/search');
  await page.goto(base + '/ranking');
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  await page.route(`**/book/${book}?_rsc=*`, async route => {await gate; await route.continue();});
  try {
    await page.locator(`a[href="/book/${book}"]:visible`).first().click();
    await expect(page.locator('.book-navigation-loading')).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(base + '/search'); await idle(page);
    await expect(page.locator('.book-transition-snapshot')).toHaveCount(0);
    release(); await page.waitForTimeout(500);
    await expect(page).toHaveURL(base + '/search');
  } finally {release();}
});

for (const origin of ['direct details', 'search', 'direct reader', 'legacy reader']) {
  test(`${origin}: Back always follows reader, details, home without re-entering a chapter`, async ({page}) => {
    if (origin === 'search') await page.goto(`${base}/search`);
    await page.goto(origin.includes('reader') ? reader : detail);
    if (origin === 'legacy reader') {
      await ready(page);
      await page.evaluate(bookId => {
        const state = {...history.state, readerBook: bookId}; delete state.bookNavigation;
        history.replaceState(state, '', location.href);
      }, book);
      await page.reload();
    }
    if (origin.includes('reader')) { await ready(page); await page.goBack(); }
    await details(page);
    for (let visit = 0; visit < 4; visit++) {
      await page.getByRole('link', {name: '立即阅读', exact: true}).click();
      await ready(page);
      await page.goBack(); await details(page);
    }
    await page.goBack(); await home(page);
    await page.goForward(); await details(page);
    await page.goBack(); await home(page);
  });
}

test('Back cancels a slow home-to-detail animation on home before leaving for the previous page', async ({page}) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'connection', {value: {saveData: true, addEventListener() {}, removeEventListener() {}}}));
  await page.goto(`${base}/search`);
  await page.getByRole('link', {name: '返回首页', exact: true}).click(); await home(page);
  let requested = false;
  await page.route(`**/book/${book}?_rsc=*`, async route => {
    requested = true;
    await new Promise(resolve => setTimeout(resolve, 1200));
    await route.continue();
  });
  await page.locator(`.mobile-home a[href="/book/${book}"]`).first().click();
  await expect.poll(() => requested).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('data-book-transition-phase', 'loading');
  await page.goBack(); await home(page);
  await expect(page.locator('.book-transition-snapshot')).toHaveCount(0);
  await page.waitForTimeout(1400);
  await home(page);
  await page.goBack(); await expect(page).toHaveURL(`${base}/search`);
});

test('reader entry uses chapter loading and exit slides back after details are ready', async ({page}) => {
  await page.addInitScript(() => {
    const original = Element.prototype.animate;
    (window as Window & {bookAnimations?: unknown[]}).bookAnimations = [];
    Element.prototype.animate = function(keyframes, options) {
      if (this.classList.contains('book-transition-snapshot')) {
        (window as Window & {bookAnimations?: unknown[]}).bookAnimations?.push({
          direction: document.documentElement.dataset.bookTransition,
          keyframes,
          readerReady: [...document.querySelectorAll('[data-reader-ready="true"]')].some(element => element.getBoundingClientRect().width > 0),
        });
      }
      return original.call(this, keyframes, options);
    };
  });
  await page.goto(detail); await details(page);
  await page.route(`**/book/${book}/${first}?_rsc=*`, async route => { await new Promise(resolve => setTimeout(resolve, 650)); await route.continue(); });
  await page.getByRole('link', {name: '立即阅读', exact: true}).click(); await ready(page);
  await page.keyboard.press('Control+ArrowRight'); await ready(page, second);
  await page.keyboard.press('m'); await page.locator('.reader-return:visible').click(); await details(page);
  await expect(page.getByRole('link', {name: '继续阅读', exact: true})).toHaveAttribute('href', `/book/${book}/${second}`);
  const animations = await page.evaluate(() => (window as Window & {bookAnimations?: unknown[]}).bookAnimations);
  expect(animations).toEqual([
    {direction: 'exit', keyframes: [{transform: 'translateX(0)'}, {transform: 'translateX(100%)'}], readerReady: false},
  ]);
});

for (const width of [390, 1440]) {
  test(`catalog slides, Back only closes it, and selecting a chapter preserves the return stack at ${width}px`, async ({page}) => {
    await page.setViewportSize({width, height: 844});
    await page.goto(detail); await details(page);
    const open = page.getByRole('button', {name: width < 768 ? /^目录 连载/ : /^查看完整目录/});
    const dialog = page.getByRole('dialog', {name: '全部目录'});
    const historyLength = await page.evaluate(() => history.length);
    for (const close of ['back', 'button', 'escape']) {
      await open.click(); await expect(dialog).toBeVisible();
      await expect.poll(() => dialog.evaluate(element => getComputedStyle(element).transform)).toBe('matrix(1, 0, 0, 1, 0, 0)');
      expect(await dialog.evaluate(element => getComputedStyle(element).transitionProperty)).toBe('transform');
      if (close === 'back') await page.goBack();
      else if (close === 'button') await dialog.getByRole('button', {name: '关闭目录'}).click();
      else await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible(); await details(page);
      expect(await page.evaluate(() => history.length)).toBe(historyLength + 1);
    }
    await open.click(); await expect(dialog).toBeVisible();
    await dialog.getByRole('link', {name: '第12章 山间来信', exact: true}).click();
    await ready(page, '00000000000000000000010c');
    await page.goBack(); await details(page); await expect(dialog).not.toBeVisible();
    await page.goBack(); await expect(page).toHaveURL(`${base}/`); await idle(page);
  });
}

test('catalog forward and refresh restore a closable catalog without duplicate entries', async ({page}) => {
  await page.goto(detail); await details(page);
  await page.getByRole('button', {name: /^目录 连载/}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.goBack(); await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.goForward(); await expect(page.getByRole('dialog')).toBeVisible();
  const length = await page.evaluate(() => history.length);
  await page.reload(); await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.evaluate(() => history.length)).toBe(length);
  await page.goBack(); await expect(page.getByRole('dialog')).not.toBeVisible(); await details(page);
  await page.goBack(); await home(page);
});

for (const mode of ['fallback', 'reduced motion']) {
  test(`${mode} keeps navigation usable with no leftover overlay`, async ({page}) => {
    if (mode === 'fallback') await page.addInitScript(() => Object.defineProperty(document, 'startViewTransition', {value: undefined}));
    else await page.emulateMedia({reducedMotion: 'reduce'});
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(detail); await details(page);
    await page.getByRole('link', {name: '立即阅读', exact: true}).click(); await ready(page);
    await page.goBack(); await details(page);
    await expect(page.locator('.book-transition-snapshot')).toHaveCount(0);
    await page.goBack(); await home(page); expect(errors).toEqual([]);
  });
}

test('Back during a slow entry and repeated Back cannot resurrect a pending reader', async ({page}) => {
  let delayedEntries = 0;
  await page.addInitScript(() => Object.defineProperty(navigator, 'connection', {value: {saveData: true, addEventListener() {}, removeEventListener() {}}}));
  await page.goto(detail); await details(page);
  await page.route(`**/book/${book}/${first}?_rsc=*`, async route => { delayedEntries++; await new Promise(resolve => setTimeout(resolve, 1500)); await route.continue(); });
  await page.getByRole('link', {name: '立即阅读', exact: true}).click();
  await expect(page.locator('.chapter-loading-page')).toBeVisible();
  await expect.poll(() => delayedEntries).toBeGreaterThan(0);
  await page.goBack(); await home(page);
  await page.waitForTimeout(1700); await home(page);
  await expect(page.locator('.book-transition-snapshot')).toHaveCount(0);
  await page.unroute(`**/book/${book}/${first}?_rsc=*`);
  await page.goto(detail); await details(page);
  await page.getByRole('button', {name: /^目录 连载/}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  delayedEntries = 0;
  await page.route(`**/book/${book}/00000000000000000000010c?_rsc=*`, async route => { delayedEntries++; await new Promise(resolve => setTimeout(resolve, 1200)); await route.continue(); });
  await page.getByRole('dialog').getByRole('link', {name: '第12章 山间来信', exact: true}).click();
  await expect(page.locator('.chapter-loading-page')).toBeVisible();
  await expect.poll(() => delayedEntries).toBeGreaterThan(0);
  await page.goBack(); await details(page); await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.waitForTimeout(1400); await details(page);
  await page.goBack(); await home(page);
  await page.goto(reader); await ready(page);
  await page.goBack(); await expect(page).toHaveURL(detail);
  await page.goBack(); await home(page);
});
