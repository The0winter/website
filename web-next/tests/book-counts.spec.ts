import {test, expect} from './fixtures/without-analytics';
import {compactCountParts, formatCompactCount} from '../lib/compact-count';

const base = process.env.DETAIL_BASE || 'http://127.0.0.1:3000';
const book = process.env.DETAIL_BOOK || '000000000000000000000101';

test('Chinese counts round and promote units consistently at boundaries', () => {
  const examples: [number, string][] = [[0, '0'], [9999, '9999'], [10000, '1万'], [10499, '1万'],
    [10500, '1.1万'], [123456, '12.3万'], [99999499, '9999.9万'], [99999500, '1亿'],
    [100000000, '1亿'], [123456789, '1.2亿'], [1e12, '1万亿'], [-1, '0'], [NaN, '0'], [Infinity, '0']];
  for (const [value, expected] of examples) {
    expect(formatCompactCount(value)).toBe(expected);
    const parts = compactCountParts(value);
    expect(parts.value + parts.unit).toBe(expected);
  }
});

for (const capability of ['native', 'ignored-compact', 'missing-parts', 'english-locale']) {
  test(`detail counts stay compact with ${capability}`, async ({page}, info) => {
    await page.setViewportSize({width: 320, height: 844});
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error' && /hydration|hydrating|#418/i.test(message.text())) errors.push(message.text());
    });
    await page.addInitScript(mode => {
      const NativeNumberFormat = Intl.NumberFormat;
      if (mode !== 'native') {
        Intl.NumberFormat = new Proxy(NativeNumberFormat, {
          construct(target, [locales, options]) {
            const compact = options?.notation === 'compact';
            const formatter = new target(mode === 'english-locale' && compact ? 'en-US' : locales,
              compact && mode !== 'english-locale' ? {...options, notation: 'standard'} : options);
            if (mode === 'missing-parts') Object.defineProperty(formatter, 'formatToParts', {value: undefined});
            return formatter;
          },
        });
      }
      Object.defineProperty(navigator, 'connection', {value: {saveData: true, addEventListener() {}, removeEventListener() {}}});
    }, capability);
    await page.route('**/traffic-observer.js', route => route.abort());
    await page.route('**/api/traffic/observe', route => route.fulfill({status: 204}));
    const sample = {counts: {favorites: 12345, views: 123456}, next: {favorites: 50000, views: 200000}, events: []};
    await page.route(`**/api/books/${book}/milestones`, route => route.fulfill({json: sample}));
    await page.goto(`${base}/book/${book}`);
    await expect(page.locator('#reviews-panel')).toHaveAttribute('aria-busy', 'false');
    const views = page.locator('.book-mobile-stats > div').filter({has: page.locator('dt', {hasText: '浏览量'})}).locator('dd');
    await expect(views).toHaveText(/^[\d.]+[万亿]$/);
    const entry = page.getByRole('button', {name: '查看作品里程碑'});
    await entry.click();
    const sheet = page.getByRole('dialog', {name: '作品里程碑'});
    await expect(sheet.locator('.milestone-progress strong')).toHaveText(['1.2万', '12.3万']);
    await sheet.getByRole('button', {name: '返回书籍详情'}).click();
    await expect(views.locator('.book-stat-value')).toHaveText('12.3');
    await expect(views.locator('small')).toHaveText('万');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path: info.outputPath(`verified-${capability}-mobile.png`)});
    await page.setViewportSize({width: 1440, height: 900});
    const desktopViews = page.locator('.book-hero-info div').filter({has: page.locator('span', {hasText: /^阅读量:$/})}).last();
    await expect(desktopViews).toContainText('123,456');
    await page.screenshot({path: info.outputPath(`verified-${capability}-desktop.png`)});
    expect(errors).toEqual([]);
  });
}
