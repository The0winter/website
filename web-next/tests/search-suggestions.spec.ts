import {test, expect, type Page} from '@playwright/test';

const base = 'http://127.0.0.1:3000';
const bookId = '000000000000000000000101';
const match = {id: bookId, title: '神的模仿犯', author: '青衫取醉', description: '', status: 'ongoing'};
const search = (page: Page) => page.getByRole('combobox', {name: '搜索书名或作者'});

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'connection', {value: {saveData: true, addEventListener() {}, removeEventListener() {}}});
  });
});

for (const width of [320, 390, 768, 1440]) test(`home offers library matches, supports selection and stays within ${width}px`, async ({page}) => {
  await page.setViewportSize({width, height: 844});
  await page.route('**/api/books?*', route => {
    const params = new URL(route.request().url()).searchParams;
    expect(params.get('q')).toBe('神的');
    expect(params.get('limit')).toBe('6');
    return route.fulfill({json: [match]});
  });
  await page.goto(base);
  const input = search(page);
  await input.focus();
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(input).toHaveAttribute('type', 'search');
  await expect(input).toHaveAttribute('autocomplete', 'off');
  await expect(input).toHaveAttribute('enterkeyhint', 'search');
  await input.fill('神的');
  const option = page.getByRole('option', {name: '神的模仿犯 青衫取醉'});
  await expect(option).toBeVisible();
  await expect(option.locator('mark')).toHaveText('神的');
  await expect(option).toHaveAttribute('href', `/book/${bookId}`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path: `../artifacts/search-suggestions-${width}.png`, fullPage: false});
  await option.click();
  await expect(page).toHaveURL(`${base}/book/${bookId}`);
  await expect(page.getByRole('listbox')).toHaveCount(0);
});

test('typing and IME composition issue only a debounced final search and Enter confirms Chinese first', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  const requests: string[] = [];
  await page.route('**/api/books?*', route => {
    requests.push(new URL(route.request().url()).searchParams.get('q')!);
    return route.fulfill({json: [match]});
  });
  await page.goto(base);
  const input = search(page);
  await input.focus();
  await input.dispatchEvent('compositionstart');
  await input.fill('shen');
  await page.waitForTimeout(350);
  expect(requests).toEqual([]);
  await input.press('Enter');
  await expect(page).toHaveURL(`${base}/`);
  await input.fill('神的');
  await input.dispatchEvent('compositionend', {data: '神的'});
  await expect(page.getByRole('option')).toHaveCount(1);
  expect(requests).toEqual(['神的']);
  await input.fill('神');
  await input.fill('神的模');
  await input.fill('神的模仿');
  await expect.poll(() => requests).toEqual(['神的', '神的模仿']);
});

test('late responses never replace the current query and clearing cancels pending suggestions', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  let oldStarted = false;
  await page.route('**/api/books?*', async route => {
    const query = new URL(route.request().url()).searchParams.get('q');
    if (query === '旧书') {oldStarted = true; await gate;}
    await route.fulfill({json: [{...match, title: query === '旧书' ? '旧书迟到' : '神的模仿犯'}]});
  });
  await page.goto(base);
  const input = search(page);
  try {
    await input.fill('旧书');
    await expect.poll(() => oldStarted).toBe(true);
    await input.fill('神的');
    await expect(page.getByRole('option')).toContainText('神的模仿犯');
    release();
    await page.waitForTimeout(350);
    await expect(page.getByRole('option')).toContainText('神的模仿犯');
    await page.getByRole('button', {name: '清空搜索词'}).click();
    await expect(input).toHaveValue('');
    await expect(page.getByRole('listbox')).toHaveCount(0);
  } finally {release();}
});

test('keyboard, author matches, outside dismissal and full search remain available', async ({page}) => {
  await page.route('**/api/books?*', route => route.fulfill({json: [match, {...match, id: 'second', title: '第二本书'}]}));
  await page.goto(base);
  const input = search(page);
  await input.fill('青衫');
  await expect(page.getByRole('option')).toHaveCount(2);
  await expect(page.getByRole('option').first().locator('mark')).toHaveText('青衫');
  await input.press('ArrowUp');
  await expect(page.getByRole('option').last()).toHaveAttribute('aria-selected', 'true');
  await input.press('ArrowDown');
  await expect(page.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
  await input.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await input.press('ArrowDown');
  await expect(page.getByRole('listbox')).toBeVisible();
  await input.press('Enter');
  await expect(page).toHaveURL(`${base}/book/${bookId}`);
  await page.goto(base);
  await input.fill('青衫');
  await expect(page.getByRole('option')).toHaveCount(2);
  await page.locator('body').click({position: {x: 5, y: 200}});
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await input.focus();
  await page.getByRole('button', {name: '查看全部搜索结果'}).click();
  await expect(page).toHaveURL(/\/search\?q=/);
  await expect(page.getByRole('searchbox')).toHaveValue('青衫');
});

test('empty and failed suggestions allow normal search without retaining stale books', async ({page}) => {
  await page.route('**/api/books?*', route => {
    const query = new URL(route.request().url()).searchParams.get('q');
    return query === '失败' ? route.fulfill({status: 503, json: {error: 'unavailable'}}) : route.fulfill({json: []});
  });
  await page.goto(base);
  const input = search(page);
  await input.fill('不存在');
  await expect(page.getByRole('status')).toContainText('暂无匹配书籍');
  await input.fill('失败');
  await expect(page.getByRole('status')).toContainText('推荐暂不可用，可继续搜索');
  await expect(page.getByRole('option')).toHaveCount(0);
  await input.press('Enter');
  await expect(page).toHaveURL(/\/search\?q=/);
});

for (const width of [320, 390, 1440]) test(`search results omit redundant headings and single-page controls at ${width}px`, async ({page}) => {
  await page.setViewportSize({width, height: 844});
  await page.route('**/api/books?*', route => route.fulfill({headers: {'X-Total-Count': '1'}, json: [match]}));
  await page.goto(`${base}/search?q=神的模仿犯`);
  await expect(page.locator('.search-results a')).toHaveCount(1);
  await expect(page.getByText('九天书库', {exact: true})).toHaveCount(0);
  await expect(page.getByText('从书名或作者开始，找到下一本想读的书。')).toHaveCount(0);
  await expect(page.locator('.search-intro')).toHaveCount(0);
  await expect(page.getByRole('heading', {level: 2})).toHaveCount(0);
  await expect(page.getByRole('navigation', {name: '搜索结果分页'})).toHaveCount(0);
  expect(await page.getByRole('searchbox').evaluate(el => el.getBoundingClientRect().top < 120)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path: `../artifacts/search-clean-${width}.png`, fullPage: true});
});
