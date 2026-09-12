import {test, expect, type Page, type BrowserContext} from '@playwright/test';

const base = process.env.SHELF_NAVIGATION_BASE || 'http://127.0.0.1:3000';
const book = process.env.SHELF_NAVIGATION_BOOK || '000000000000000000000101';
const chapter = process.env.SHELF_NAVIGATION_CHAPTER || book;
const user = {id: '000000000000000000000001', username: '书架交互验证', role: 'reader'};
test.use({viewport: {width: 390, height: 844}, hasTouch: true});
test.setTimeout(45000);

test.beforeEach(async ({page}) => {
  await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await page.addInitScript(() => {
    localStorage.setItem('has-seen-reading-hint', 'true');
    Object.defineProperty(navigator, 'connection', {value: {saveData: true, addEventListener() {}, removeEventListener() {}}});
  });
});

async function library(page: Page, query = '') {
  await page.route('**/api/auth/session', route => route.fulfill({json: {user, profile: user}}));
  await page.route('**/api/users/*/history', route => route.fulfill({json: {success: true}}));
  await page.route('**/api/users/*/library?*', route => route.fulfill({json: [{bookId: book, book: {id: book, title: '书架里的故事', author: '作者'}, chapterId: chapter, chapterTitle: '接着上次阅读', firstChapterId: chapter}]}));
  await page.goto(base + '/library' + query);
  await expect(page.locator('.shelf-book')).toBeVisible();
}

async function swipe(page: Page, context: BrowserContext, dx: number, dy = 0) {
  const box = (await page.locator('#shelf-content').boundingBox())!;
  const x = box.x + box.width * (dx < 0 ? .8 : .2), y = box.y + 70;
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y, id: 1}]});
  for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: x + dx * i / 6, y: y + dy * i / 6, id: 1}]});
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  await cdp.detach();
}

for (const width of [320, 390, 1440]) {
  test(`swipe both tabs without opening a book, keep sorting and reset pagination at ${width}px`, async ({page, context}, info) => {
    await page.setViewportSize({width, height: 844});
    await library(page, '?sort=updated&page=2');
    const length = await page.evaluate(() => history.length);
    await swipe(page, context, -150);
    await expect(page.getByRole('tab', {name: '浏览记录'})).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(base + '/library?tab=history&sort=updated');
    await expect(page.locator('.chapter-loading-page')).toHaveCount(0);
    await expect(page.locator('.library-page')).toHaveAttribute('data-managing', 'false');
    await page.screenshot({path: info.outputPath('history.png')});
    await swipe(page, context, 150);
    await expect(page.getByRole('tab', {name: '书架', exact: true})).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(base + '/library?sort=updated');
    expect(await page.evaluate(() => history.length)).toBe(length);
    await page.screenshot({path: info.outputPath('shelf.png')});
  });
}

test('vertical scroll, short drags and management gestures do not navigate accidentally', async ({page, context}) => {
  await library(page);
  await swipe(page, context, -15, 100);
  await swipe(page, context, -25);
  await expect(page).toHaveURL(base + '/library');
  await expect(page.locator('.library-page')).toHaveAttribute('data-managing', 'false');
  await page.getByRole('button', {name: '管理', exact: true}).click();
  await page.getByRole('checkbox').click();
  await swipe(page, context, -150);
  await expect(page).toHaveURL(base + '/library?tab=history&sort=combined');
  await expect(page.locator('.library-page')).toHaveAttribute('data-managing', 'false');
  await expect(page.locator('.chapter-loading-page')).toHaveCount(0);
  await page.getByRole('tab', {name: '浏览记录'}).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', {name: '书架', exact: true})).toBeFocused();
  await expect(page).toHaveURL(base + '/library?sort=combined');
});

