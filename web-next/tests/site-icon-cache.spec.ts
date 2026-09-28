import {test, expect} from '@playwright/test';

// Run against a production build: development deliberately disables caching.
const base = process.env.ICON_CACHE_BASE || 'http://127.0.0.1:3000';
const isIcon = (url: string) => /\/(?:icon|favicon)(?:[.][\w-]+)*\.(?:png|ico)(?:\?|$)/.test(url);
type IconRequest = {url: string; transferred?: number; cached?: boolean; cacheControl?: string};

for (const width of [393, 1440]) {
  test.describe(`site icon at ${width}px`, () => {
    test.use({viewport: {width, height: 851}, isMobile: width < 768, hasTouch: width < 768, actionTimeout: 15000});

    test('one immutable download survives book navigation and a warm document', async ({page}, info) => {
      const cdp = await page.context().newCDPSession(page);
      const requests = new Map<string, IconRequest>();
      const errors: string[] = [];
      // context.route(), including the usual analytics fixture, disables HTTP
      // caching. Block the same analytics/write endpoints through CDP instead.
      await cdp.send('Network.enable');
      await cdp.send('Network.setBlockedURLs', {urls: [
        '*://*.google-analytics.com/*', '*://*.googletagmanager.com/*',
        '*://analytics.google.com/*', '*://stats.g.doubleclick.net/*',
        '*/api/books/*/views', '*/api/traffic/observe',
      ]});
      cdp.on('Network.requestWillBeSent', e => {
        if (isIcon(e.request.url)) requests.set(e.requestId, {url: e.request.url});
      });
      cdp.on('Network.responseReceived', e => {
        const request = requests.get(e.requestId);
        if (request) {
          const headers = Object.fromEntries(Object.entries(e.response.headers).map(([key, value]) => [key.toLowerCase(), String(value)]));
          request.cacheControl = headers['cache-control'];
          request.cached ||= e.response.fromDiskCache || e.response.fromServiceWorker;
        }
      });
      cdp.on('Network.requestServedFromCache', e => {const request = requests.get(e.requestId); if (request) request.cached = true;});
      cdp.on('Network.loadingFinished', e => {const request = requests.get(e.requestId); if (request) request.transferred = e.encodedDataLength;});
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(() => {
        localStorage.setItem('has-seen-reading-hint', 'true');
        Object.defineProperty(navigator, 'connection', {value: {saveData: true, addEventListener() {}, removeEventListener() {}}});
      });

      await page.goto(base);
      await page.waitForFunction(() => history.state?.bookNavigation?.kind === 'home');
      const icon = page.locator('head link[rel~="icon"]');
      await expect(icon).toHaveCount(1);
      await expect(icon).toHaveAttribute('href', /\/_next\/static\/media\/icon\.[\w-]+\.png$/);
      const href = await icon.getAttribute('href');
      const original = await icon.elementHandle();
      const downloads = () => [...requests.values()].filter(request => (request.transferred || 0) > 0 && !request.cached);
      await expect.poll(() => downloads().length).toBe(1);
      expect(downloads()[0].cacheControl).toMatch(/max-age=31536000/);
      expect(downloads()[0].cacheControl).toContain('immutable');

      const home = page.locator(width < 768 ? '.mobile-home' : '.desktop-home');
      await home.locator('a[href^="/book/"]:visible').first().click();
      await expect(page.locator('.book-detail:visible')).toBeVisible();
      await expect(page.locator('.book-transition-snapshot')).toHaveCount(0);
      expect(await original!.evaluate(node => node.isConnected && node === document.querySelector('link[rel~="icon"]'))).toBe(true);
      await page.goBack();
      await expect(home).toBeVisible();
      await page.goForward();
      await expect(page.locator('.book-detail:visible')).toBeVisible();
      await expect(page.locator('.book-transition-snapshot')).toHaveCount(0);
      expect(await original!.evaluate(node => node.isConnected && node === document.querySelector('link[rel~="icon"]'))).toBe(true);
      await expect(icon).toHaveCount(1);
      await expect(icon).toHaveAttribute('href', href!);
      // A new document may look up the icon again, but the browser can reuse the
      // content-addressed response without downloading or validating it.
      await page.goto(base);
      await page.waitForFunction(() => history.state?.bookNavigation?.kind === 'home');
      await page.waitForTimeout(500);
      await expect(icon).toHaveCount(1);
      await expect(icon).toHaveAttribute('href', href!);
      expect(downloads()).toHaveLength(1);
      expect([...requests.values()].some(request => new URL(request.url).pathname === '/favicon.ico')).toBe(false);
      expect(errors).toEqual([]);
      await info.attach('icon-network', {body: JSON.stringify([...requests.values()]), contentType: 'application/json'});
    });
  });
}
