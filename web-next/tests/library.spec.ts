import {test, expect, type Page} from '@playwright/test';

const base = 'http://127.0.0.1:3000';
const user = '000000000000000000000001';
const book = '000000000000000000000101';
async function login(page: Page) {
  await page.goto(base + '/login');
  await page.getByPlaceholder('请输入用户名').fill('隔离作者');
  await page.getByPlaceholder('请输入密码').fill('Local-test-12345');
  await page.getByRole('button', {name: '立即登录', exact: true}).click();
  await expect(page).toHaveURL(base + '/');
}
test.beforeEach(async ({page}) => {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.addInitScript(() => {
    localStorage.setItem('has-seen-reading-hint', 'true');
    document.addEventListener('DOMContentLoaded', () => {const style = document.createElement('style'); style.textContent = 'nextjs-portal{display:none}'; document.head.append(style);});
  });
});

for (const width of [320, 390, 768, 1440]) {
  test(`library empty, sparse, sorting and forum navigation at ${width}px`, async ({page}, info) => {
    await page.setViewportSize({width, height: 844});
    await login(page);
    let count = 0;
    await page.route('**/api/users/*/library?*', route => route.fulfill({headers: {'X-Total-Count': String(count)}, json: Array.from({length: count}, (_, i) => ({bookId: String(i), book: {id: String(i), title: ['绍宋', '龙与美食与地下城：一段很长很长的冒险故事'][i], author: ['榴弹怕水', '厨神附体'][i], status: '连载', lastUpdated: new Date().toISOString()}, chapterId: book, chapterTitle: '第十二章 山间来信', latestChapterTitle: '第十八章 新的旅程'}))}));
    await page.goto(base + '/library');
    await expect(page.getByRole('heading', {name: '把喜欢的故事，放进书架'})).toBeVisible();
    await expect(page.locator('nav[data-site-chrome]')).toHaveCount(0);
    await expect(page.getByRole('navigation', {name: '书架分页'})).toHaveCount(0);
    await expect(page.getByRole('combobox', {name: '书架排序'})).toHaveValue('combined');
    await page.screenshot({path: info.outputPath('empty.png')});
    for (count of [1, 2]) {
      await page.reload();
      await expect(page.locator('.shelf-row')).toHaveCount(count);
      await expect(page.locator('.shelf-discover')).toBeVisible();
      const panel = (await page.locator('.shelf-panel').boundingBox())!;
      expect(panel.height).toBeLessThan(count === 1 ? 340 : 480);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({path: info.outputPath(`${count}-books.png`)});
    }
    for (const sort of ['read', 'updated', 'combined']) {
      await page.getByRole('combobox', {name: '书架排序'}).selectOption(sort);
      await expect(page.getByRole('combobox', {name: '书架排序'})).toHaveValue(sort);
      await expect(page.locator('.shelf-row')).toHaveCount(2);
    }
    await page.getByRole('tab', {name: '浏览记录', exact: true}).click();
    await expect(page.getByRole('tab', {name: '浏览记录', exact: true})).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('button', {name: '管理', exact: true}).click();
    await page.getByRole('checkbox', {name: '选择：绍宋', exact: true}).click();
    await page.getByRole('button', {name: '删除（1）', exact: true}).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', {name: '取消', exact: true}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', {name: '返回', exact: true}).click();
    await expect(page.locator('.shelf-management-bar')).toHaveCount(0);
    if (width < 768) {
      const nav = page.getByRole('navigation', {name: '移动端主导航'});
      await expect(nav.getByRole('link', {name: '书架', exact: true})).toHaveAttribute('aria-current', 'page');
      await nav.getByRole('link', {name: '论坛', exact: true}).click();
      await expect(page).toHaveURL(base + '/forum');
      await expect(nav.getByRole('link', {name: '论坛', exact: true})).toHaveAttribute('aria-current', 'page');
      const bar = (await nav.boundingBox())!, publish = (await page.locator('.forum-publish').boundingBox())!;
      expect(Math.round(bar.y + bar.height)).toBe(844); expect(publish.y + publish.height).toBeLessThan(bar.y);
      await expect(page.locator('footer[data-site-chrome]')).toBeHidden();
      await page.screenshot({path: info.outputPath('forum.png')});
      await expect(page.getByRole('button', {name: '阅读设置'})).toHaveCount(0);
      await expect(page.locator('.forum-page')).toHaveAttribute('data-forum-theme', 'home');
    } else await expect(page.getByRole('navigation', {name: '移动端主导航'})).toBeHidden();
  });
}

