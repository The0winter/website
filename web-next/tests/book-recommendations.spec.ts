import {test, expect, type APIRequestContext, type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';

const base = process.env.DETAIL_BASE || 'http://127.0.0.1:3000';
const source = process.env.DETAIL_BOOK || '000000000000000000000101';
let target: {id: string; title: string};
let api: APIRequestContext;
let created = false;
test.use({hasTouch:true});

test.beforeAll(async ({playwright}) => {
  api = await playwright.request.newContext({baseURL:base});
  if (process.env.DETAIL_BOOK) {
    target = (await (await api.get('/api/books?limit=9')).json()).find((book: {id:string}) => book.id !== source);
    expect(target).toBeTruthy();
    return;
  }
  expect(new URL(base).hostname).toBe('127.0.0.1');
  async function write(path:string, data:object) {
    const {csrfToken} = await (await api.get('/api/auth/csrf')).json();
    return api.post(path, {data, headers:{origin:base, 'x-csrf-token':csrfToken, 'Idempotency-Key':randomUUID()}});
  }
  expect((await write('/api/auth/signin', {email:'reader@example.test', password:'Local-test-12345'})).ok()).toBe(true);
  const response = await write('/api/books', {title:'推荐返回验证', description:'仅供本地隔离验收', category:'玄幻'});
  expect(response.ok()).toBe(true);
  target = await response.json();created = true;
});
test.afterAll(async () => {
  if (created) {
    const {csrfToken} = await (await api.get('/api/auth/csrf')).json();
    expect((await api.delete(`/api/books/${target.id}`, {headers:{origin:base, 'x-csrf-token':csrfToken}})).ok()).toBe(true);
  }
  await api?.dispose();
});

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'connection', {value:{saveData:true, addEventListener(){}, removeEventListener(){}}});
    const animate = Element.prototype.animate;
    const directions:string[] = [];
    Object.assign(window, {recommendationMotions:directions});
    Element.prototype.animate = function (frames, options) {
      if (this.classList.contains('book-transition-snapshot')) directions.push(document.documentElement.dataset.bookTransition || '');
      return animate.call(this, frames, options);
    };
  });
  await page.route('**/api/auth/session', route => route.fulfill({json:{user:null, profile:null}}));
  await page.route('**/api/books/*/views', route => route.fulfill({json:{success:true, counted:false}}));
});

async function mockRecommendations(page: Page, mode: 'normal' | 'empty' | 'fallback' = 'normal') {
  const recommendations = Array.from({length:8}, (_, index) => ({id:index === 0 ? target.id : (2048 + index).toString(16).padStart(24, '0'), title:index === 0 ? target.title : `推荐作品${index}：新的旅程`, category:'玄幻', rating:4.2}));
  await page.route('**/api/books?*', route => {
    const category = new URL(route.request().url()).searchParams.has('category');
    if (mode === 'fallback' && category) return route.fulfill({status:503, json:{message:'unavailable'}});
    const books = mode === 'empty' ? [] : category ? recommendations.slice(0,2) : [...recommendations].reverse();
    return route.fulfill({json:[{id:source, title:'当前作品'}, ...books]});
  });
  return recommendations;
}

async function swipe(page: Page, x:number, y:number, dx:number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {type:'touchStart', touchPoints:[{x,y,id:1}]});
  for (let step = 1; step <= 8; step++) {
    await cdp.send('Input.dispatchTouchEvent', {type:'touchMove', touchPoints:[{x:x + dx * step / 8,y,id:1}]});
    await page.waitForTimeout(20);
  }
  await cdp.send('Input.dispatchTouchEvent', {type:'touchEnd', touchPoints:[]});
  await cdp.detach();
}

for (const width of [320,390,430,1440]) test(`eight recommendations below comments fit and scroll at ${width}px`, async ({page}, info) => {
  await page.setViewportSize({width,height:844});
  const expected = await mockRecommendations(page);
  await page.goto(`${base}/book/${source}`);
  const section = page.getByRole('region', {name:'猜你喜欢', exact:true});
  const rail = section.locator('.mh-shelf'), links = rail.locator('.mh-shelf-book');
  await expect(links).toHaveCount(8);
  const hrefs = await links.evaluateAll(nodes => nodes.map(node => node.getAttribute('href')));
  expect(new Set(hrefs).size).toBe(8);expect(hrefs).not.toContain(`/book/${source}`);
  expect(hrefs.slice(0,2)).toEqual(expected.slice(0,2).map(book => `/book/${book.id}`));
  const comments = (await page.locator('.book-community').boundingBox())!;
  expect((await section.boundingBox())!.y).toBeGreaterThanOrEqual(comments.y + comments.height);
  await section.scrollIntoViewIfNeeded();
  if (width < 768) await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.screenshot({path:info.outputPath(`verified-recommendations-${width}.png`)});
  if (width < 768) {
    const bounds = (await rail.boundingBox())!;
    await swipe(page, width - 30, bounds.y + 40, -(width - 70));
    await expect.poll(() => rail.evaluate(el => el.scrollLeft)).toBeGreaterThan(60);
    await expect(page).toHaveURL(`${base}/book/${source}`);
    for (let attempt = 0; attempt < 5; attempt++) {
      if (await rail.evaluate(el => el.scrollWidth - el.clientWidth - el.scrollLeft < 2)) break;
      await swipe(page, width - 30, bounds.y + 40, -(width - 70));
    }
    await expect(links.last()).toBeInViewport();
  } else {
    await expect(links.last()).toBeInViewport();
    expect((await links.first().boundingBox())!.width).toBeGreaterThan(110);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.screenshot({path:info.outputPath('verified-recommendations-dark.png')});
});

test('a recommended book returns to its source detail with animation', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await mockRecommendations(page);
  await page.goto(`${base}/book/${source}`);
  await page.locator('.book-recommendations .mh-shelf-book').first().click();
  await expect(page).toHaveURL(`${base}/book/${target.id}`);
  await expect(page.locator('html')).not.toHaveAttribute('data-book-transition', /.+/);
  const back = page.getByRole('link', {name:'返回上一本书'});
  await expect(back).toHaveAttribute('href', `/book/${source}`);
  await back.click();
  await expect(page).toHaveURL(`${base}/book/${source}`);
  await expect(page.locator('html')).not.toHaveAttribute('data-book-transition', /.+/);
  expect(await page.evaluate(() => (window as Window & {recommendationMotions?:string[]}).recommendationMotions)).toEqual(['enter','exit']);
});

test('recommendations fall back to popular books when category is unavailable', async ({page}) => {
  await mockRecommendations(page, 'fallback');
  await page.goto(`${base}/book/${source}`);
  await expect(page.locator('.book-recommendations .mh-shelf-book')).toHaveCount(8);
});

test('empty recommendations and failed requests stay usable with retry', async ({page}) => {
  await page.route('**/api/books?*', route => route.fulfill({status:503,json:{message:'unavailable'}}));
  await page.goto(`${base}/book/${source}`);
  const section = page.locator('.book-recommendations');
  await expect(section.getByRole('alert')).toContainText('推荐暂时加载失败');
  await mockRecommendations(page, 'empty');
  await section.getByRole('button', {name:'重试'}).click();
  await expect(section).toContainText('暂时没有其他书籍推荐');
  await expect(section.locator('.mh-shelf-book')).toHaveCount(0);
});
