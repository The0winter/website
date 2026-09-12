import {test, expect, type Page} from '@playwright/test';

const base = process.env.RANKING_BASE || 'http://127.0.0.1:3000';
const book = process.env.RANKING_BOOK || '000000000000000000000101';
const chapter = process.env.RANKING_CHAPTER || book;
const books = Array.from({length: 30}, (_, i) => ({id: i === 6 ? book : (700 + i).toString(16).padStart(24, '0'), title: `榜单作品 ${i + 1}`, author: '测试作者', views: 12000 - i, rating: 4.6}));
const idle = async (page: Page) => {await expect(page.locator('html')).not.toHaveAttribute('data-book-transition', /.+/); await expect(page.locator('.chapter-loading-page')).toHaveCount(0);};

async function setup(page: Page, width = 390) {
  await page.setViewportSize({width, height: 844});
  await page.addInitScript(() => {
    localStorage.setItem('has-seen-reading-hint', 'true');
    Object.defineProperty(navigator, 'connection', {value: {saveData: true, addEventListener() {}, removeEventListener() {}}});
    document.addEventListener('DOMContentLoaded', () => {const style = document.createElement('style'); style.textContent = 'nextjs-portal{display:none}'; document.head.append(style);});
  });
  const requests: string[] = [];
  await page.route('**/api/books?*', route => {requests.push(route.request().url()); return route.fulfill({json: books});});
  await page.goto(base + '/ranking');
  await expect(page.locator('.ranking-row')).toHaveCount(30);
  await page.getByRole('button', {name: '周榜', exact: true}).click();
  await page.getByRole('button', {name: '悬疑', exact: true}).click();
  await expect(page.locator('.ranking-content')).toHaveAttribute('aria-busy', 'false');
  await page.evaluate(() => {scrollTo(0, 640); document.querySelector('.ranking-categories')!.scrollLeft = 300;});
  await page.evaluate(() => document.fonts.ready);
  return requests;
}

for (const width of [320, 390, 1440]) test(`ranking keeps its exact list and scroll through repeated detail returns at ${width}px`, async ({page}) => {
  const requests = await setup(page, width);
  const position = await page.evaluate(() => ({top: scrollY, categories: document.querySelector('.ranking-categories')!.scrollLeft}));
  const count = requests.length;
  for (let visit = 0; visit < 2; visit++) {
    // Programmatic activation preserves the chosen scroll even on desktop,
    // where Playwright otherwise scrolls this long list to reveal the link.
    await page.locator(`.ranking-card[href="/book/${book}"]`).evaluate(el => (el as HTMLElement).click());
    await expect(page.locator('.book-detail:visible')).toBeVisible(); await idle(page);
    await page.goBack(); await idle(page);
    await expect(page.locator('.ranking-row')).toHaveCount(30);
    await expect(page.getByRole('button', {name: '周榜', exact: true})).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', {name: '悬疑', exact: true})).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => ({top: scrollY, categories: document.querySelector('.ranking-categories')!.scrollLeft}))).toEqual(position);
    expect(requests).toHaveLength(count);
  }
});

for (const top of [0, 640]) test(`the ranking under the incoming book never shifts at scroll ${top}`, async ({page}, info) => {
  await page.addInitScript(() => {
    const attach = Element.prototype.attachShadow;
    Object.assign(window, {frozenPages: [] as ShadowRoot[]});
    Element.prototype.attachShadow = function(options) {
      const shadow = attach.call(this, options);
      if (this.classList.contains('book-transition-snapshot')) (window as unknown as {frozenPages: ShadowRoot[]}).frozenPages.push(shadow);
      return shadow;
    };
    const animate = Element.prototype.animate;
    Element.prototype.animate = function(frames, options) {
      const animation = animate.call(this, frames, options);
      if (this.classList.contains('book-navigation-loading')) {animation.pause(); animation.currentTime = 0;}
      return animation;
    };
  });
  await setup(page); await page.evaluate(top => scrollTo(0, top), top);
  const before = await page.locator('.ranking-row').evaluateAll(rows => rows.map(row => {const r = row.getBoundingClientRect(); return {x:r.x, y:r.y, width:r.width, height:r.height};}));
  await page.screenshot({path: info.outputPath('before.png')});
  await page.locator(`.ranking-card[href="/book/${book}"]`).evaluate(el => (el as HTMLElement).click());
  await expect(page.locator('.book-navigation-loading')).toBeVisible();
  const frozen = await page.evaluate(() => [...(window as unknown as {frozenPages: ShadowRoot[]}).frozenPages[0].querySelectorAll('.ranking-row')].map(row => {const r=row.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height};}));
  expect(frozen).toEqual(before);
  await page.screenshot({path: info.outputPath('frozen.png')});
  await page.locator('.book-navigation-loading').evaluate(el => el.getAnimations().forEach(animation => animation.finish()));
  await idle(page);
});

test('short reading retains the ranking; five foreground minutes release it across chapter changes', async ({page}) => {
  await page.clock.install();
  const requests = await setup(page);
  const count = requests.length;
  await page.locator(`.ranking-card[href="/book/${book}"]`).evaluate(el => (el as HTMLElement).click());
  await expect(page.locator('.book-detail:visible')).toBeVisible(); await idle(page);
  await page.getByRole('link', {name:'立即阅读', exact:true}).click();
  await expect(page.locator('[data-reader-ready=true]')).toBeVisible(); await idle(page);
  await page.clock.fastForward(2 * 60 * 1000);
  await page.goBack(); await idle(page); await page.goBack(); await idle(page);
  expect(requests).toHaveLength(count);
  await expect(page.locator('.ranking-row')).toHaveCount(30);
  await page.goForward(); await idle(page); await page.goForward(); await idle(page);
  await expect(page.locator('[data-reader-ready=true]')).toBeVisible();
  await page.keyboard.press('Control+ArrowRight');
  await expect(page.locator('[data-reader-ready=true]')).not.toHaveAttribute('data-reader-chapter', chapter);
  await page.clock.fastForward(3 * 60 * 1000 + 1000);
  await page.goBack(); await idle(page); await page.goBack(); await idle(page);
  await expect(page.locator('.ranking-row')).toHaveCount(30);
  expect(requests).toHaveLength(count + 1);
  await expect(page.getByRole('button', {name:'周榜', exact:true})).toHaveAttribute('aria-pressed','true');
});

test('time in details and a background reader does not expire a ranking', async ({page}) => {
  await page.clock.install();
  const requests = await setup(page);
  const count = requests.length;
  await page.locator(`.ranking-card[href="/book/${book}"]`).evaluate(el => (el as HTMLElement).click());
  await expect(page.locator('.book-detail:visible')).toBeVisible(); await idle(page);
  await page.clock.fastForward(10 * 60 * 1000);
  await page.getByRole('link', {name:'立即阅读', exact:true}).click();
  await expect(page.locator('[data-reader-ready=true]')).toBeVisible(); await idle(page);
  await page.evaluate(() => {Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'}); document.dispatchEvent(new Event('visibilitychange'));});
  await page.clock.fastForward(10 * 60 * 1000);
  await page.evaluate(() => {Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'}); document.dispatchEvent(new Event('visibilitychange'));});
  await page.goBack(); await idle(page); await page.goBack(); await idle(page);
  await expect(page.locator('.ranking-row')).toHaveCount(30);
  expect(requests).toHaveLength(count);
});