for (const width of [320, 390]) test(`shelf loading slides in for 400ms, preserves progress and repeats at ${width}px`, async ({page}, info) => {
  await page.setViewportSize({width, height:844});
  await page.addInitScript(id => {
    localStorage.setItem('reader_turnMode', JSON.stringify('scroll'));
    localStorage.setItem(`reader-page:${id}`, JSON.stringify({fraction: .45}));
  }, chapter);
  await library(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  await page.route(`**/book/${book}/${chapter}?_rsc=*`, async route => {await gate; await route.continue();});
  try {
    await page.locator('.shelf-book').click();
    const loader = page.locator('.chapter-loading-page');
    await expect(loader).toBeVisible();
    await expect(loader).toContainText('接着上次阅读');
    await expect(loader).toHaveAttribute('data-entry-motion', 'enter');
    const duration = await loader.evaluate(element => {
      const animation = element.getAnimations()[0];
      animation.pause(); animation.currentTime = 160;
      return animation.effect!.getTiming().duration;
    });
    expect(duration).toBe(400);
    await expect(page.locator('.chapter-entry-snapshot')).toHaveCount(1);
    const left = await loader.evaluate(element => element.getBoundingClientRect().left);
    expect(left).toBeGreaterThan(0); expect(left).toBeLessThan(width);
    await page.screenshot({path: info.outputPath('shelf-to-reader-sliding.png')});
    release();
    await expect(page.locator('.reader-pages-root:visible')).toHaveAttribute('data-reader-ready', 'true');
    await expect(loader).toHaveAttribute('data-text-revealed', 'false');
    await expect.poll(() => page.evaluate(() => Boolean(document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest('.chapter-loading-page')))).toBe(true);
    await page.screenshot({path: info.outputPath('chapter-loading.png')});
    await loader.evaluate(element => element.getAnimations()[0].play());
    await expect(loader).toHaveCount(0);
    await expect(page.locator('.reader-pages-root:visible')).toHaveAttribute('data-reader-ready', 'true');
    await expect(page.locator('[data-reader-page]:visible')).not.toContainText(/^1\//);
    await page.screenshot({path: info.outputPath('resumed.png')});
    await page.goBack();
    await expect(page).toHaveURL(base + '/library');
    await expect(page.locator('html')).not.toHaveAttribute('data-book-transition', /.+/);
    await page.locator('.shelf-book').click();
    await expect(loader).toBeVisible();
    expect(await loader.evaluate(element => element.getAnimations()[0]?.effect?.getTiming().duration)).toBe(400);
    await expect(loader).toHaveCount(0);
    await expect(page.locator('[data-reader-page]:visible')).not.toContainText(/^1\//);
  } finally {release();}
});

for (const reduced of [false, true]) test(`shelf entry supports Back cancellation and reduced motion ${reduced}`, async ({page}) => {
  await page.emulateMedia({reducedMotion: reduced ? 'reduce' : 'no-preference'});
  await library(page, '?tab=history&sort=updated');
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  await page.route(`**/book/${book}/${chapter}?_rsc=*`, async route => {await gate; await route.continue();});
  try {
    await page.locator('.shelf-book').click();
    await expect(page.locator('.chapter-loading-page')).toHaveAttribute('data-entry-motion', reduced ? 'none' : 'enter');
    if (reduced) await expect(page.locator('.chapter-entry-snapshot')).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL(base + '/library?tab=history&sort=updated');
    await expect(page.locator('.chapter-loading-page,.chapter-entry-snapshot')).toHaveCount(0);
    release();
    await expect(page.locator('.shelf-book')).toBeVisible();
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(base + '/library?tab=history&sort=updated');
  } finally {release();}
});

for (const reduced of [false, true]) {
  test(`home details replace the white loader without an extra wait on initial and cached entry, reduced motion ${reduced}`, async ({page}, info) => {
    await page.emulateMedia({reducedMotion: reduced ? 'reduce' : 'no-preference'});
    await page.goto(base);
    await page.evaluate(() => {
      const intervals: {start: number; ready?: number; end?: number; finished?: number}[] = [];
      const motions: {loading: boolean; duration: number | undefined}[] = [];
      Object.assign(window, {loadingIntervals: intervals, loadingMotions: motions});
      const animate = Element.prototype.animate;
      Element.prototype.animate = function(frames, options) {
        const animation = animate.call(this, frames, options);
        if (document.documentElement.dataset.bookTransition === 'enter' && this.classList.contains('book-transition-snapshot')) {
          motions.push({loading: this.classList.contains('book-navigation-loading'), duration: typeof options === 'object' ? options.duration as number : options});
          animation.finished.then(() => {if (intervals.at(-1)) intervals.at(-1)!.finished = performance.now();}).catch(() => {});
        }
        return animation;
      };
      new MutationObserver(() => {
        const shown = !!document.querySelector('.book-navigation-loading');
        const last = intervals.at(-1);
        if (shown && (!last || last.end !== undefined)) intervals.push({start: performance.now()});
        else if (!shown && last && last.end === undefined) last.end = performance.now();
        const interval = intervals.at(-1);
        if (interval && !interval.ready && document.querySelector('.book-detail')?.getBoundingClientRect().width) interval.ready = performance.now();
      }).observe(document.body, {childList: true, subtree: true});
    });
    for (let visit = 0; visit < 2; visit++) {
      await page.locator('.mobile-home').locator(`a[href="/book/${book}"]:visible`).first().click();
      await expect(page.locator('.book-navigation-loading')).toHaveCount(0);
      await expect(page.locator('.book-detail:visible')).toHaveAttribute('data-book-id', book);
      await page.goBack();
      await expect(page).toHaveURL(base + '/');
      await expect(page.locator('html')).not.toHaveAttribute('data-book-transition', /.+/);
    }
    const {timings, motions} = await page.evaluate(() => {
      const state = window as unknown as {loadingIntervals: {start: number; end: number; ready: number; finished?: number}[]; loadingMotions: {loading: boolean; duration: number}[]};
      return {timings: state.loadingIntervals, motions: state.loadingMotions};
    });
    expect(timings).toHaveLength(2);
    expect(motions).toEqual(reduced ? [] : Array.from({length: 2}, () => ({loading: true, duration: 400})));
    timings.forEach(timing => {
      expect(timing.end - Math.max(timing.ready, timing.finished || timing.ready)).toBeLessThan(200);
      if (!reduced) expect(timing.end - timing.start).toBeGreaterThanOrEqual(380);
    });
    await info.attach('loading-durations', {body: JSON.stringify(timings), contentType: 'application/json'});
  });
}

test('home loading stays visible beyond eight seconds and can be cancelled with Back', async ({page}) => {
  await page.goto(base + '/search');
  await page.getByRole('link', {name: '返回首页', exact: true}).click();
  await expect(page.locator('.mobile-home')).toBeVisible();
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  await page.route(`**/book/${book}?_rsc=*`, async route => {await gate; await route.continue();});
  try {
    await page.locator('.mobile-home').locator(`a[href="/book/${book}"]:visible`).first().click();
    await expect(page.locator('.book-navigation-loading')).toBeVisible();
    await page.waitForTimeout(8300);
    await expect(page.locator('.book-navigation-loading')).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(base + '/');
    await expect(page.locator('.book-navigation-loading')).toHaveCount(0);
    release();
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(base + '/');
    await page.goBack();
    await expect(page).toHaveURL(base + '/search');
  } finally {release();}
});
