import {test, expect} from '@playwright/test';

const base = process.env.RANKING_BASE || 'http://127.0.0.1:3000';
const books = Array.from({length: 57}, (_, i) => ({id: (i + 700).toString(16).padStart(24, '0'), title: `分页作品 ${i + 1}`, author: '测试作者', rating: 4.8, rankingViews: 45000 - i * 100}));
test.beforeEach(async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.addInitScript(() => Object.defineProperty(navigator, 'connection', {value: {saveData: true, addEventListener() {}, removeEventListener() {}}}));
});

test('ranking loads 20 at a time, retains rows on a page failure, retries once and stops at the end', async ({page}) => {
  const requests: number[] = []; let fail = true;
  await page.route('**/api/books?*', async route => {
    const params = new URL(route.request().url()).searchParams, current = Number(params.get('page'));
    expect(params.get('limit')).toBe('20'); requests.push(current);
    await new Promise(resolve => setTimeout(resolve, 120));
    if (current === 3 && fail) return route.fulfill({status: 503, json: {error: 'unavailable'}});
    return route.fulfill({headers: {'X-Total-Count': '57'}, json: books.slice((current - 1) * 20, current * 20)});
  });
  await page.goto(base + '/ranking');
  await expect(page.locator('.ranking-row')).toHaveCount(20);
  await page.waitForTimeout(250); expect(requests).toEqual([1]);
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight - innerHeight));
  const position = await page.evaluate(() => scrollY);
  await expect(page.locator('.ranking-row')).toHaveCount(40);
  expect(await page.evaluate(() => scrollY)).toBe(position);
  expect(requests).toEqual([1, 2]);
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  await expect(page.getByRole('button', {name: '加载未完成，点击重试'})).toBeVisible();
  await expect(page.locator('.ranking-row')).toHaveCount(40);
  await page.waitForTimeout(300); expect(requests).toEqual([1, 2, 3]);
  fail = false; await page.getByRole('button', {name: '加载未完成，点击重试'}).click();
  await expect(page.locator('.ranking-row')).toHaveCount(57);
  await expect(page.locator('.ranking-more')).toHaveCount(0);
  expect(requests).toEqual([1, 2, 3, 3]);
  expect(await page.locator('.ranking-row').last().getAttribute('data-position')).toBe('57');
  expect(new Set(await page.locator('.ranking-card').evaluateAll(rows => rows.map(row => row.getAttribute('href')))).size).toBe(57);
});

test('switching a chart discards an outstanding next page and never appends stale books', async ({page}) => {
  const requests: string[] = [];
  await page.route('**/api/books?*', async route => {
    const params = new URL(route.request().url()).searchParams, current = Number(params.get('page')), sort = params.get('orderBy');
    requests.push(`${sort}:${current}`);
    if (current === 2) await new Promise(resolve => setTimeout(resolve, 700));
    return route.fulfill({headers: {'X-Total-Count': '57'}, json: books.slice((current - 1) * 20, current * 20).map(book => ({...book, title: `${sort} ${book.title}`}))});
  });
  await page.goto(base + '/ranking'); await expect(page.locator('.ranking-row')).toHaveCount(20);
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => requests.includes('rank_day:2')).toBe(true);
  await page.getByRole('button', {name: '月榜', exact: true}).click();
  await expect(page.locator('.ranking-book-info h2').first()).toContainText('rank_month');
  await page.waitForTimeout(800);
  await expect(page.locator('.ranking-row')).toHaveCount(20);
  expect((await page.locator('.ranking-book-info h2').allTextContents()).every(title => title.startsWith('rank_month'))).toBe(true);
  expect(requests.filter(value => value === 'rank_day:2')).toHaveLength(1);
});

test('a fast scroll starts the next page ahead of the viewport, and the chart stops after 100 books', async ({page}) => {
  const all = Array.from({length: 130}, (_, i) => ({...books[0], id: String(i + 900), title: `作品 ${i + 1}`}));
  const requests: {page: number; top: number}[] = [];
  await page.route('**/api/books?*', async route => {
    const current = Number(new URL(route.request().url()).searchParams.get('page'));
    requests.push({page: current, top: await page.evaluate(() => scrollY)});
    return route.fulfill({headers: {'X-Total-Count': '130'}, json: all.slice((current - 1) * 20, current * 20)});
  });
  await page.goto(base + '/ranking'); await expect(page.locator('.ranking-row')).toHaveCount(20);
  await page.waitForTimeout(350); expect(requests).toHaveLength(1);
  await page.evaluate(async () => {
    for (let step = 0; step < 8; step++) {scrollBy(0, 80); await new Promise(resolve => requestAnimationFrame(resolve));}
  });
  await expect(page.locator('.ranking-row')).toHaveCount(40);
  expect(requests[1].top).toBeLessThan(844);
  for (const count of [60, 80, 100]) {
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await expect(page.locator('.ranking-row')).toHaveCount(count);
  }
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  await expect(page.locator('.ranking-more')).toHaveCount(0);
  expect(requests.map(request => request.page)).toEqual([1, 2, 3, 4, 5]);
});
