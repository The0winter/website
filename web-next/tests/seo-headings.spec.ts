import {test, expect} from './fixtures/without-analytics';

const base = process.env.SEO_BASE || 'http://127.0.0.1:3000';

for (const width of [390, 1440]) test(`hydrated public pages have one H1 including closed shadow trees at ${width}px`, async ({page, request}) => {
  await page.setViewportSize({width, height: 844});
  await page.addInitScript(() => {
    // Search-engine rendered HTML can include even closed, hidden shadow trees.
    // Keep their native behavior while retaining references for this assertion.
    const roots: ShadowRoot[] = [];
    Object.assign(window, {seoShadowRoots: roots});
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function(options) {
      const root = attach.call(this, options); roots.push(root); return root;
    };
  });
  const response = await request.get(base + '/api/books?limit=1');
  expect(response.ok()).toBeTruthy();
  const [book] = await response.json();
  for (const path of [`/book/${book.id || book._id}`, '/ranking', '/']) {
    await page.goto(base + path);
    await page.waitForFunction(() => (window as unknown as {seoShadowRoots: ShadowRoot[]}).seoShadowRoots
      .some(root => root.host.isConnected && root.querySelector('[data-mobile-section-shell="/ranking"] .ranking-title')));
    const headings = await page.evaluate(() => {
      const roots = (window as unknown as {seoShadowRoots: ShadowRoot[]}).seoShadowRoots.filter(root => root.host.isConnected);
      return [document, ...roots].flatMap(root => [...root.querySelectorAll('h1')].map(node => node.textContent));
    });
    expect(headings, `${path}: initial HTML and hydrated shadow trees`).toHaveLength(1);
    if (path === '/ranking') await expect(page.locator('h1.ranking-title')).toContainText('排行榜');
  }
});
