import {test, expect, type Page} from '@playwright/test';

const base = process.env.AUTHOR_NAV_BASE || 'http://127.0.0.1:3000';
const book = process.env.AUTHOR_NAV_BOOK || '000000000000000000000101';
const author = process.env.AUTHOR_NAV_AUTHOR || '000000000000000000000001';
const detail = `${base}/book/${book}`, authorUrl = `${base}/author/${author}`;
const work = {id: book, title: '作者作品', description: '作品简介', category: '玄幻'};
const idle = (page: Page) => expect(page.locator('html')).not.toHaveAttribute('data-book-transition', /.+/, {timeout: 20000});
const source = async (page: Page) => {
  await expect(page).toHaveURL(detail);
  await expect(page.locator('.book-detail:visible')).toBeVisible(); await idle(page);
};
const open = (page: Page) => page.locator(`.book-detail a[href="/author/${author}"]`).click();
const loaded = async (page: Page) => {
  await expect(page.locator('.author-profile h1')).toHaveText('测试作者');
  await expect(page.locator('.author-book')).toHaveCount(1); await idle(page);
};
const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>(resolve => {release = resolve;});
  return {promise, release};
};

test.beforeEach(async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await page.route(`**/api/authors/${author}`, route => route.fulfill({json: {id: author, username: '测试作者'}}));
  await page.route('**/api/books?author_id=**', route => route.fulfill({headers: {'X-Total-Count': '1'}, json: [work]}));
  await page.route('**/api/books/*/views', route => route.fulfill({json: {success: true, counted: false}}));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'connection', {value: {saveData: true, addEventListener() {}, removeEventListener() {}}});
    const motions: {direction: string; duration: number}[] = [];
    Object.assign(window, {authorMotions: motions, pauseAuthorEntry: false});
    const animate = Element.prototype.animate;
    Element.prototype.animate = function(frames, options) {
      const animation = animate.call(this, frames, options);
      if (this.classList.contains('book-transition-snapshot') && this.hasAttribute('data-motion')) {
        motions.push({direction: this.getAttribute('data-motion')!, duration: Number(animation.effect!.getTiming().duration)});
        if ((window as unknown as {pauseAuthorEntry: boolean}).pauseAuthorEntry && this.classList.contains('book-navigation-loading')) {
          animation.pause(); animation.currentTime = 160;
        }
      }
      return animation;
    };
  });
});

for (const width of [320, 390, 1440]) test(`one loader slides immediately and waits for both author requests at ${width}px`, async ({page}, info) => {
  await page.setViewportSize({width, height: 900});
  await page.goto(detail); await source(page);
  const routeGate = gate(), profileGate = gate(), worksGate = gate();
  await page.route(`**/author/${author}?_rsc=*`, async route => {await routeGate.promise; await route.continue();});
  await page.route(`**/api/authors/${author}`, async route => {await profileGate.promise; await route.fulfill({json: {id: author, username: '测试作者'}});});
  await page.route('**/api/books?author_id=**', async route => {await worksGate.promise; await route.fulfill({headers: {'X-Total-Count': '1'}, json: [work]});});
  try {
    await page.evaluate(() => Object.assign(window, {pauseAuthorEntry: true}));
    await open(page);
    const loader = page.locator('.book-navigation-loading');
    await expect(loader).toHaveCount(1); await expect(loader).toContainText('正在打开作者主页');
    await expect(page).toHaveURL(authorUrl);
    expect(await loader.evaluate(el => el.getBoundingClientRect().left)).toBeGreaterThan(0);
    await expect(page.locator('.book-transition-snapshot')).toHaveCount(2);
    await page.screenshot({path: info.outputPath('author-mid-slide.png')});
    await loader.evaluate(el => {Object.assign(window, {originalAuthorLoader: el}); el.getAnimations().forEach(animation => animation.finish());});
    routeGate.release();
    await expect(page.locator('.author-loading')).toBeAttached();
    await expect(page.locator('.author-loading')).not.toBeVisible();
    profileGate.release();
    await expect(loader).toBeVisible();
    await expect(page.locator('.author-profile')).toHaveCount(0);
    expect(await loader.evaluate(el => el === (window as unknown as {originalAuthorLoader: Element}).originalAuthorLoader)).toBe(true);
    await page.screenshot({path: info.outputPath('author-loading.png')});
    worksGate.release(); await loaded(page);
    await expect(page.locator('.book-navigation-loading, .author-loading')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.evaluate(() => (window as unknown as {authorMotions: unknown[]}).authorMotions)).toEqual([{direction: 'enter', duration: 400}]);
    await page.screenshot({path: info.outputPath('author-ready.png')});
  } finally {routeGate.release(); profileGate.release(); worksGate.release();}
});

