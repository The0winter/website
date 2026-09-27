import {test, expect} from './fixtures/without-analytics';
import type {Page} from '@playwright/test';

const base = process.env.WARMUP_BASE || 'http://127.0.0.1:3000';
const detailCode = (text: string) => text.includes('book-review-content') && text.includes('book-hero-cover');

async function observe(page: Page) {
  const chunks: string[] = [], data: string[] = [], errors: string[] = [];
  page.on('response', async response => {
    if (response.request().resourceType() === 'script') {
      try {if (detailCode(await response.text())) chunks.push(response.url());} catch {}
    }
  });
  page.on('request', request => {
    if (/^\/(?:api\/)?books?\/[^/]+/.test(new URL(request.url()).pathname)) data.push(request.url());
  });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'connection', {value: {saveData: true, addEventListener() {}, removeEventListener() {}}});
    localStorage.setItem('has-seen-reading-hint', 'true');
  });
  return {chunks, data, errors};
}

for (const mode of ['mobile', 'mobile-fallback', 'desktop']) {
  test(`${mode}: home downloads shared detail code before any book interaction, without book data`, async ({page}, info) => {
    await page.setViewportSize({width: mode === 'desktop' ? 1440 : 393, height: 851});
    const seen = await observe(page);
    if (mode === 'mobile-fallback') await page.addInitScript(() => {
      // Suppress visibility notifications without breaking unrelated consumers.
      const Observer = window.IntersectionObserver;
      window.IntersectionObserver = class extends Observer {constructor() {super(() => {});}};
      Reflect.deleteProperty(window, 'requestIdleCallback');
      Reflect.deleteProperty(window, 'cancelIdleCallback');
    });
    await page.goto(base);
    const home = page.locator(mode === 'desktop' ? '.desktop-home' : '.mobile-home');
    await expect(home).toBeVisible();
    await expect.poll(() => seen.chunks.length).toBe(1);
    expect(seen.data).toEqual([]);
    await expect(page.locator('.book-detail')).toHaveCount(0);
    const warmup = await page.evaluate(url => {
      const resource = performance.getEntriesByName(url)[0] as PerformanceResourceTiming;
      return {firstContentfulPaint: performance.getEntriesByName('first-contentful-paint')[0]?.startTime,
        codeStart: resource.startTime, codeReady: resource.responseEnd, codeBytes: resource.encodedBodySize};
    }, seen.chunks[0]);
    // Paint timestamps can be rounded to the following frame by the browser.
    expect(warmup.codeStart + 50).toBeGreaterThanOrEqual(warmup.firstContentfulPaint!);
    const start = Date.now();
    await home.locator('a[href^="/book/"]:visible').first().click();
    await expect(page.locator('.book-detail:visible')).toBeVisible();
    await info.attach('warmup-timing', {body: JSON.stringify({...warmup, firstClickMs: Date.now() - start}), contentType: 'application/json'});
    await expect(page.getByRole('link', {name: /^(立即阅读|开始阅读)$/}).filter({visible: true})).toBeVisible();
    await page.goBack();
    await expect(home).toBeVisible();
    expect(seen.chunks).toHaveLength(1);
    expect(seen.errors).toEqual([]);
  });
}

for (const state of ['hidden', 'offline'] as const) {
  test(`${state}: postpone background code until home is visible and online`, async ({page}) => {
    await page.setViewportSize({width: 393, height: 851});
    const seen = await observe(page);
    await page.addInitScript(state => {
      let paused = true;
      if (state === 'hidden') Object.defineProperty(document, 'visibilityState', {get: () => paused ? 'hidden' : 'visible'});
      else Object.defineProperty(navigator, 'onLine', {get: () => !paused});
      Object.assign(window, {resumeWarmup: () => {
        paused = false;
        if (state === 'hidden') document.dispatchEvent(new Event('visibilitychange'));
        else window.dispatchEvent(new Event('online'));
      }});
    }, state);
    await page.goto(base);
    await expect(page.locator('.mobile-account-link:visible')).toHaveAttribute('href', '/login');
    await page.waitForTimeout(1300);
    expect(seen.chunks).toEqual([]);
    await page.evaluate(() => (window as unknown as {resumeWarmup: () => void}).resumeWarmup());
    await expect.poll(() => seen.chunks.length).toBe(1);
    expect(seen.data).toEqual([]);
    expect(seen.errors).toEqual([]);
  });
}
