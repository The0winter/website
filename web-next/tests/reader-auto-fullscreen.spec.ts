import {test, expect, type Page} from '@playwright/test';

const base = 'http://127.0.0.1:3000', book = '000000000000000000000101';
const detail = `${base}/book/${book}`, reader = `${detail}/${book}`;
const active = (page: Page) => page.evaluate(() => document.fullscreenElement === document.documentElement);
test.use({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true});

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem('has-seen-reading-hint', 'true');
    Object.defineProperty(navigator, 'connection', {value: {saveData: true, addEventListener() {}, removeEventListener() {}}});
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style'); style.textContent = 'nextjs-portal{display:none!important}'; document.head.append(style);
    });
  });
  await page.route('**/api/books/*/views', route => route.fulfill({json: {success: true, counted: false}}));
});

async function ready(page: Page) {
  await expect(page.locator('.reader-pages-root:visible')).toHaveAttribute('data-reader-ready', 'true');
  await expect(page.locator('.chapter-loading-page')).toHaveCount(0);
  await expect(page.locator('.reader-fullscreen-cover')).toHaveCount(0);
}

async function enter(page: Page, origin: string) {
  if (origin === 'shelf') {
    const user = {id: '000000000000000000000001', username: '全屏验证', role: 'reader'};
    await page.route('**/api/auth/session', route => route.fulfill({json: {user, profile: user}}));
    await page.route('**/api/users/*/history', route => route.fulfill({json: {success: true}}));
    await page.route('**/api/users/*/library?*', route => route.fulfill({json: [{bookId: book, book: {id: book, title: '书架里的故事', author: '作者'}, chapterId: book, chapterTitle: '接着上次阅读', firstChapterId: book}]}));
    await page.goto(base + '/library');
    await page.locator('#shelf-content .shelf-book').tap();
  } else {
    await page.goto(detail);
    if (origin === 'catalog') {
      await page.getByRole('button', {name: /^目录 /}).tap();
      await page.getByRole('dialog', {name: '全部目录'}).locator(`a[href="/book/${book}/${book}"]`).tap();
    } else await page.locator('.read-now:visible').tap();
  }
}

for (const origin of ['details', 'catalog', 'shelf']) {
  test(`${origin} enters fullscreen in the navigation tap and exits on return`, async ({page}) => {
    const dialogs: string[] = []; page.on('dialog', dialog => {dialogs.push(dialog.type()); void dialog.dismiss();});
    await enter(page, origin);
    await ready(page);
    expect(await active(page)).toBe(true);
    await page.touchscreen.tap(195, 420);
    await expect(page.locator('.reader-tools').getByRole('button')).toHaveCount(3);
    await expect(page.locator('.reader-fullscreen-hint [role=status]')).toHaveText('在设置中可关闭全屏模式');
    expect(dialogs).toEqual([]);
    await page.goBack();
    await expect(page).toHaveURL(origin === 'shelf' ? base + '/library' : detail);
    await expect.poll(() => active(page)).toBe(false);
    await expect(page.locator('html')).not.toHaveAttribute('data-book-transition', /.+/);
    // A fresh visit automatically enters again after the previous owner is gone.
    if (origin === 'shelf') await page.locator('#shelf-content .shelf-book').tap();
    else await page.locator('.read-now:visible').tap();
    await ready(page);
    expect(await active(page)).toBe(true);
    await expect(page.getByRole('button', {name: '不再提醒', exact: true})).toBeVisible();
  });
}