test('failed requests can retry and removing the last item on page two returns to page one', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await login(page);
  let total = 21, failLoad = true, failDelete = true;
  await page.route('**/api/users/*/library?*', route => {
    if (failLoad) return route.fulfill({status: 503, json: {error: 'unavailable'}});
    const current = Number(new URL(route.request().url()).searchParams.get('page'));
    return route.fulfill({headers: {'X-Total-Count': String(total)}, json: Array.from({length: current === 2 ? total - 20 : 20}, (_, i) => ({bookId: current === 2 ? book : String(i).padStart(24, '0'), book: {id: book, title: `分页作品 ${current}-${i}`, author: '分页作者', lastUpdated: new Date().toISOString()}}))});
  });
  await page.route(`**/api/users/${user}/bookmarks/${book}`, route => {
    if (failDelete) {failDelete = false; return route.fulfill({status: 503, json: {error: 'unavailable'}});}
    total = 20; return route.fulfill({json: {success: true}});
  });
  await page.goto(base + '/library');
  await expect(page.locator('.shelf-panel').getByRole('alert')).toContainText('暂时加载失败');
  await expect(page.getByText('把喜欢的故事，放进书架', {exact: true})).toHaveCount(0);
  failLoad = false;
  await page.getByRole('button', {name: '重新加载', exact: true}).click();
  await expect(page.locator('.shelf-row')).toHaveCount(20);
  await page.getByRole('button', {name: '下一页', exact: true}).click();
  await expect(page.locator('.shelf-row')).toHaveCount(1);
  await page.getByRole('button', {name: '管理', exact: true}).click();
  await page.getByRole('checkbox').click();
  await page.getByRole('button', {name: '删除（1）', exact: true}).click();
  await page.getByRole('button', {name: '确认删除', exact: true}).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('操作失败');
  await expect(page.locator('.shelf-row')).toHaveCount(1);
  await page.getByRole('button', {name: '确认删除', exact: true}).click();
  await expect(page.locator('.shelf-row')).toHaveCount(20);
  await expect(page.getByRole('navigation', {name: '书架分页'})).toHaveCount(0);
  await page.getByRole('combobox', {name: '搜索书名或作者'}).fill('山海 行记');
  await page.getByRole('search').getByRole('button', {name: '搜索', exact: true}).click();
  await expect(page).toHaveURL(url => url.pathname === '/search' && url.searchParams.get('q') === '山海 行记');
});

test('real history survives reload, resumes the chapter and shelf removal preserves it', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await login(page);
  async function write(path: string, method: 'post' | 'delete', data?: object) {
    const token = await (await page.request.get(base + '/api/auth/csrf')).json();
    return page.request[method](base + path, {data, headers: {origin: base, 'x-csrf-token': token.csrfToken}});
  }
  await write(`/api/users/${user}/history/${book}`, 'delete');
  await write(`/api/users/${user}/bookmarks/${book}`, 'delete');
  await write(`/api/users/${user}/bookmarks`, 'post', {bookId: book});
  const savedVisit = page.waitForResponse(response => response.url().endsWith(`/api/users/${user}/history`) && response.request().method() === 'POST');
  await page.goto(`${base}/book/${book}`);
  expect((await savedVisit).ok()).toBe(true);
  const savedRead = page.waitForResponse(response => response.url().endsWith(`/api/users/${user}/history`) && response.request().method() === 'POST');
  await page.goto(`${base}/book/${book}/000000000000000000000103`);
  expect((await savedRead).ok()).toBe(true);
  await expect(page.locator('.reader-pages-root:visible')).toHaveAttribute('data-reader-ready', 'true');
  await page.goto(base + '/library');
  await expect(page.locator('.shelf-progress')).toContainText('第3章');
  await page.reload();
  await expect(page.locator('.shelf-continue')).toHaveCount(0);
  await page.locator('.shelf-book').click();
  await expect(page.locator('.book-detail:visible')).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-book-transition', /.+/);
  await page.locator('.read-now:visible').click();
  await expect(page.locator('.reader-pages-root:visible')).toHaveAttribute('data-reader-chapter', '000000000000000000000103');
  await page.goto(base + '/library');
  await page.getByRole('button', {name: '管理', exact: true}).click();
  await page.getByRole('checkbox', {name: '选择：隔离测试：山海行记'}).click();
  await page.getByRole('button', {name: '删除（1）', exact: true}).click();
  await page.getByRole('button', {name: '确认删除', exact: true}).click();
  await expect(page.getByRole('heading', {name: '把喜欢的故事，放进书架'})).toBeVisible();
  await page.getByRole('tab', {name: '浏览记录', exact: true}).click();
  await expect(page.locator('.shelf-progress')).toContainText('第3章');
  await page.getByRole('button', {name: '管理', exact: true}).click();
  await page.getByRole('checkbox', {name: '选择：隔离测试：山海行记'}).click();
  await page.getByRole('button', {name: '删除（1）', exact: true}).click();
  await page.getByRole('button', {name: '确认删除', exact: true}).click();
  await expect(page.getByRole('heading', {name: '读过的故事，在这里重逢'})).toBeVisible();
});
