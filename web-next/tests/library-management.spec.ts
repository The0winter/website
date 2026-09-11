import {test, expect, type Page} from '@playwright/test';

const base = process.env.LIBRARY_TEST_BASE || 'http://127.0.0.1:3000';
const user = {id: '000000000000000000000001', username: '书架验证', role: 'reader'};
const entries = ['山海行记', '漫长旅途中的第二本书：山间来信', '第三本书'].map((title, i) => ({
  bookId: String(101 + i).padStart(24, '0'), book: {id: String(101 + i).padStart(24, '0'), title, author: '测试作者', status: 'ongoing'},
  chapterId: String(101 + i).padStart(24, '0'), chapterTitle: '第3章 山间来信', latestChapterTitle: '第8章 新的旅程',
}));

async function setup(page: Page, options: {failOnce?: string; failRefresh?: boolean} = {}) {
  let remaining = [...entries], failOnce = options.failOnce;
  const deleted: string[] = [];
  await page.route('**/api/auth/session', route => route.fulfill({json: {user, profile: user}}));
  await page.route('**/api/auth/csrf', route => route.fulfill({json: {csrfToken: 'local-ui-test'}}));
  await page.route('**/api/users/*/library?*', route => {
    if (deleted.length && options.failRefresh) return route.fulfill({status: 503, json: {error: 'unavailable'}});
    return route.fulfill({headers: {'X-Total-Count': String(remaining.length)}, json: remaining});
  });
  await page.route(/\/api\/users\/[^/]+\/(bookmarks|history)\//, route => {
    if (route.request().method() !== 'DELETE') return route.fulfill({json: {isBookmarked: true}});
    const id = route.request().url().split('/').pop()!;
    if (id === failOnce) {failOnce = undefined; return route.fulfill({status: 503, json: {error: 'unavailable'}});}
    deleted.push(id); remaining = remaining.filter(entry => entry.bookId !== id);
    return route.fulfill({json: {success: true}});
  });
  await page.goto(base + '/forum');
  await page.goto(base + '/library');
  await expect(page.locator('.shelf-row')).toHaveCount(3);
  return deleted;
}

async function longPress(page: Page, index = 0) {
  const box = (await page.locator('.shelf-book').nth(index).boundingBox())!;
  await page.mouse.move(box.x + 25, box.y + 35);
  await page.mouse.down();
  await expect(page.locator('.library-page')).toHaveAttribute('data-managing', 'true');
  await page.mouse.up();
}

test.beforeEach(async ({page}) => {
  await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await page.addInitScript(() => {
    localStorage.setItem('has-seen-reading-hint', 'true');
    document.addEventListener('DOMContentLoaded', () => {const style = document.createElement('style'); style.textContent = 'nextjs-portal{display:none}'; document.head.append(style);});
  });
});

for (const width of [320, 390, 768, 1440]) {
  test(`row menu, long press, selection and bottom bar at ${width}px`, async ({page}, info) => {
    await page.setViewportSize({width, height: 844});
    const deleted = await setup(page);
    await expect(page.locator('.shelf-continue')).toHaveCount(0);
    const before = (await page.locator('.shelf-cover').first().boundingBox())!;
    await page.getByRole('button', {name: '更多：山海行记', exact: true}).click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem')).toHaveText(['详情', '删除']);
    await expect(menu.getByRole('menuitem', {name: '详情'})).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', {name: '删除'})).toBeFocused();
    await page.screenshot({path: info.outputPath('menu.png')});
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(page.getByRole('button', {name: '更多：山海行记'})).toBeFocused();
    await longPress(page);
    await expect(page.getByRole('checkbox').first()).toBeChecked();
    await expect(page.getByRole('checkbox').nth(1)).not.toBeChecked();
    await expect(page).toHaveURL(base + '/library');
    await expect.poll(async () => (await page.locator('.shelf-cover').first().boundingBox())!.x - before.x).toBe(width < 768 ? 36 : 44);
    await expect(page.getByRole('navigation', {name: '移动端主导航'})).toHaveCount(0);
    const bar = (await page.locator('.shelf-management-bar').boundingBox())!;
    expect(Math.round(bar.y + bar.height)).toBe(844);
    await page.locator('.shelf-book').nth(1).click();
    await expect(page.getByRole('checkbox').nth(1)).toBeChecked();
    await page.getByRole('checkbox').first().click();
    await expect(page.getByRole('checkbox').first()).not.toBeChecked();
    await page.getByRole('checkbox').first().click();
    await expect(page.getByRole('button', {name: '删除（2）'})).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path: info.outputPath('manage.png')});
    await page.getByRole('button', {name: '删除（2）'}).click();
    await expect(page.getByRole('dialog')).toContainText('选中的 2 本书');
    expect(deleted).toEqual([]);
    await page.screenshot({path: info.outputPath('confirm.png')});
    await page.getByRole('button', {name: '取消', exact: true}).click();
    await expect(page.getByRole('checkbox').first()).toBeChecked();
    await expect(page.getByRole('checkbox').nth(1)).toBeChecked();
    await page.getByRole('button', {name: '删除（2）'}).click();
    await page.getByRole('button', {name: '确认删除', exact: true}).click();
    await expect(page.locator('.shelf-row h2')).toHaveText(['第三本书']);
    await expect(page.locator('.library-page')).toHaveAttribute('data-managing', 'false');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(deleted.sort()).toEqual(entries.slice(0, 2).map(entry => entry.bookId));
    if (width < 768) await expect(page.getByRole('navigation', {name: '移动端主导航'})).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(base + '/forum');
  });
}

