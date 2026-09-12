import {test, expect, type Page} from '@playwright/test';

const base = process.env.HOME_SHORTCUT_BASE || 'http://127.0.0.1:3000';
const books = [{id: '000000000000000000000101', title: '入口测试作品', author: '测试作者', description: '加载与返回验证', category: '玄幻'}];
const entries = [
  {name: '分类', label: '分类找书', href: '/?view=category'},
  {name: '新书', label: '新书上架', href: '/?view=new'},
  {name: '排行', label: '排行榜', href: '/ranking'},
];
const idle = (page: Page) => expect(page.locator('html')).not.toHaveAttribute('data-book-transition', /.+/);
const open = (page: Page, name: string) => page.locator('.mh-shortcuts').getByRole(name === '排行' ? 'link' : 'button', {name, exact: true}).click();
const back = (page: Page, name: string) => name === '排行' ? page.getByRole('link', {name: '返回首页', exact: true}).click() : page.getByRole('button', {name: '返回精选'}).click();

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'connection', {value: {saveData: true, addEventListener() {}, removeEventListener() {}}});
    const motions: {direction?: string; duration: number}[] = [];
    const feedback = {plainLoaders: 0};
    Object.assign(window, {shortcutMotions: motions, shortcutFeedback: feedback});
    new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
      if (node instanceof Element && node.matches('.book-navigation-loading')) feedback.plainLoaders++;
    }))).observe(document, {subtree: true, childList: true});
    const animate = Element.prototype.animate;
    Element.prototype.animate = function(frames, options) {
      if (this.classList.contains('book-transition-snapshot')) motions.push({direction: (this as HTMLElement).dataset.motion, duration: Number(typeof options === 'number' ? options : options?.duration)});
      return animate.call(this, frames, options);
    };
    document.addEventListener('DOMContentLoaded', () => {const style = document.createElement('style'); style.textContent = 'nextjs-portal{display:none}'; document.head.append(style);});
  });
});

for (const width of [320, 390]) for (const entry of entries) {
  test(`${entry.name}: slow entry, cached reopening and both return controls at ${width}px`, async ({page}, info) => {
    await page.setViewportSize({width, height: 844});
    let release!: () => void;
    const pending = new Promise<void>(resolve => {release = resolve;});
    await page.route('**/api/books?*', async route => {await pending; await route.fulfill({headers: {'X-Total-Count': '1'}, json: books});});
    try {
      await page.goto(base);
      const homeBackground = await page.locator('.mobile-home').evaluate(el => getComputedStyle(el).backgroundColor);
      await open(page, entry.name);
      await expect(page).toHaveURL(base + entry.href);
      if (entry.name === '排行') {
        // The complete ranking frame must appear before its data is released.
        await idle(page);
        await expect(page.locator('.ranking-loading')).toBeVisible();
        await expect(page.locator('.ranking-header')).toBeVisible();
        await expect(page.locator('.book-navigation-loading')).toHaveCount(0);
      } else {
        await expect(page.locator('.book-navigation-loading')).toContainText(`正在打开${entry.label}…`);
        await page.waitForTimeout(500);
        await expect(page.locator('.book-navigation-loading')).toBeVisible();
        await expect(page.locator('.book-navigation-loading')).toHaveCSS('background-color', homeBackground);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({path: info.outputPath('loading.png')});
      release(); await idle(page);
      await expect(page.locator(entry.name === '排行' ? '.ranking-row' : '.mh-browse .mh-book')).toHaveCount(1);
      await back(page, entry.name); await idle(page);
      await expect(page).toHaveURL(base + '/');
      await page.goForward(); await idle(page);
      await expect(page).toHaveURL(base + entry.href);
      await page.goBack(); await idle(page);
      await expect(page.locator('.mh-shortcuts')).toBeVisible();
      const motions = await page.evaluate(() => (window as unknown as {shortcutMotions: {direction: string; duration: number}[]}).shortcutMotions);
      expect(motions).toEqual(['enter', 'exit', 'enter', 'exit'].map(direction => ({direction, duration: 400})));
      if (entry.name === '排行') expect(await page.evaluate(() => (window as unknown as {shortcutFeedback: {plainLoaders: number}}).shortcutFeedback.plainLoaders)).toBe(0);
      await expect(page.locator('.book-transition-snapshot')).toHaveCount(0);
    } finally {release();}
  });
}

for (const entry of entries) test(`${entry.name}: Back cancels a pending entry without reopening it`, async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  let release!: () => void;
  const pending = new Promise<void>(resolve => {release = resolve;});
  await page.route(entry.name === '排行' ? '**/ranking?_rsc=*' : '**/api/books?*', async route => {await pending; await route.continue();});
  try {
    await page.goto(base); await open(page, entry.name);
    if (entry.name === '排行') {
      await expect(page.locator('html')).toHaveAttribute('data-book-transition', 'enter');
      await expect(page.locator('.book-navigation-loading')).toHaveCount(0);
    } else await expect(page.locator('.book-navigation-loading')).toBeVisible();
    await page.goBack(); await idle(page);
    await expect(page).toHaveURL(base + '/');
    release(); await page.waitForTimeout(700);
    await expect(page).toHaveURL(base + '/');
    await expect(page.locator('.mh-shortcuts')).toBeVisible();
    await expect(page.locator('.book-transition-snapshot')).toHaveCount(0);
  } finally {release();}
});

