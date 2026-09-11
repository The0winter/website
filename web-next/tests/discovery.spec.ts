import {test, expect, type Page} from '@playwright/test';

const base = 'http://127.0.0.1:3000';
const book = '000000000000000000000101', chapter = '000000000000000000000102';
const detail = `${base}/book/${book}`, reader = `${detail}/${chapter}`;
const recentKey = 'reader-recent-chapters:v1';
test.use({viewport: {width: 390, height: 844}});
test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem('has-seen-reading-hint', 'true');
    window.addEventListener('DOMContentLoaded', () => {const style = document.createElement('style'); style.textContent = 'nextjs-portal{display:none!important}'; document.head.append(style);});
    Object.defineProperty(navigator, 'connection', {value: {saveData: true, addEventListener() {}, removeEventListener() {}}});
  });
  await page.route('**/api/books/*/views', route => route.fulfill({json: {success: true, counted: false}}));
});

async function catalog(page: Page, width = 390) {
  await page.getByRole('button', {name: width < 768 ? /^目录 / : /^查看完整目录/}).click();
  return page.getByRole('dialog', {name: '全部目录'});
}

for (const width of [390, 1440]) test(`details remember and locate the last read chapter after reload at ${width}px`, async ({page, context}) => {
  await page.setViewportSize({width, height: 844});
  await page.goto(reader);
  await expect(page.locator('.reader-pages-root')).toHaveAttribute('data-reader-ready', 'true');
  await page.goto(detail);
  await expect(page.getByRole('link', {name: '继续阅读', exact: true})).toHaveAttribute('href', `/book/${book}/${chapter}`);
  let dialog = await catalog(page, width);
  const current = () => dialog.locator('[aria-current="location"]');
  await expect(current()).toHaveText('第2章 山间来信上次读到');
  await expect(current()).toHaveCSS('color', 'rgb(198, 61, 69)');
  await expect(current()).toBeInViewport();
  await page.reload();
  dialog = page.getByRole('dialog', {name: '全部目录'});
  await expect(current()).toHaveText('第2章 山间来信上次读到');
  await expect(current()).toBeInViewport();
  await dialog.getByRole('button', {name: /正序|倒序/}).click();
  await expect(current()).toBeInViewport();
  await page.screenshot({path: `../artifacts/discovery-catalog-${width}.png`});
  // A new document can restore the same progress, and another tab updates it.
  const other = await context.newPage();
  await other.goto(detail);
  await expect(other.getByRole('link', {name: '继续阅读', exact: true})).toHaveAttribute('href', `/book/${book}/${chapter}`);
  await other.evaluate(({key, book}) => localStorage.setItem(key, JSON.stringify([[book, book]])), {key: recentKey, book});
  await expect(current()).toHaveText('第1章 山间来信上次读到');
  await other.close();
});

test('invalid saved progress does not invent a current chapter or break catalog entry', async ({page}) => {
  await page.addInitScript(key => localStorage.setItem(key, '{broken'), recentKey);
  await page.goto(detail);
  const dialog = await catalog(page);
  await expect(dialog.locator('[aria-current]')).toHaveCount(0);
  await dialog.getByRole('link', {name: '第2章 山间来信', exact: true}).click();
  await expect(page.locator('.chapter-loading-page')).toHaveCount(0);
  await expect(page).toHaveURL(reader);
});

for (const mode of ['horizontal', 'scroll']) test(`catalog loading covers hidden or displaced ${mode} readers until a single visible handoff`, async ({page}) => {
  await page.addInitScript(mode => {
    localStorage.setItem('reader_turnMode', JSON.stringify(mode));
    localStorage.setItem('reader_themeColor', JSON.stringify('blue'));
  }, mode);
  await page.goto(detail);
  const dialog = await catalog(page);
  // Model the ready signal preceding Suspense visibility / route positioning.
  const hold = await page.addStyleTag({content: '.reader-entry-content {visibility:hidden!important;transform:translateY(24px)!important}'});
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  await page.route(`**/book/${book}/${chapter}?_rsc=*`, async route => {await gate; await route.continue();});
  try {
    await dialog.getByRole('link', {name: '第2章 山间来信', exact: true}).click();
    await expect(page.locator('.chapter-loading-page')).toHaveAttribute('data-loading-visible', 'true');
    release();
    await expect(page.locator('.reader-pages-root')).toHaveAttribute('data-reader-ready', 'true');
    await page.waitForTimeout(250);
    await expect(page.locator('.chapter-loading-page')).toBeVisible();
    await hold.evaluate(el => {el.textContent = '.reader-entry-content {transform:translateY(24px)!important}';});
    await page.waitForTimeout(250);
    await expect(page.locator('.chapter-loading-page')).toBeVisible();
    const frames = await page.evaluate(() => new Promise<{path: string; covered: boolean; snapshot: boolean; ready: boolean; top?: number}[]>(resolve => {
      const frames: {path: string; covered: boolean; snapshot: boolean; ready: boolean; top?: number}[] = [];
      let remaining = 20;
      const sample = () => {
        const reader = document.querySelector('.reader-pages-root');
        frames.push({path: location.pathname, covered: Boolean(document.querySelector('.chapter-loading-page')), snapshot: Boolean(document.querySelector('.chapter-entry-snapshot')), ready: reader?.getAttribute('data-reader-ready') === 'true', top: reader?.querySelector('.reader-frame')?.getBoundingClientRect().top});
        if (--remaining) requestAnimationFrame(sample); else resolve(frames);
      };
      [...document.querySelectorAll('style')].find(el => el.textContent === '.reader-entry-content {transform:translateY(24px)!important}')?.remove();
      requestAnimationFrame(sample);
    }));
    expect(frames.some(frame => !frame.covered)).toBe(true);
    expect(frames.every(frame => frame.path === `/book/${book}/${chapter}`)).toBe(true);
    expect(frames.filter(frame => !frame.covered).every(frame => frame.ready && frame.top === 0 && !frame.snapshot)).toBe(true);
    await expect(page.locator('.reader-frame')).toHaveCSS('background-color', 'rgb(227, 237, 252)');
  } finally {release();}
});

