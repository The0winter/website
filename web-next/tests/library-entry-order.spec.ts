import {test, expect, type Page} from '@playwright/test';

const base = process.env.SHELF_NAVIGATION_BASE || 'http://127.0.0.1:3000';
const book = process.env.SHELF_NAVIGATION_BOOK || '000000000000000000000101';
const chapter = process.env.SHELF_NAVIGATION_CHAPTER || book;
const user = {id: '000000000000000000000001', username: '加载期间排序验证', role: 'reader'};
const entry = (id: string, title: string, updated: string) => ({bookId: id, book: {id, title, author: '测试作者', lastUpdated: updated}, chapterId: chapter, lastReadAt: '2020-01-01', lastVisitedAt: '2020-01-01'});
const clicked = entry(book, '刚刚点击的书', '2021-01-01');
const leading = entry('000000000000000000000999', '原先排在前面的书', '2025-01-01');
function gate() {let release!: () => void; const pending = new Promise<void>(resolve => {release = resolve;}); return {pending, release};}

test.use({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
test.beforeEach(async ({page}) => {
  await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await page.addInitScript(() => {
    localStorage.setItem('has-seen-reading-hint', 'true');
    Object.defineProperty(navigator, 'connection', {value: {saveData: true, addEventListener() {}, removeEventListener() {}}});
  });
  await page.route('**/api/auth/session', route => route.fulfill({json: {user, profile: user}}));
  await page.route('**/api/auth/csrf', route => route.fulfill({json: {csrfToken: 'test-token'}}));
});

async function setup(page: Page, tab: string, sort: string, options: {fail?: boolean; secondPage?: boolean} = {}) {
  const write = gate(), reader = gate();
  let writes = 0, saved = false;
  const reads: {tab: string; sort: string; page: number; saved: boolean}[] = [];
  await page.route('**/api/users/*/history', async route => {
    writes++;
    expect(route.request().postDataJSON()).toEqual({bookId: book, chapterId: chapter});
    await write.pending;
    saved = !options.fail;
    await route.fulfill({status: saved ? 200 : 503, json: {success: saved}});
  });
  await page.route('**/api/users/*/library?*', route => {
    const params = new URL(route.request().url()).searchParams;
    const query = {tab: params.get('tab')!, sort: params.get('sort')!, page: Number(params.get('page')), saved};
    reads.push(query);
    let rows = saved && query.sort !== 'updated' ? [clicked, leading] : [leading, clicked];
    if (options.secondPage) rows = query.page === 2 ? [saved ? leading : clicked] : Array.from({length: 20}, (_, i) => entry(String(i), '第一页的书 ' + i, '2025-01-01'));
    return route.fulfill({headers: {'X-Total-Count': options.secondPage ? '21' : '2'}, json: rows});
  });
  await page.route(`**/book/${book}/${chapter}?_rsc=*`, async route => {await reader.pending; await route.continue();});
  const source = `${base}/library?tab=${tab}&sort=${sort}${options.secondPage ? '&page=2' : ''}`;
  await page.goto(source);
  await expect(page.locator('#shelf-content .shelf-book').filter({hasText: clicked.book.title})).toBeVisible();
  await expect.poll(() => reads.some(query => query.tab !== tab && query.sort === sort)).toBe(true);
  return {write, reader, reads, source, writes: () => writes};
}

for (const tab of ['shelf', 'history']) for (const sort of ['combined', 'read', 'updated']) {
  test(`${tab} ${sort} is sorted during loading and returns without another reorder or write`, async ({page}) => {
    const state = await setup(page, tab, sort);
    const titles = sort === 'updated' ? [leading.book.title, clicked.book.title] : [clicked.book.title, leading.book.title];
    try {
      await page.locator('#shelf-content .shelf-book').filter({hasText: clicked.book.title}).tap();
      await expect(page.locator('.chapter-loading-page')).toBeVisible();
      await expect.poll(state.writes).toBe(1);
      // Neither the history POST nor the reader route has completed yet.
      // Both cached tabs already show their new order behind the loading paper.
      for (const view of ['shelf', 'history']) await expect(page.locator(`[data-shelf-tab=${view}] .shelf-row h2`)).toHaveText(titles);
      state.write.release();
      await expect.poll(() => state.reads.filter(query => query.saved && query.sort === sort).map(query => query.tab).sort()).toEqual(['history', 'shelf']);
      await expect(page.locator('.chapter-loading-page')).toBeVisible();
      state.reader.release();
      await expect(page.locator('.reader-pages-root:visible')).toHaveAttribute('data-reader-ready', 'true');
      await expect(page.locator('.chapter-loading-page')).toHaveCount(0);
      expect(state.writes()).toBe(1);
      const reads = state.reads.length;
      await page.goBack();
      await expect(page).toHaveURL(state.source);
      await expect(page.locator('#shelf-content .shelf-row h2')).toHaveText(titles);
      await expect(page.locator('html')).not.toHaveAttribute('data-book-transition', /.+/);
      expect(state.reads.length).toBe(reads);
      expect(state.writes()).toBe(1);
    } finally {state.write.release(); state.reader.release();}
  });
}

test('Back during a slow write already shows the selected book in its new position', async ({page}) => {
  const state = await setup(page, 'history', 'read');
  try {
    await page.locator('#shelf-content .shelf-book').filter({hasText: clicked.book.title}).tap();
    await expect(page.locator('.chapter-loading-page')).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(state.source);
    await expect(page.locator('#shelf-content .shelf-row h2')).toHaveText([clicked.book.title, leading.book.title]);
    state.write.release();
    await expect.poll(() => state.reads.some(query => query.saved)).toBe(true);
    await expect(page.locator('#shelf-content .shelf-row h2')).toHaveText([clicked.book.title, leading.book.title]);
  } finally {state.write.release(); state.reader.release();}
});

test('a URL-selected later page refreshes before leaving the loader', async ({page}) => {
  const state = await setup(page, 'history', 'read', {secondPage: true});
  try {
    await page.locator('#shelf-content .shelf-book').tap();
    await expect.poll(state.writes).toBe(1);
    state.write.release();
    await expect.poll(() => state.reads.some(query => query.saved && query.tab === 'history' && query.sort === 'read' && query.page === 2)).toBe(true);
    await expect(page.locator('.chapter-loading-page')).toBeVisible();
    await expect(page.locator('#shelf-content .shelf-row h2')).toHaveText([leading.book.title]);
    await page.goBack();
    await expect(page).toHaveURL(state.source);
    await expect(page.locator('#shelf-content .shelf-row h2')).toHaveText([leading.book.title]);
  } finally {state.write.release(); state.reader.release();}
});

test('failed early history writes restore the original order without blocking navigation', async ({page}) => {
  const state = await setup(page, 'shelf', 'read', {fail: true});
  try {
    await page.locator('#shelf-content .shelf-book').filter({hasText: clicked.book.title}).tap();
    await expect(page.locator('#shelf-content .shelf-row h2')).toHaveText([clicked.book.title, leading.book.title]);
    state.write.release();
    await expect(page.locator('#shelf-content .shelf-row h2')).toHaveText([leading.book.title, clicked.book.title]);
    state.reader.release();
    await expect(page.locator('.reader-pages-root:visible')).toHaveAttribute('data-reader-ready', 'true');
    await expect(page.locator('.chapter-loading-page')).toHaveCount(0);
    await expect.poll(state.writes).toBe(2);
    await page.goBack();
    await expect(page).toHaveURL(state.source);
    await expect(page.locator('#shelf-content .shelf-row h2')).toHaveText([leading.book.title, clicked.book.title]);
  } finally {state.write.release(); state.reader.release();}
});