test('failed category loading allows retry and a fresh new-books entry', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  let fail = true;
  await page.route('**/api/books?*', route => fail ? route.fulfill({status: 503, json: {error: 'temporary'}}) : route.fulfill({json: books}));
  await page.goto(base); await open(page, '分类'); await idle(page);
  await expect(page.locator('.mh-browse [role=alert]')).toBeVisible();
  fail = false;
  await page.getByRole('button', {name: '重试', exact: true}).click();
  await expect(page.locator('.mh-browse .mh-book')).toHaveCount(1);
  await back(page, '分类'); await idle(page);
  await open(page, '新书'); await idle(page);
  await expect(page.locator('.mh-browse .mh-book')).toHaveCount(1);
  await expect(page.locator('.mh-browse [role=alert]')).toHaveCount(0);
});

test('a ranking opened from home retains its filters through details and reload, then returns home', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.route('**/api/books?*', route => route.fulfill({json: books}));
  await page.goto(base); await open(page, '排行'); await idle(page);
  await page.getByRole('button', {name: '周榜', exact: true}).click();
  await page.getByRole('button', {name: '玄幻', exact: true}).click();
  await expect(page.locator('.ranking-content')).toHaveAttribute('aria-busy', 'false');
  await page.locator('.ranking-card').click(); await idle(page);
  await expect(page.locator('.book-detail:visible')).toBeVisible();
  await page.reload();
  await expect(page.locator('.book-detail:visible')).toBeVisible();
  await page.goBack(); await idle(page);
  await expect(page.getByRole('button', {name: '周榜', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', {name: '玄幻', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await back(page, '排行'); await idle(page);
  await expect(page).toHaveURL(base + '/');
  await expect(page.locator('.mh-shortcuts')).toBeVisible();
});

test('reduced motion keeps the loading feedback until data is ready', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.emulateMedia({reducedMotion: 'reduce'});
  let release!: () => void;
  const pending = new Promise<void>(resolve => {release = resolve;});
  await page.route('**/api/books?*', async route => {await pending; await route.fulfill({json: books});});
  try {
    await page.goto(base); await open(page, '新书');
    await expect(page.locator('.book-navigation-loading')).toBeVisible();
    release(); await idle(page); await back(page, '新书'); await idle(page);
    expect(await page.evaluate(() => (window as unknown as {shortcutMotions: unknown[]}).shortcutMotions)).toEqual([]);
  } finally {release();}
});

test('the ranking frame and its skeleton slide together for 400ms before data arrives', async ({page}, info) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.addInitScript(() => {
    const shadows = new WeakMap<Element, ShadowRoot>();
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function(options) {
      const shadow = attach.call(this, options); shadows.set(this, shadow); return shadow;
    };
    const animate = Element.prototype.animate;
    Element.prototype.animate = function(frames, options) {
      const animation = animate.call(this, frames, options);
      if ((this as HTMLElement).dataset.motion === 'enter' && shadows.get(this)?.querySelector('.ranking-loading')) {
        animation.pause(); animation.currentTime = 200;
        const shadow = shadows.get(this)!;
        Object.assign(window, {rankingSlide: {
          duration: animation.effect!.getTiming().duration,
          header: Boolean(shadow.querySelector('.ranking-header')),
          categories: Boolean(shadow.querySelector('.ranking-categories')),
          skeleton: Boolean(shadow.querySelector('.ranking-loading')),
        }});
      }
      return animation;
    };
  });
  let release!: () => void;
  const pending = new Promise<void>(resolve => {release = resolve;});
  await page.route('**/api/books?*', async route => {await pending; await route.fulfill({json: books});});
  try {
    await page.goto(base); await open(page, '排行');
    const moving = page.locator('.book-transition-snapshot[data-motion=enter]');
    await expect(moving).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as {rankingSlide: unknown}).rankingSlide)).toEqual({duration: 400, header: true, categories: true, skeleton: true});
    await expect(page.locator('.book-navigation-loading')).toHaveCount(0);
    await page.screenshot({path: info.outputPath('ranking-frame-mid-slide.png')});
    await moving.evaluate(el => el.getAnimations().forEach(animation => animation.finish()));
    await idle(page);
    await expect(page.locator('.ranking-loading')).toBeVisible();
    await page.screenshot({path: info.outputPath('ranking-frame-loading.png')});
    release();
    await expect(page.locator('.ranking-row')).toHaveCount(1);
    await expect(page.locator('.ranking-loading')).toHaveCount(0);
  } finally {release();}
});