test('entry keeps the paper over resizing text and ends with a short fade', async ({page}, info) => {
  await page.addInitScript(() => {
    const original = Element.prototype.requestFullscreen;
    Object.assign(window, {releaseFullscreen: () => {}});
    Element.prototype.requestFullscreen = function(options) {
      Element.prototype.requestFullscreen = original;
      const native = original.call(this, options);
      const gate = new Promise<void>(resolve => Object.assign(window, {releaseFullscreen: resolve}));
      return native.then(() => gate);
    };
  });
  await enter(page, 'details');
  await expect.poll(() => active(page)).toBe(true);
  const cover = page.locator('.chapter-loading-page');
  await expect(cover).toHaveAttribute('data-fullscreen-entry', 'true');
  // Columns must not repeatedly paginate while the native viewport is moving.
  await expect(page.locator('.reader-pages-root:visible')).toHaveAttribute('data-reader-ready', 'false');
  await page.setViewportSize({width: 390, height: 930});
  await expect(cover).toHaveAttribute('data-text-revealed', 'false');
  await page.screenshot({path: info.outputPath('verified-covered-resize.png')});
  await page.evaluate(() => {
    const frames: {opacity: number; height: number; viewport: number}[] = [];
    Object.assign(window, {fullscreenRevealFrames: frames});
    const sample = () => {
      const cover = document.querySelector('.chapter-loading-page');
      if (!cover) return;
      if (cover.getAttribute('data-text-revealed') === 'true') frames.push({opacity: Number(getComputedStyle(cover).opacity), height: document.querySelector('.reader-frame')!.getBoundingClientRect().height, viewport: innerHeight});
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    (window as unknown as {releaseFullscreen: () => void}).releaseFullscreen();
  });
  await ready(page);
  const frames = await page.evaluate(() => (window as unknown as {fullscreenRevealFrames: {opacity: number; height: number; viewport: number}[]}).fullscreenRevealFrames);
  expect(frames.filter(frame => frame.opacity > 0 && frame.opacity < 1).length).toBeGreaterThan(1);
  expect(frames.every(frame => Math.abs(frame.height - frame.viewport) <= 1)).toBe(true);
  await info.attach('fullscreen-reveal', {body: JSON.stringify(frames), contentType: 'application/json'});
  await page.screenshot({path: info.outputPath('verified-fullscreen-reader.png')});
});

test('direct entry uses one normal reading tap and respects a later explicit exit', async ({page}) => {
  await page.goto(reader); await ready(page);
  expect(await active(page)).toBe(false);
  await page.touchscreen.tap(195, 420);
  await expect.poll(() => active(page)).toBe(true);
  await expect(page.locator('.reader-fullscreen-cover')).toHaveCount(0);
  const tools = page.locator('.reader-tools');
  await tools.getByRole('button', {name: '设置', exact: true}).tap();
  await page.getByRole('group', {name: '全屏阅读'}).getByRole('button', {name: '否', exact: true}).tap();
  await expect.poll(() => active(page)).toBe(false);
  await expect(page.locator('.reader-fullscreen-cover')).toHaveCount(0);
  await page.getByRole('button', {name: '关闭阅读设置'}).tap();
  await page.touchscreen.tap(195, 420);
  await page.touchscreen.tap(195, 420);
  expect(await active(page)).toBe(false);
  await page.reload(); await ready(page);
  await page.touchscreen.tap(195, 420);
  expect(await active(page)).toBe(false);
});

test('a denied automatic request quietly completes normal reading entry', async ({page}) => {
  await page.addInitScript(() => {Element.prototype.requestFullscreen = () => Promise.reject(new TypeError('Denied'));});
  await enter(page, 'details'); await ready(page);
  expect(await active(page)).toBe(false);
  await expect(page.locator('.reader-navigation-error')).toHaveCount(0);
  await page.touchscreen.tap(195, 420);
  await expect(page.locator('.reader-tools')).toHaveAttribute('aria-hidden', 'false');
  await expect(page.locator('.reader-fullscreen-cover')).toHaveCount(0);
  await expect(page.locator('.reader-navigation-error')).toHaveCount(0);
});

test('fullscreen paper fills the cutout area while text avoids it, and restores viewport on return', async ({page}, info) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', {insets: {top: 48, bottom: 24, left: 0, right: 0}});
  await page.goto(detail);
  const viewport = page.locator('meta[name=viewport]');
  const original = await viewport.getAttribute('content');
  await page.locator('.read-now:visible').tap(); await ready(page);
  await expect(viewport).toHaveAttribute('content', /viewport-fit=cover/);
  expect(await page.locator('.reader-frame').evaluate(el => {
    const box = el.getBoundingClientRect();
    const text = el.querySelector('.reader-text-window')!.getBoundingClientRect();
    return {top: box.top, fills: box.height === innerHeight, textTop: text.top, paper: getComputedStyle(el).backgroundColor};
  })).toEqual({top: 0, fills: true, textTop: 72, paper: 'rgb(219, 196, 158)'});
  await page.screenshot({path: info.outputPath('verified-cutout-portrait.png')});
  // Rotation moves a camera cutout to a side; pagination must keep its text clear.
  await page.setViewportSize({width: 844, height: 390});
  await cdp.send('Emulation.setSafeAreaInsetsOverride', {insets: {top: 0, bottom: 24, left: 48, right: 0}});
  await expect.poll(() => page.locator('.reader-text-window').evaluate(el => el.getBoundingClientRect().left)).toBe(68);
  await page.screenshot({path: info.outputPath('verified-cutout-landscape.png')});
  await page.evaluate(() => document.exitFullscreen());
  await expect(viewport).toHaveCount(1);
  await page.keyboard.press('m');
  await page.goBack();
  await expect(page).toHaveURL(detail);
  await expect(viewport).toHaveAttribute('content', original!);
});