test('management button starts empty; back, Escape and switching tabs clear selection', async ({page}) => {
  await setup(page);
  for (const close of ['browser', 'button', 'escape', 'tab']) {
    await page.getByRole('button', {name: '管理', exact: true}).click();
    await expect(page.getByRole('button', {name: '删除', exact: true})).toBeDisabled();
    await page.getByRole('checkbox').first().click();
    if (close === 'browser') await page.goBack();
    if (close === 'button') await page.getByRole('button', {name: '返回', exact: true}).click();
    if (close === 'escape') await page.keyboard.press('Escape');
    if (close === 'tab') await page.getByRole('tab', {name: '浏览记录'}).click();
    await expect(page.locator('.library-page')).toHaveAttribute('data-managing', 'false');
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await expect(page.locator('.shelf-management-bar')).toHaveCount(0);
  }
  await page.goBack(); await expect(page).toHaveURL(base + '/forum');
});

test('a menu near the bottom opens above the navigation and remains clickable', async ({page}, info) => {
  await page.setViewportSize({width: 390, height: 600});
  const deleted = await setup(page);
  await page.locator('.shelf-more-button').last().click();
  const menu = (await page.getByRole('menu').boundingBox())!;
  const nav = (await page.getByRole('navigation', {name: '移动端主导航'}).boundingBox())!;
  expect(menu.y).toBeGreaterThanOrEqual(0);
  expect(menu.y + menu.height).toBeLessThan(nav.y);
  await page.screenshot({path: info.outputPath('menu-above.png')});
  await page.getByRole('menuitem', {name: '删除', exact: true}).click();
  await expect(page.getByRole('dialog')).toContainText('《第三本书》');
  expect(deleted).toEqual([]);
});

test('single item deletion via the menu confirms first and handles a failed refresh', async ({page}) => {
  const deleted = await setup(page, {failRefresh: true});
  await page.getByRole('button', {name: '更多：山海行记'}).click();
  await page.getByRole('menuitem', {name: '删除'}).click();
  await expect(page.getByRole('dialog')).toContainText('《山海行记》将移出书架');
  expect(deleted).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', {name: '更多：山海行记'}).click();
  await page.getByRole('menuitem', {name: '删除'}).click();
  await page.getByRole('button', {name: '确认删除'}).click();
  await expect(page.locator('.shelf-row')).toHaveCount(2);
  await expect(page.locator('.shelf-refresh-error')).toBeVisible();
  await expect(page.locator('.shelf-row h2')).not.toContainText(['山海行记']);
  await expect(page.locator('.library-page')).toHaveAttribute('data-managing', 'false');
});

test('partial batch failure keeps only failed books selected and retry does not delete successes twice', async ({page}) => {
  const deleted = await setup(page, {failOnce: entries[1].bookId});
  await longPress(page);
  await page.getByRole('checkbox').nth(1).click();
  await page.getByRole('button', {name: '删除（2）'}).click();
  await page.getByRole('button', {name: '确认删除'}).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('已删除 1 项，剩余 1 项操作失败');
  await expect(page.locator('.shelf-row')).toHaveCount(2);
  await expect(page.getByRole('checkbox', {name: '选择：' + entries[1].book.title})).toBeChecked();
  await page.getByRole('button', {name: '确认删除'}).click();
  await expect(page.locator('.shelf-row h2')).toHaveText(['第三本书']);
  await expect(page.locator('.library-page')).toHaveAttribute('data-managing', 'false');
  expect(deleted.sort()).toEqual(entries.slice(0, 2).map(entry => entry.bookId));
});

test('touch long press selects once, while a scrolling gesture cancels the hold', async ({browser}) => {
  const context = await browser.newContext({viewport: {width: 390, height: 600}, isMobile: true, hasTouch: true});
  const page = await context.newPage();
  try {
    await setup(page);
    const cdp = await context.newCDPSession(page);
    const box = (await page.locator('.shelf-book').first().boundingBox())!;
    const point = {x: box.x + 30, y: box.y + 40};
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [point]});
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{...point, y: point.y + 35}]});
    await page.waitForTimeout(650);
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
    await expect(page.locator('.library-page')).toHaveAttribute('data-managing', 'false');
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [point]});
    await expect(page.locator('.library-page')).toHaveAttribute('data-managing', 'true');
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
    await expect(page.getByRole('checkbox').first()).toBeChecked();
    await expect(page).toHaveURL(base + '/library');
  } finally {await context.close();}
});