for (const phase of ['route', 'data']) test(`Back cancels ${phase} loading; Forward and cached revisits keep the source`, async ({page}) => {
  await page.goto(detail); await source(page);
  const historyLength = await page.evaluate(() => history.length);
  const hold = gate();
  await page.route(phase === 'route' ? `**/author/${author}?_rsc=*` : '**/api/books?author_id=**', async route => {
    await hold.promise;
    if (phase === 'route') await route.continue(); else await route.fulfill({headers: {'X-Total-Count': '1'}, json: [work]});
  });
  try {
    await open(page); await expect(page.locator('.book-navigation-loading')).toBeVisible();
    if (phase === 'data') await expect(page.locator('.author-loading')).toBeAttached();
    expect(await page.evaluate(() => history.length)).toBe(historyLength + 1);
    if (phase === 'route') await page.goBack(); else await page.keyboard.press('Escape');
    await source(page); await expect(page.locator('.book-transition-snapshot')).toHaveCount(0);
    hold.release();
    await page.goForward(); await loaded(page);
    await page.getByRole('button', {name: '返回', exact: true}).click(); await source(page);
    await open(page); await loaded(page);
    await page.goBack(); await source(page);
    expect(await page.evaluate(() => history.length)).toBe(historyLength + 1);
    await expect(page.locator('.book-transition-snapshot')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as {authorMotions: unknown[]}).authorMotions)).toEqual(
      ['enter', 'exit', 'enter', 'exit', 'enter', 'exit'].map(direction => ({direction, duration: 400})),
    );
  } finally {hold.release();}
});

test('pagination, reading a work and reload preserve the original source visit', async ({page}) => {
  await page.route('**/api/books?author_id=**', route => {
    const second = new URL(route.request().url()).searchParams.get('page') === '2';
    return route.fulfill({headers: {'X-Total-Count': '21'}, json: Array.from({length: second ? 1 : 20}, (_, i) => ({...work, id: i ? String(i).padStart(24, '0') : book, title: second ? '第二页作品' : `作品${i + 1}`}))});
  });
  await page.goto(detail); await source(page); await open(page); await idle(page);
  await expect(page.locator('.author-book')).toHaveCount(20);
  await page.getByRole('button', {name: '下一页'}).click();
  await expect(page.locator('.author-book h3')).toHaveText('第二页作品');
  await page.locator('.author-book').click(); await source(page);
  await page.goBack(); await idle(page);
  await expect(page).toHaveURL(authorUrl + '?page=2');
  await expect(page.locator('.author-book h3')).toHaveText('第二页作品');
  await page.reload(); await expect(page.locator('.author-book h3')).toHaveText('第二页作品');
  await page.getByRole('button', {name: '返回', exact: true}).click(); await source(page);
  await page.goForward(); await idle(page);
  await expect(page).toHaveURL(authorUrl + '?page=2');
  await expect(page.locator('.author-book h3')).toHaveText('第二页作品');
  await page.goBack(); await source(page);
});

test('failure leaves the loader and retry recovers the author page', async ({page}) => {
  let fail = true;
  await page.route(`**/api/authors/${author}`, route => route.fulfill(fail ? {status: 503, json: {error: 'temporary'}} : {json: {id: author, username: '测试作者'}}));
  await page.goto(detail); await source(page); await open(page); await idle(page);
  await expect(page.locator('.author-empty[role=alert]')).toContainText('作者信息暂时加载失败');
  await expect(page.locator('.book-navigation-loading, .author-loading')).toHaveCount(0);
  fail = false;
  await page.getByRole('button', {name: '重新加载'}).click(); await loaded(page);
  await page.getByRole('button', {name: '返回', exact: true}).click(); await source(page);
});

for (const direct of [false, true]) test(`${direct ? 'direct opening' : 'reduced motion'} uses a single loader until ready`, async ({page}) => {
  await page.emulateMedia({reducedMotion: 'reduce'});
  if (!direct) {await page.goto(detail); await source(page);}
  const hold = gate();
  await page.route('**/api/books?author_id=**', async route => {await hold.promise; await route.fulfill({headers: {'X-Total-Count': '1'}, json: [work]});});
  try {
    if (direct) await page.goto(authorUrl); else await open(page);
    await expect(page.locator('.book-navigation-loading:visible, .author-loading:visible')).toHaveCount(1);
    await expect(page.locator('.author-profile')).toHaveCount(0);
    hold.release(); await loaded(page);
    expect(await page.evaluate(() => (window as unknown as {authorMotions: unknown[]}).authorMotions)).toEqual([]);
    if (!direct) {await page.goBack(); await source(page);}
  } finally {hold.release();}
});