test('Back during slow entry releases fullscreen before a reader has mounted', async ({page}) => {
  await page.goto(detail);
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  await page.route(`**/book/${book}/${book}?_rsc=*`, async route => {await gate; await route.continue();});
  try {
    await page.locator('.read-now:visible').tap();
    await expect.poll(() => active(page)).toBe(true);
    await page.goBack();
    await expect(page).toHaveURL(detail);
    await expect.poll(() => active(page)).toBe(false);
  } finally {release();}
});

test('slow entry covers the cutout before requesting native fullscreen and restores the source viewport on cancel', async ({page}) => {
  await page.addInitScript(() => {
    const request = Element.prototype.requestFullscreen;
    Element.prototype.requestFullscreen = function(options) {
      Object.assign(window, {requestedViewport: document.querySelector('meta[name=viewport]')?.getAttribute('content')});
      return request.call(this, options);
    };
  });
  await page.goto(detail);
  const original = await page.locator('meta[name=viewport]').getAttribute('content');
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  await page.route(`**/book/${book}/${book}?_rsc=*`, async route => {await gate; await route.continue();});
  try {
    await page.locator('.read-now:visible').tap();
    await expect.poll(() => page.evaluate(() => (window as unknown as {requestedViewport?: string}).requestedViewport)).toContain('viewport-fit=cover');
    await expect.poll(() => active(page)).toBe(true);
    const paper = await page.locator('.chapter-loading-page').evaluate(el => getComputedStyle(el).backgroundColor);
    await expect(page.locator('html')).toHaveCSS('background-color', paper);
    await page.locator('meta[name=viewport]').evaluate((meta, value) => meta.setAttribute('content', value!), original);
    await expect(page.locator('meta[name=viewport]')).toHaveAttribute('content', /viewport-fit=cover/);
    await page.goBack(); await expect(page).toHaveURL(detail);
    await expect.poll(() => active(page)).toBe(false);
    await expect(page.locator('meta[name=viewport]')).toHaveCount(1);
    await expect(page.locator('meta[name=viewport]')).toHaveAttribute('content', original!);
  } finally {release();}
});

test('reduced motion enters fullscreen without the page slide or fade', async ({page}) => {
  await page.emulateMedia({reducedMotion: 'reduce'});
  await enter(page, 'details'); await ready(page);
  expect(await active(page)).toBe(true);
  expect(await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running').length)).toBe(0);
});

test('desktop entry stays windowed and retains its manual fullscreen button', async ({page}) => {
  await page.setViewportSize({width: 1440, height: 900});
  await page.goto(detail);
  await page.getByRole('link', {name: '开始阅读', exact: true}).click();
  await ready(page);
  expect(await active(page)).toBe(false);
  await page.locator('aside').getByRole('button', {name: '全屏阅读'}).click();
  await expect.poll(() => active(page)).toBe(true);
});
