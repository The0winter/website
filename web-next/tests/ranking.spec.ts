import {test, expect} from '@playwright/test';

const base = process.env.RANKING_BASE || 'http://127.0.0.1:3000';
const titles = ['夜无疆', '玄鉴仙族', '捞尸人', '没钱修什么仙？', '请勿高考时渡劫', '以神通之名', '让仙门再次伟大', '一个很长很长的书名用来验证小屏幕仍然可以正常阅读'];
const books = titles.map((title, i) => ({id: (257 + i).toString(16).padStart(24, '0'), title, author: ['辰东', '季越人', '纯洁滴小龙'][i % 3], category: '玄幻', description: '越过长夜与风雪，看平凡少年如何找到属于自己的天地。', rating: 4.8 - i / 10, views: 30000 - i * 900, rankingViews: 1200 - i * 80, rankingScore: 96 - i * 3}));

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'connection', {value: {saveData: true, addEventListener() {}, removeEventListener() {}}});
    window.addEventListener('DOMContentLoaded', () => {const style = document.createElement('style'); style.textContent = 'nextjs-portal{display:none!important}'; document.head.append(style);});
  });
});

for (const width of [320, 390, 768, 1440]) test(`ranking navigation and readable layout at ${width}px`, async ({page}) => {
  await page.setViewportSize({width, height: 844});
  const queries: string[] = [];
  await page.route('**/api/books?*', route => {
    queries.push(route.request().url());
    return route.fulfill({json: books});
  });
  await page.goto(base + '/ranking');
  await expect(page.locator('.ranking-row')).toHaveCount(8);
  await expect(page.getByRole('navigation', {name: '榜单切换'}).getByRole('button')).toHaveText(['日榜', '周榜', '月榜', '总榜', '浏览榜']);
  await expect(page.locator('.ranking-book-info h2').first()).toHaveText('夜无疆');
  for (const [name, sort] of [['周榜', 'rank_week'], ['月榜', 'rank_month'], ['总榜', 'rank_total'], ['浏览榜', 'views'], ['日榜', 'rank_day']]) {
    await page.getByRole('button', {name, exact: true}).click();
    await expect(page.getByRole('heading', {level: 1})).toHaveText(name);
    await expect(page.locator('.ranking-content')).toHaveAttribute('aria-busy', 'false');
    expect(new URL(queries.at(-1)!).searchParams.get('orderBy')).toBe(sort);
    await expect(page.getByRole('button', {name, exact: true})).toHaveAttribute('aria-pressed', 'true');
  }
  await page.getByRole('button', {name: '悬疑', exact: true}).click();
  await expect(page.locator('.ranking-content')).toHaveAttribute('aria-busy', 'false');
  expect(new URL(queries.at(-1)!).searchParams.get('category')).toBe('悬疑');
  await page.getByRole('button', {name: '全部', exact: true}).click();
  await expect(page.locator('.ranking-content')).toHaveAttribute('aria-busy', 'false');
  expect(new URL(queries.at(-1)!).searchParams.has('category')).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const row of await page.locator('.ranking-row').all()) {
    expect(await row.evaluate(el => {
      const cover = el.querySelector('.ranking-cover')!.getBoundingClientRect();
      const info = el.querySelector('.ranking-book-info')!.getBoundingClientRect();
      return info.left >= cover.right && info.right <= innerWidth;
    })).toBe(true);
  }
  await expect(page.locator('nav[data-site-chrome]')).toHaveCount(0);
  await expect(page.getByRole('link', {name: '返回首页'})).toHaveAttribute('href', '/');
  await page.screenshot({path: `../artifacts/ranking-redesign-${width}.png`, fullPage: true});
  if (width < 768) {
    await page.evaluate(() => window.scrollTo(0, 400));
    await expect(page.getByRole('button', {name: '周榜', exact: true})).toBeInViewport();
    await page.getByRole('button', {name: '周榜', exact: true}).click();
    expect(await page.evaluate(() => scrollY)).toBe(0);
  }
});

test('failed and superseded requests never show books from the wrong ranking', async ({page}) => {
  let fail = true;
  await page.route('**/api/books?*', async route => {
    const sort = new URL(route.request().url()).searchParams.get('orderBy');
    if (sort === 'rank_week') await new Promise(resolve => setTimeout(resolve, 500));
    if (sort === 'rank_month') return route.fulfill({json: []});
    return route.fulfill(fail ? {status: 503, json: {error: 'unavailable'}} : {json: sort === 'rank_week' ? [{...books[0], title: '迟到的周榜'}] : books});
  });
  await page.goto(base + '/ranking');
  await expect(page.locator('.ranking-content').getByRole('alert')).toContainText('榜单暂时没能加载');
  await expect(page.locator('.ranking-row')).toHaveCount(0);
  fail = false;
  await page.getByRole('button', {name: '重新加载'}).click();
  await expect(page.locator('.ranking-row')).toHaveCount(8);
  await page.getByRole('button', {name: '周榜', exact: true}).click();
  await page.getByRole('button', {name: '月榜', exact: true}).click();
  await expect(page.getByRole('heading', {name: '这个分类还没有作品'})).toBeVisible();
  await page.waitForTimeout(700);
  await expect(page.locator('.ranking-row')).toHaveCount(0);
  await expect(page.getByRole('heading', {level: 1})).toHaveText('月榜');
});
