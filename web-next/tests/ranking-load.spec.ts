import {test, expect} from './fixtures/without-analytics';
const base = process.env.RANKING_LOAD_BASE || 'http://127.0.0.1:3000';
test.use({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});

test('fetch the first ranking page during the cold route request, then reuse it exactly once', async ({page}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'connection', {value: {saveData: true, addEventListener() {}, removeEventListener() {}}});
  });
  let release!: () => void;
  const pending = new Promise<void>(resolve => {release = resolve;});
  await page.route('**/ranking?_rsc=*', async route => {await pending; await route.continue();});
  const requests: string[] = [];
  await page.route('**/api/books?*', async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('orderBy') !== 'rank_day') return route.continue();
    requests.push(url.href);
    await route.fulfill({headers: {'X-Total-Count': '1'}, json: [{id: '000000000000000000000101', title: '并行加载测试作品', author: '测试作者', rankingScore: 82, rankingViews: 100}]});
  });
  try {
    await page.goto(base);
    await page.waitForFunction(() => Boolean(history.state?.bookNavigation));
    // Loading the home page alone must not consume an extra ranking request.
    expect(requests).toHaveLength(0);
    await page.locator('.mh-shortcuts a[href="/ranking"]').tap();
    await expect.poll(() => requests.length).toBe(1);
    expect(new URL(requests[0]).searchParams.get('fields')).toBe('ranking');
    await expect(page.locator('main .ranking-page')).toHaveCount(0);
    release();
    await expect(page.locator('main .ranking-row')).toHaveCount(1);
    await expect(page.locator('main .ranking-book-info h2')).toHaveText('并行加载测试作品');
    await expect(page.locator('.book-transition-snapshot')).toHaveCount(0);
    expect(requests).toHaveLength(1);
  } finally {release();}
});
