import {test, expect, type Page} from '@playwright/test';

const base = 'http://127.0.0.1:3000', userId = '000000000000000000000001', bookId = '000000000000000000000101';
const idle = (page: Page) => expect(page.locator('html')).not.toHaveAttribute('data-book-transition', /.+/);
const account = (id = userId) => ({id, username: id === userId ? '隔离作者' : '另一个读者', role: 'reader', created_at: '2026-01-01'});
const entry = (title = '山海行记', index = 0) => ({
  bookId: index ? String(index).padStart(24, '0') : bookId,
  book: {id: bookId, title, author: '隔离作者', status: 'ongoing'},
  chapterId: bookId, chapterTitle: '第1章 山间来信',
});
async function session(page: Page) {
  await page.route('**/api/auth/session', route => route.fulfill({json: {user: account(), profile: account()}}));
  await page.route('**/api/users/*/history', route => route.fulfill({json: {success: true}}));
}
test.beforeEach(async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.addInitScript(() => {
    localStorage.setItem('has-seen-reading-hint', 'true');
    document.addEventListener('DOMContentLoaded', () => {const style = document.createElement('style'); style.textContent = 'nextjs-portal{display:none}'; document.head.append(style);});
  });
});

test('shelf and history load on home before any click and open without another data request', async ({page}) => {
  await session(page);
  const calls: string[] = [];
  await page.route('**/api/users/*/library?*', async route => {
    const tab = new URL(route.request().url()).searchParams.get('tab')!;
    calls.push(tab);
    await route.fulfill({headers: {'X-Total-Count': '1'}, json: [entry(tab === 'shelf' ? '预加载书架' : '预加载记录')]});
  });
  await page.goto(base);
  await expect.poll(() => calls.slice().sort()).toEqual(['history', 'shelf']);
  // Install a trap after the early reads. Opening either tab must use that data.
  await page.route('**/api/users/*/library?*', route => route.fulfill({status: 503, json: {error: 'unexpected later read'}}));
  await page.getByRole('navigation', {name: '移动端主导航'}).getByRole('link', {name: '书架', exact: true}).click();
  await expect(page.locator('.shelf-row h2')).toHaveText('预加载书架');
  await expect(page.getByText('正在整理你的书架…')).toHaveCount(0);
  await expect(page.locator('.shelf-panel [role="alert"]')).toHaveCount(0);
  await page.getByRole('tab', {name: '浏览记录'}).click();
  await expect(page.locator('.shelf-row h2')).toHaveText('预加载记录');
  await expect(page.locator('.shelf-panel [role="alert"]')).toHaveCount(0);
});

test('an in-flight preload is shared with an early click instead of fetching twice', async ({page}) => {
  await session(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  let calls = 0;
  await page.route('**/api/users/*/library?*', async route => {
    if (new URL(route.request().url()).searchParams.get('tab') === 'shelf') {calls++; await gate;}
    await route.fulfill({headers: {'X-Total-Count': '1'}, json: [entry()]});
  });
  await page.goto(base);
  await expect.poll(() => calls).toBe(1);
  await page.getByRole('navigation', {name: '移动端主导航'}).getByRole('link', {name: '书架', exact: true}).click();
  await expect(page.locator('.library-page')).toBeVisible();
  release(); await expect(page.locator('.shelf-row')).toHaveCount(1);
  expect(calls).toBe(1);
});

for (const tab of ['shelf', 'history']) {
  test(tab + ' returns from details and reading to the same tab, sort and page', async ({page}) => {
    await session(page);
    await page.route('**/api/users/*/library?*', route => {
      const second = new URL(route.request().url()).searchParams.get('page') === '2';
      return route.fulfill({headers: {'X-Total-Count': '21'}, json: Array.from({length: second ? 1 : 20}, (_, i) => entry(second ? '第二页的书' : '第一页的书' + i, i))});
    });
    await page.goto(base + '/forum');
    await page.getByRole('navigation', {name: '移动端主导航'}).getByRole('link', {name: '书架', exact: true}).click();
    await expect(page.locator('.shelf-row')).toHaveCount(20);
    if (tab === 'history') await page.getByRole('tab', {name: '浏览记录'}).click();
    await page.getByRole('combobox', {name: '书架排序'}).selectOption('updated');
    await expect(page.locator('.shelf-row')).toHaveCount(20);
    await page.getByRole('button', {name: '下一页'}).click();
    await expect(page.locator('.shelf-row h2')).toHaveText('第二页的书');
    const source = page.url();
    await page.locator('.shelf-book').click();
    await expect(page.locator('.book-detail:visible')).toBeVisible(); await idle(page);
    await page.getByRole('link', {name: '立即阅读', exact: true}).click();
    await expect(page.locator('.reader-pages-root:visible')).toHaveAttribute('data-reader-ready', 'true'); await idle(page);
    await page.goBack(); await expect(page.locator('.book-detail:visible')).toBeVisible(); await idle(page);
    await page.reload(); await expect(page.locator('.book-detail:visible')).toBeVisible(); await idle(page);
    await page.goBack(); await expect(page).toHaveURL(source); await idle(page);
    await expect(page.locator('.shelf-row h2')).toHaveText('第二页的书');
    await expect(page.getByRole('tab', {name: tab === 'history' ? '浏览记录' : '书架', exact: true})).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('combobox', {name: '书架排序'})).toHaveValue('updated');
    await page.goBack(); await expect(page).toHaveURL(base + '/forum');
    await page.goForward(); await expect(page).toHaveURL(source);
    await expect(page.locator('.shelf-row h2')).toHaveText('第二页的书');
  });
}

