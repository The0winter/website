import {test, expect, type Page} from '@playwright/test';

const base = 'http://127.0.0.1:3000';
const book = '000000000000000000000101';
const detail = `/book/${book}`;
const reader = `${detail}/${book}`;
const idle = async (page: Page) => {
  await expect(page.locator('html')).not.toHaveAttribute('data-book-transition', /.+/);
  await expect(page.locator('.chapter-loading-page')).toHaveCount(0);
};

test.beforeEach(async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.addInitScript(() => {
    localStorage.setItem('has-seen-reading-hint', 'true');
    Object.defineProperty(navigator, 'connection', {value: {saveData: true, addEventListener() {}, removeEventListener() {}}});
  });
});

test('Back restores visited details and home without route requests and retains scroll', async ({page}) => {
  await page.goto(base);
  await page.getByRole('combobox').fill('山海');
  await page.getByRole('combobox').press('Escape');
  const card = page.locator(`.mh-section a[href="${detail}"]`).last();
  await card.scrollIntoViewIfNeeded();
  // Clicking may scroll the card away from the fixed bottom navigation first.
  // Capture the actual departure position, not the earlier scroll-into-view.
  await card.evaluate(el => el.addEventListener('click', () => {
    (window as Window & {departureScroll?: number}).departureScroll = scrollY;
  }, {once: true, capture: true}));
  await card.click();
  await expect(page).toHaveURL(base + detail);
  await idle(page);
  await page.getByRole('link', {name: '立即阅读', exact: true}).click();
  await expect(page.locator('[data-reader-ready="true"]')).toBeVisible();
  await idle(page);
  const requests: string[] = [];
  // No prefetch is available, and either unwanted replacement would be held.
  await page.route('**/*?_rsc=*', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === detail || path === '/') {requests.push(path); return route.abort();}
    return route.continue();
  });
  await page.goBack();
  await expect(page).toHaveURL(base + detail);
  await expect(page.locator('.book-detail')).toBeVisible();
  await idle(page);
  await page.goBack();
  await expect(page).toHaveURL(base + '/');
  await expect(page.locator('.mobile-home')).toBeVisible();
  await idle(page);
  expect(requests).toEqual([]);
  expect(await page.evaluate(() => Math.abs(scrollY - (window as Window & {departureScroll?: number}).departureScroll!))).toBeLessThan(3);
  await page.goForward();
  await expect(page).toHaveURL(base + detail);
  await idle(page);
  await expect(page.locator('.book-detail:visible')).toBeVisible();
  expect(requests).toEqual([]);
});

test('a synthetic home predecessor still loads its actual route after a direct detail entry', async ({page}) => {
  await page.goto(base + detail);
  await expect.poll(() => page.evaluate(() => history.state?.bookNavigation?.href)).toBe(detail);
  await idle(page);
  await expect(page.locator('.book-detail:visible')).toBeVisible();
  const requests: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === '/' && url.searchParams.has('_rsc')) requests.push(url.pathname);
  });
  await page.goBack();
  await expect(page).toHaveURL(base + '/');
  await expect(page.locator('.mobile-home')).toBeVisible();
  await expect(page.locator('.book-detail')).toHaveCount(0);
  await idle(page);
  expect(requests.length).toBeGreaterThan(0);
});

test('reload invalidates earlier cache markers and keeps Back functional', async ({page}) => {
  await page.goto(base);
  await page.locator(`.mh-banner[href="${detail}"]`).click();
  await expect(page).toHaveURL(base + detail);
  await idle(page);
  await page.reload();
  await idle(page);
  await page.goBack();
  await expect(page.locator('.mobile-home')).toBeVisible();
  await idle(page);
  await page.goForward();
  await expect(page.locator('.book-detail')).toBeVisible();
  await idle(page);
});

test('reader chapter replacements still restore the latest chapter with Forward', async ({page}) => {
  await page.goto(base + detail);
  await page.getByRole('link', {name: '立即阅读', exact: true}).click();
  await expect(page).toHaveURL(base + reader);
  await expect(page.locator('[data-reader-ready="true"]')).toBeVisible();
  await idle(page);
  await page.keyboard.press('Control+ArrowRight');
  await expect(page).toHaveURL(base + `${detail}/000000000000000000000102`);
  await page.goBack();
  await expect(page.locator('.book-detail')).toBeVisible();
  await idle(page);
  await page.goForward();
  await expect(page.locator('[data-reader-ready="true"]')).toHaveAttribute('data-reader-chapter', '000000000000000000000102');
  await idle(page);
});
