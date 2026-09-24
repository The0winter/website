import {test, expect, type APIRequestContext, type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';

const base = process.env.DETAIL_BASE || 'http://127.0.0.1:3000';
let books: {id:string; title:string}[];
let api: APIRequestContext;
const created: string[] = [];
const idle = (page: Page) => expect(page.locator('html')).not.toHaveAttribute('data-book-transition', /.+/);

test.beforeAll(async ({playwright}) => {
  api = await playwright.request.newContext({baseURL:base});
  if (process.env.DETAIL_SEARCH_BOOKS) {
    books = await Promise.all(process.env.DETAIL_SEARCH_BOOKS.split(',').map(async id => {
      const response = await api.get(`/api/books/${id}`);
      expect(response.ok()).toBe(true);
      return response.json();
    }));
    expect(books).toHaveLength(3);
    return;
  }
  // Synthetic data is only created in the local isolated development service.
  expect(new URL(base).hostname).toBe('127.0.0.1');
  async function write(url:string, data:object) {
    const {csrfToken} = await (await api.get('/api/auth/csrf')).json();
    return api.post(url, {data, headers:{origin:base, 'x-csrf-token':csrfToken, 'Idempotency-Key':randomUUID()}});
  }
  expect((await write('/api/auth/signin', {email:'reader@example.test', password:'Local-test-12345'})).ok()).toBe(true);
  books = [await (await api.get('/api/books/000000000000000000000101')).json()];
  for (const name of ['乙', '丙']) {
    const response = await write('/api/books', {title:`详情搜索回程${name}${Date.now()}`, description:'本地隔离导航测试'});
    expect(response.status()).toBe(201);
    const book = await response.json();
    books.push(book); created.push(book.id);
    expect((await write('/api/chapters', {bookId:book.id, title:'山间来信', chapter_number:1, content:'仅供导航验证的合成正文。'.repeat(200)})).ok()).toBe(true);
  }
});

test.afterAll(async () => {
  for (const id of created) {
    const {csrfToken} = await (await api.get('/api/auth/csrf')).json();
    expect((await api.delete(`/api/books/${id}`, {headers:{origin:base, 'x-csrf-token':csrfToken}})).ok()).toBe(true);
  }
  await api?.dispose();
});

test.beforeEach(async ({page}) => {
  await page.setViewportSize({width:390, height:844});
  await page.addInitScript(() => {
    localStorage.setItem('has-seen-reading-hint', 'true');
    Object.defineProperty(navigator, 'connection', {value:{saveData:true, addEventListener(){}, removeEventListener(){}}});
    const animate = Element.prototype.animate;
    const motions: {direction:string|undefined; duration:number|undefined; source:string|null}[] = [];
    Object.assign(window, {detailSearchMotions:motions});
    Element.prototype.animate = function (frames, options) {
      if (this.classList.contains('book-transition-snapshot')) motions.push({
        direction:document.documentElement.dataset.bookTransition,
        duration:typeof options === 'object' ? Number(options.duration) : options,
        source:document.querySelector('.book-detail')?.getAttribute('data-book-id') ?? null,
      });
      return animate.call(this, frames, options);
    };
  });
  await page.route('**/api/auth/session', route => route.fulfill({json:{user:null, profile:null}}));
  await page.route('**/api/books/*/views', route => route.fulfill({json:{success:true, counted:false}}));
});

async function details(page:Page, index:number) {
  await expect(page).toHaveURL(`${base}/book/${books[index].id}`);
  await expect(page.locator(`.book-detail[data-book-id="${books[index].id}"]:visible`)).toBeVisible();
  await idle(page);
  await expect(page.locator('.book-detail-search input')).toHaveCount(0);
}

async function search(page:Page, index:number, results = false) {
  await page.getByRole('button', {name:'搜索书籍'}).click();
  const input = page.getByRole('combobox', {name:'搜索书名或作者'});
  await input.fill(books[index].title);
  if (results) {
    await input.press('Enter');
    await expect(page).toHaveURL(/\/search\?q=/);
    // Query changes and refresh must retain the same source book.
    await page.getByRole('searchbox').fill(books[index].title.slice(0, -1));
    await page.getByRole('searchbox').press('Enter');
    await expect(page.getByRole('region', {name:'搜索结果'})).toHaveAttribute('aria-busy', 'false');
    await page.getByRole('searchbox').press('Enter');
    await page.reload();
    await page.locator(`a.search-book[href="/book/${books[index].id}"]`).click();
  } else {
    await page.locator(`[role="option"][href="/book/${books[index].id}"]`).click();
  }
}

async function exitCount(page:Page) {
  return page.evaluate(() => (window as Window & {detailSearchMotions?:{direction:string;duration:number}[]}).detailSearchMotions?.filter(row => row.direction === 'exit' && row.duration === 400).length ?? 0);
}

for (const width of [320, 390]) for (const results of [false, true]) {
  test(`${width}px ${results ? 'full results' : 'suggestion'} returns to its source book with an exit animation`, async ({page}, info) => {
    await page.setViewportSize({width, height:844});
    await page.goto(`${base}/book/${books[0].id}`);
    await details(page, 0);
    await search(page, 1, results);
    await details(page, 1);
    await expect(page.getByRole('link', {name:'返回上一本书'})).toHaveAttribute('href', `/book/${books[0].id}`);
    await page.screenshot({path:info.outputPath(`verified-return-${width}.png`)});
    const exits = await exitCount(page);
    if (width === 320) await page.getByRole('link', {name:'返回上一本书'}).click();
    else await page.goBack();
    await details(page, 0);
    expect(await exitCount(page)).toBe(exits + 1);
    await page.goForward();
    await details(page, 1);
    await page.goBack();
    await details(page, 0);
    await page.goBack();
    await expect(page).toHaveURL(`${base}/`);
  });
}

test('chained searches return C → B → A, while the logo still opens Featured', async ({page}) => {
  await page.goto(`${base}/book/${books[0].id}`);
  await details(page, 0);
  await search(page, 1); await details(page, 1);
  await search(page, 2); await details(page, 2);
  await page.getByRole('link', {name:'返回上一本书'}).click(); await details(page, 1);
  await page.getByRole('link', {name:'返回上一本书'}).click(); await details(page, 0);
  expect(await exitCount(page)).toBe(2);
  await page.goForward(); await details(page, 1);
  await page.getByRole('link', {name:'精选主页'}).click();
  await expect(page).toHaveURL(`${base}/`);
  await expect(page.locator('.mh-bottom a[data-section="home"]')).toHaveAttribute('aria-current', 'page');
});

test('reader round-trip and destination reload preserve the source book', async ({page}) => {
  await page.goto(`${base}/book/${books[0].id}`);
  await details(page, 0);
  await search(page, 1); await details(page, 1);
  await page.locator('.read-now:visible').click();
  await expect(page.locator('[data-reader-ready="true"]:visible')).toBeVisible();
  await page.goBack(); await details(page, 1);
  await page.reload(); await details(page, 1);
  await page.getByRole('link', {name:'返回上一本书'}).click(); await details(page, 0);
  expect(await exitCount(page)).toBe(1);
});

test('Back during a slow search destination returns to its source without reviving the loader', async ({page}) => {
  await page.goto(`${base}/book/${books[0].id}`);
  await details(page, 0);
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  let requested = false;
  await page.route(`**/book/${books[1].id}?_rsc=*`, async route => {requested = true; await gate; await route.continue();});
  try {
    await search(page, 1);
    await expect.poll(() => requested).toBe(true);
    await expect(page.locator('.book-navigation-loading')).toBeVisible();
    await page.goBack(); await details(page, 0);
    release();
    await expect(page.locator('.book-transition-snapshot')).toHaveCount(0);
    await page.getByRole('button', {name:'搜索书籍'}).click();
    await expect(page.getByRole('combobox', {name:'搜索书名或作者'})).toBeFocused();
    await page.goBack(); await details(page, 0);
  } finally {release();}
});
