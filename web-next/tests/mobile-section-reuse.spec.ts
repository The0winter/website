import {test, expect, type Page, type BrowserContext} from '@playwright/test';

const base = process.env.MOBILE_SECTIONS_BASE || 'http://127.0.0.1:3000';
test.use({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
const user = {id: '000000000000000000000001', username: '缓存验证', role: 'reader'};
const entry = {bookId: '1', book: {id: '1', title: '提前准备的书架', author: '测试作者', cover_image: '/test-cover.svg'}};
const post = {id: '1', title: '已经读过的论坛列表', votes: 1, comments: 0};
async function setup(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'connection', {value: {saveData: true, addEventListener() {}, removeEventListener() {}}});
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function(init) {
      const shadow = attach.call(this, init); Object.assign(this, {testShadow: shadow}); return shadow;
    };
  });
  await page.route('**/api/auth/session', route => route.fulfill({json: {user, profile: user}}));
  await page.route('**/api/users/*/library?*', route => route.fulfill({json: [entry]}));
  await page.route('**/api/forum/posts*', route => route.fulfill({json: [post]}));
  await page.route('**/test-cover.svg', route => route.fulfill({contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="160"><rect width="120" height="160" fill="tan"/></svg>'}));
}
const idle = (page: Page) => expect(page.locator('.mobile-section-snapshot')).toHaveCount(0);
async function tap(page: Page, section: string) {await page.locator(`.mh-bottom:visible [data-section=${section}]`).tap();}
async function swipe(page: Page, context: BrowserContext, dx: number, cancel = false) {
  const cdp = await context.newCDPSession(page), x = dx > 0 ? 80 : 310, y = 350;
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y, id: 1}]});
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: x + dx, y, id: 1}]});
  await expect(page.locator('html')).toHaveAttribute('data-mobile-section-transition', 'dragging');
  await cdp.send('Input.dispatchTouchEvent', {type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: []});
  await cdp.detach();
}
async function paneText(page: Page) {
  return page.locator('[data-section-pane=incoming]').evaluate(element => (element as HTMLElement & {testShadow: ShadowRoot}).testShadow.textContent);
}

test('home preloads shelf rows and cover pixels before the shelf route arrives', async ({page}, info) => {
  await setup(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  await page.route(url => url.pathname === '/library' && url.searchParams.has('_rsc'), async route => {await gate; await route.continue();});
  const cover = page.waitForResponse('**/test-cover.svg');
  try {
    await page.goto(base); await cover;
    await tap(page, 'library');
    await expect(page.locator('html')).toHaveAttribute('data-mobile-section-transition', 'loading');
    expect(await paneText(page)).toContain(entry.book.title);
    expect(await paneText(page)).not.toContain('正在整理你的书架');
    await page.screenshot({path: info.outputPath('preloaded-shelf.png')});
    const before = await page.locator('[data-section-pane=incoming]').evaluate(element => {
      const scope = (element as HTMLElement & {testShadow: ShadowRoot}).testShadow;
      return ['.shelf-row h2', '.shelf-cover', '.shelf-more-button'].map(selector => {
        const el = scope.querySelector(selector)!; const r = el.getBoundingClientRect();
        return [r.x, r.y, r.width, r.height, getComputedStyle(el).fontSize];
      });
    });
    release(); await idle(page);
    const after = await page.evaluate(() => ['#shelf-content .shelf-row h2', '#shelf-content .shelf-cover', '#shelf-content .shelf-more-button'].map(selector => {
      const el = document.querySelector(selector)!; const r = el.getBoundingClientRect();
      return [r.x, r.y, r.width, r.height, getComputedStyle(el).fontSize];
    }));
    expect(after).toEqual(before);
  } finally {release();}
});

test('loaded home and forum reuse routes, lists and previews across visits and toolbar height changes', async ({page}) => {
  await setup(page);
  const homeRequests: string[] = [], forumRequests: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    // Next may prefetch metadata separately; that is not another page-content load.
    if (url.pathname === '/' && url.searchParams.has('_rsc') && !decodeURIComponent(request.headers()['next-router-state-tree'] || '').includes('metadata-only')) homeRequests.push(url.href);
    if (url.pathname === '/api/forum/posts') forumRequests.push(url.href);
  });
  await page.goto(base); await expect(page.locator('.mobile-account-initial:visible')).toHaveText('缓');
  await tap(page, 'library'); await idle(page);
  await tap(page, 'home'); await idle(page);
  expect(homeRequests).toHaveLength(0);
  await tap(page, 'forum'); await idle(page);
  await expect(page.locator('.forum-page article h2').first()).toHaveText(post.title);
  expect(forumRequests).toHaveLength(3);
  await tap(page, 'home'); await idle(page);
  await page.setViewportSize({width: 390, height: 790});
  await tap(page, 'forum');
  expect(await paneText(page)).toContain(post.title);
  await idle(page);
  expect(forumRequests).toHaveLength(3);
  expect(homeRequests).toHaveLength(0);
});