async function mockSearch(page: Page, total = 25) {
  await page.route('**/api/books?*', route => {
    const url = new URL(route.request().url());
    const start = (Number(url.searchParams.get('page') || 1) - 1) * 20;
    return route.fulfill({headers: {'X-Total-Count': String(total)}, json: Array.from({length: Math.min(20, Math.max(0, total - start))}, (_, i) => ({
      id: i === 0 ? book : `test${start + i + 1}`, title: `${url.searchParams.get('q') || '排行'}：山海长卷 ${start + i + 1}`, author: '青山行客', description: '山海间的故事，从一次远行开始。越过长夜与风雪，看平凡少年如何找到属于自己的天地。', category: '玄幻', status: 'ongoing',
    }))});
  });
}

for (const width of [320, 390, 768, 1440]) test(`search and ranking omit the global navbar and search pagination follows results at ${width}px`, async ({page}) => {
  await page.setViewportSize({width, height: 844});
  await mockSearch(page);
  await page.goto(`${base}/search?q=山海`);
  await expect(page.locator('.search-results a')).toHaveCount(20);
  await expect(page.locator('nav[data-site-chrome]')).toHaveCount(0);
  await expect(page.getByText('共 25 本相关书籍')).toBeVisible();
  const pagination = page.getByRole('navigation', {name: '搜索结果分页'});
  expect(await pagination.evaluate(el => el.getBoundingClientRect().top >= document.querySelector('.search-results')!.getBoundingClientRect().bottom)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path: `../artifacts/discovery-search-${width}.png`, fullPage: true});
  await pagination.getByRole('button', {name: '下一页'}).click();
  await expect(page).toHaveURL(/q=.*&page=2$/);
  await expect(page.locator('.search-results a')).toHaveCount(5);
  await expect(pagination.getByRole('button', {name: '下一页'})).toBeDisabled();
  await expect(page.locator('.search-intro')).toBeInViewport();
  await page.reload();
  await expect(page.locator('.search-results a')).toHaveCount(5);
  await pagination.getByRole('button', {name: '上一页'}).click();
  await expect(page.locator('.search-results a')).toHaveCount(20);
  await expect(pagination.getByRole('button', {name: '上一页'})).toBeDisabled();
  await page.goBack();
  await expect(page.locator('.search-results a')).toHaveCount(5);
  await page.getByRole('searchbox').fill('长夜');
  await page.getByRole('button', {name: '搜索', exact: true}).click();
  await expect(page).not.toHaveURL(/page=/);
  await expect(page.locator('.search-results h3').first()).toHaveText('长夜：山海长卷 1');
  await page.goto(`${base}/ranking`);
  await expect(page.locator('nav[data-site-chrome]')).toHaveCount(0);
  await expect(page.getByRole('button', {name: '周榜', exact: true})).toBeVisible();
  await page.getByRole('button', {name: '周榜', exact: true}).click();
  await expect(page.getByRole('heading', {level: 1})).toContainText('周榜');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('search supports empty input, empty results, retry and an exact full final page', async ({page}) => {
  await page.goto(`${base}/search`);
  await expect(page.getByRole('heading', {name: '好故事，等你发现'})).toBeVisible();
  await page.route('**/api/books?*', route => route.fulfill({status: 503, json: {error: 'unavailable'}}));
  await page.getByRole('searchbox').fill('不存在');
  await page.getByRole('button', {name: '搜索', exact: true}).click();
  await expect(page.getByRole('region', {name: '搜索结果'}).getByRole('alert')).toContainText('暂时没能完成搜索');
  await mockSearch(page, 0);
  await page.getByRole('button', {name: '重新搜索'}).click();
  await expect(page.getByRole('heading', {name: '没有找到相关书籍'})).toBeVisible();
  await mockSearch(page, 20);
  await page.getByRole('searchbox').fill('满页');
  await page.getByRole('button', {name: '搜索', exact: true}).click();
  await expect(page.locator('.search-results a')).toHaveCount(20);
  await expect(page.getByRole('button', {name: '下一页'})).toBeDisabled();
  await page.getByRole('button', {name: '清空搜索词'}).click();
  await page.getByRole('button', {name: '搜索', exact: true}).click();
  await expect(page).toHaveURL(`${base}/search`);
  await expect(page.locator('.search-results')).toHaveCount(0);
});
