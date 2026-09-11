import {test, expect, type Page} from '@playwright/test';

const base = 'http://127.0.0.1:3000';
const book = '000000000000000000000101';
const author = '000000000000000000000001';
const idle = (page: Page) => expect(page.locator('html')).not.toHaveAttribute('data-book-transition', /.+/);

test.beforeEach(async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
});

for (const view of ['new', 'category']) {
  test(view + ' retains its list and page through details, reading, reload and Back', async ({page}) => {
    await page.route('**/api/books?**', async route => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('limit') !== '20') return route.continue();
      await route.fulfill({headers: {'X-Total-Count': '41'}, json: Array.from({length: 20}, (_, i) => ({
        id: i ? String(i).padStart(24, '0') : book, title: '第' + (url.searchParams.get('page') || '1') + '页作品' + i, description: '分页与返回验证', category: '玄幻', author: '测试作者',
      }))});
    });
    await page.goto(base + '/search');
    await page.getByRole('link', {name: '返回首页', exact: true}).click();
    await page.locator('.mh-shortcuts').getByRole('button', {name: view === 'new' ? '新书' : '分类', exact: true}).click();
    await expect(page).toHaveURL(base + '/?view=' + view);
    if (view === 'category') await page.getByRole('button', {name: '玄幻', exact: true}).click();
    await page.getByRole('button', {name: '下一页', exact: true}).click();
    await expect(page.locator('.mh-pagination')).toContainText('第 2 页');
    await expect(page.locator('.mh-browse h3').first()).toHaveText('第2页作品0');
    const listUrl = page.url();
    await page.locator('.mh-browse .mh-book').first().click();
    await expect(page.locator('.book-detail:visible')).toBeVisible(); await idle(page);
    await page.getByRole('link', {name: '立即阅读', exact: true}).click();
    await expect(page.locator('.reader-pages-root:visible')).toHaveAttribute('data-reader-ready', 'true'); await idle(page);
    await page.goBack(); await expect(page.locator('.book-detail:visible')).toBeVisible(); await idle(page);
    await page.reload(); await expect(page.locator('.book-detail:visible')).toBeVisible(); await idle(page);
    await page.goBack(); await expect(page).toHaveURL(listUrl); await idle(page);
    await expect(page.locator('.mh-browse h3').first()).toHaveText('第2页作品0');
    if (view === 'category') await expect(page.getByRole('button', {name: '玄幻', exact: true})).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', {name: '返回精选'}).click();
    await expect(page).toHaveURL(base + '/');
    await expect(page.locator('.mh-shortcuts')).toBeVisible();
    await page.goBack(); await expect(page).toHaveURL(base + '/search');
  });
}

test('native Back closes new books before leaving home, and Forward reopens it', async ({page}) => {
  await page.goto(base);
  await page.getByRole('button', {name: '新书', exact: true}).click();
  await expect(page.locator('.mh-browse')).toBeVisible();
  await page.goBack(); await expect(page.locator('.mh-shortcuts')).toBeVisible();
  await page.goForward(); await expect(page.locator('.mh-browse')).toBeVisible();
  await page.reload(); await expect(page.locator('.mh-browse')).toBeVisible();
  await page.getByRole('button', {name: '返回精选'}).click();
  await expect(page.locator('.mh-shortcuts')).toBeVisible();
});

test('author works include every item and restore the page after reading', async ({page}) => {
  await page.route('**/api/books?author_id=**', async route => {
    const second = new URL(route.request().url()).searchParams.get('page') === '2';
    await route.fulfill({headers: {'X-Total-Count': '21'}, json: Array.from({length: second ? 1 : 20}, (_, i) => ({
      id: i ? String(i).padStart(24, '0') : book, title: '作品' + (second ? 21 : i + 1), description: '作品简介', category: '玄幻', status: 'ongoing',
    }))});
  });
  await page.goto(base + '/book/' + book); await idle(page);
  await page.locator('.book-detail a[href^="/author/"]').click();
  await expect(page.locator('.author-book')).toHaveCount(20);
  await expect(page.locator('.author-book h3').first()).toHaveText('作品1');
  await page.getByRole('button', {name: '下一页'}).click();
  await expect(page.locator('.author-book')).toHaveCount(1);
  await expect(page.locator('.author-book h3')).toHaveText('作品21');
  const url = page.url();
  await page.locator('.author-book').click(); await expect(page.locator('.book-detail:visible')).toBeVisible(); await idle(page);
  await page.goBack(); await expect(page).toHaveURL(url); await idle(page);
  await expect(page.locator('.author-book h3')).toHaveText('作品21');
  await page.getByRole('button', {name: '返回', exact: true}).click();
  await expect(page.locator('.book-detail:visible')).toBeVisible();
  await idle(page);
  await page.goForward(); await expect(page).toHaveURL(url);
  await expect(page.locator('.author-book h3')).toHaveText('作品21');
});

for (const width of [320, 390, 768, 1440]) {
  test('forum search and author layout at ' + width, async ({page}, testInfo) => {
    await page.setViewportSize({width, height: 900});
    await page.goto(base + '/forum');
    const input = page.getByRole('searchbox', {name: '搜索你想看的问题或文章'});
    await expect(input).toBeVisible();
    const layout = await page.locator('.forum-search').evaluate(form => {
      const box = form.getBoundingClientRect(), input = form.querySelector('input')!.getBoundingClientRect(), icon = form.querySelector('svg')!.getBoundingClientRect();
      return {inline: icon.right < input.left, contained: input.right <= box.right, height: box.height, overflow: document.documentElement.scrollWidth > innerWidth};
    });
    expect(layout).toEqual({inline: true, contained: true, height: 44, overflow: false});
    await input.fill('不存在的帖子检索词');
    await expect(input).toHaveValue('不存在的帖子检索词');
    await page.screenshot({path: testInfo.outputPath('forum.png'), fullPage: true});
    await page.goto(base + '/author/' + author);
    await expect(page.locator('.author-book')).toHaveCount(1);
    await expect(page.getByRole('heading', {name: /全部作品\s*（1）/})).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path: testInfo.outputPath('author.png'), fullPage: true});
  });
}