test('Continue from the shelf returns through details to the shelf', async ({page}) => {
  await session(page);
  await page.route('**/api/users/*/library?*', route => route.fulfill({json: [entry()]}));
  await page.goto(base + '/library');
  await page.locator('.shelf-continue').click();
  await expect(page.locator('.reader-pages-root:visible')).toHaveAttribute('data-reader-ready', 'true'); await idle(page);
  await page.goBack(); await expect(page.locator('.book-detail:visible')).toBeVisible(); await idle(page);
  await page.goBack(); await expect(page).toHaveURL(base + '/library'); await idle(page);
  await expect(page.locator('.shelf-row')).toHaveCount(1);
});

test('guests do not prefetch private data and logout clears cache before another login', async ({page}) => {
  let current: ReturnType<typeof account> | null = null;
  let logins = 0;
  const requested: string[] = [];
  await page.route('**/api/auth/session', route => route.fulfill({json: {user: current, profile: current}}));
  await page.route('**/api/auth/signin', route => {
    current = account(logins++ ? userId : '000000000000000000000002');
    return route.fulfill({json: {user: current, profile: current}});
  });
  await page.route('**/api/auth/logout', route => {current = null; return route.fulfill({json: {success: true}});});
  await page.route('**/api/users/*/library?*', route => {
    requested.push(route.request().url());
    return route.fulfill({json: [entry(logins === 1 ? '第一个帐号的书架' : '第二个帐号的书架')]});
  });
  await page.goto(base);
  await expect(page.getByRole('navigation', {name: '移动端主导航'}).getByRole('link', {name: '书架', exact: true})).toHaveAttribute('href', '/login');
  expect(requested).toEqual([]);
  await page.getByRole('navigation', {name: '移动端主导航'}).getByRole('link', {name: '书架', exact: true}).click();
  await page.getByPlaceholder('请输入用户名').fill('测试');
  await page.getByPlaceholder('请输入密码').fill('test-password');
  await page.getByRole('button', {name: '立即登录', exact: true}).click();
  await expect.poll(() => requested.length).toBe(2);
  await page.getByRole('navigation', {name: '移动端主导航'}).getByRole('link', {name: '书架', exact: true}).click();
  await expect(page.locator('.shelf-row h2')).toHaveText('第一个帐号的书架');
  await page.getByRole('navigation', {name: '移动端主导航'}).getByRole('link', {name: '我', exact: true}).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', {name: '退出登录', exact: true}).click();
  await expect(page).toHaveURL(base + '/');
  await page.goBack();
  await expect(page.locator('.shelf-row')).toHaveCount(0);
  await expect(page.locator('.login-card')).toBeVisible();
  await page.getByPlaceholder('请输入用户名').fill('另一个读者');
  await page.getByPlaceholder('请输入密码').fill('test-password');
  await page.getByRole('button', {name: '立即登录', exact: true}).click();
  await expect(page).toHaveURL(base + '/library');
  await expect(page.locator('.shelf-row h2')).toHaveText('第二个帐号的书架');
  await expect(page.getByText('第一个帐号的书架')).toHaveCount(0);
});

test('preloading honors the saved sorting preference before entering the shelf', async ({page}) => {
  await session(page);
  await page.addInitScript(() => localStorage.setItem('library-sort', 'updated'));
  const sorts: string[] = [];
  await page.route('**/api/users/*/library?*', route => {
    sorts.push(new URL(route.request().url()).searchParams.get('sort')!);
    return route.fulfill({json: [entry()]});
  });
  await page.goto(base);
  await expect.poll(() => sorts).toEqual(['updated', 'updated']);
  await page.getByRole('navigation', {name: '移动端主导航'}).getByRole('link', {name: '书架', exact: true}).click();
  await expect(page.getByRole('combobox', {name: '书架排序'})).toHaveValue('updated');
  await expect(page.locator('.shelf-row')).toHaveCount(1);
});

for (const width of [320, 390, 768, 1440]) {
  test('compact shelf toolbar at ' + width, async ({page}, info) => {
    await session(page);
    await page.route('**/api/users/*/library?*', route => route.fulfill({json: [entry()]}));
    await page.setViewportSize({width, height: 844});
    await page.goto(base + '/library'); await expect(page.locator('.shelf-row')).toHaveCount(1);
    expect((await page.locator('.shelf-toolbar').boundingBox())!.height).toBe(width < 768 ? 50 : 56);
    expect((await page.getByRole('tab', {name: '书架', exact: true}).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path: info.outputPath('library.png'), fullPage: true});
  });
}