for (const [from, section, target, dx] of [['/', 'library', '/library', -150], ['/', 'forum', '/forum', 150], ['/library', 'home', '/', 150]] as const) {
  test(`pending ${target} can swipe back to ${from} and a late response cannot take over`, async ({page, context}) => {
    await setup(page);
    let release!: () => void;
    const gate = new Promise<void>(resolve => {release = resolve;});
    await page.route(url => url.pathname === target && url.searchParams.has('_rsc'), async route => {await gate; await route.continue();});
    try {
      await page.goto(base + from); await expect(page.locator('.mobile-account-initial:visible')).toHaveText('缓');
      await tap(page, section);
      await expect(page.locator('html')).toHaveAttribute('data-mobile-section-transition', 'loading');
      await swipe(page, context, dx);
      await idle(page); await expect(page).toHaveURL(base + from);
      release(); await page.waitForTimeout(700);
      await expect(page).toHaveURL(base + from); await idle(page);
    } finally {release();}
  });
}

test('cancelling a swipe during loading keeps the destination, then another swipe works', async ({page, context}) => {
  await setup(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  await page.route(url => url.pathname === '/library' && url.searchParams.has('_rsc'), async route => {await gate; await route.continue();});
  try {
    await page.goto(base); await expect(page.locator('.mobile-account-initial:visible')).toHaveText('缓');
    await tap(page, 'library');
    await expect(page.locator('html')).toHaveAttribute('data-mobile-section-transition', 'loading');
    await swipe(page, context, -80, true);
    await expect(page.locator('html')).toHaveAttribute('data-mobile-section-transition', 'loading');
    await expect(page.locator('[data-section-pane=incoming]')).toHaveAttribute('data-section-path', '/library');
    await swipe(page, context, -150); await idle(page);
    release(); await page.waitForTimeout(500); await expect(page).toHaveURL(base + '/');
  } finally {release();}
});

test('shelf content loading permits inner-tab swipes and leaving for home', async ({page, context}) => {
  await setup(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  await page.route('**/api/users/*/library?*', async route => {await gate; await route.fulfill({json: [entry]});});
  try {
    await page.goto(base + '/library'); await expect(page.locator('#shelf-content')).toHaveAttribute('aria-busy', 'true');
    const cdp = await context.newCDPSession(page);
    for (const [x, end] of [[80, 240], [240, 80], [240, 80]]) {
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y: 350, id: 1}]});
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: end, y: 350, id: 1}]});
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
      await page.waitForTimeout(450);
    }
    await cdp.detach(); await expect(page).toHaveURL(base + '/');
  } finally {release();}
});

test('a forum write refreshes cached posts without replacing the current list with loading text', async ({page}) => {
  await setup(page); await page.goto(base + '/forum');
  await expect(page.locator('.forum-page article h2').first()).toHaveText(post.title);
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  await page.route('**/api/forum/posts*', async route => {await gate; await route.fulfill({json: [{...post, title: '更新后的论坛列表'}]});});
  try {
    await page.evaluate(() => window.dispatchEvent(new Event('forum-changed')));
    await expect(page.locator('.forum-page article h2').first()).toHaveText(post.title);
    release(); await expect(page.locator('.forum-page article h2').first()).toHaveText('更新后的论坛列表');
  } finally {release();}
});

test('logout clears the forum cache and ignores a late response from the previous session', async ({page}) => {
  await setup(page);
  await page.route('**/api/auth/csrf', route => route.fulfill({json: {csrfToken: 'test'}}));
  await page.route('**/api/auth/logout', route => route.fulfill({json: {success: true}}));
  await page.goto(base + '/forum');
  await expect(page.locator('.forum-page article h2').first()).toHaveText(post.title);
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  let refreshing = false;
  await page.route('**/api/forum/posts*', async route => {
    refreshing = true;
    await gate; await route.fulfill({json: [{...post, title: '迟到的旧帐号内容'}]});
  });
  try {
    await page.evaluate(() => window.dispatchEvent(new Event('forum-changed')));
    await expect.poll(() => refreshing).toBe(true);
    await page.locator('.mobile-account-link:visible').tap();
    await expect(page).toHaveURL(base + '/profile');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', {name: '退出登录', exact: true}).tap();
    await expect(page).toHaveURL(base + '/');
    await page.route('**/api/forum/posts*', route => route.fulfill({json: [{...post, title: '游客的新列表'}]}));
    await tap(page, 'forum'); await idle(page);
    await expect(page.locator('.forum-page article h2').first()).toHaveText('游客的新列表');
    release(); await page.waitForTimeout(500);
    await expect(page.locator('.forum-page article h2').first()).toHaveText('游客的新列表');
  } finally {release();}
});
