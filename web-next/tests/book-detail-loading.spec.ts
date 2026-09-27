import {test, expect} from './fixtures/without-analytics';

const base = process.env.DETAIL_BASE || 'http://127.0.0.1:3000';
const book = process.env.DETAIL_BOOK || '000000000000000000000101';
const android = 'Mozilla/5.0 (Linux; Android 12; M2102K1C) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Mobile Safari/537.36';

for (const scenario of [
  {name:'Chrome', agent:android, saveData:false, width:390},
  {name:'QQ data saver', agent:android+' MQQBrowser/15.0', saveData:true, width:390},
  {name:'Quark', agent:android+' Quark/7.0.0.0', saveData:false, width:390},
  {name:'Xiaomi data saver', agent:android+' MiuiBrowser/18.0.0', saveData:true, width:390},
  {name:'Desktop', agent:undefined, saveData:false, width:1440},
]) {
  test.describe(scenario.name, () => {
    test.use({viewport:{width:scenario.width,height:844}, isMobile:scenario.width<768, hasTouch:scenario.width<768, userAgent:scenario.agent});
    test('detail code loads without waiting for route data, and history stays usable', async ({page}, info) => {
      await page.addInitScript(saveData => {
        Object.defineProperty(navigator, 'connection', {value:{saveData, effectiveType:'4g', addEventListener(){}, removeEventListener(){}}});
        localStorage.setItem('has-seen-reading-hint', 'true');
      }, scenario.saveData);
      await page.route('**/api/books/*/views', route => route.fulfill({json:{success:true,counted:false}}));
      const detailChunks: string[] = [], errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', async response => {
        if (!response.url().includes('/_next/static/chunks/') || !response.url().split('?')[0].endsWith('.js')) return;
        try {if ((await response.text()).includes('book-detail min-h-screen')) detailChunks.push(response.url());} catch { /* Cancelled downloads are not ready. */ }
      });
      let release!: () => void;
      const gate = new Promise<void>(resolve => {release = resolve;});
      await page.route(`**/book/${book}?_rsc=*`, async route => {await gate; await route.continue();});
      try {
        await page.goto(base);
        const link = page.locator(`${scenario.width<768 ? '.mobile-home' : '.desktop-home'} a[href="/book/${book}"]:visible`).first();
        await expect(link).toBeVisible();
        await expect.poll(() => page.evaluate(() => history.state?.bookNavigation?.kind)).toBe('home');
        if (scenario.saveData) {
          // No automatic detail download while a data-saving reader is browsing.
          await page.waitForTimeout(400);
          expect(detailChunks).toHaveLength(0);
        } else await expect.poll(() => detailChunks.length, {timeout:15000}).toBeGreaterThan(0);
        if (scenario.width<768) await link.tap(); else await link.click();
        await expect(page.locator('.book-navigation-loading')).toBeVisible();
        await expect.poll(() => detailChunks.length, {timeout:15000}).toBeGreaterThan(0);
        await expect(page.locator('.book-detail')).toHaveCount(0);
        release();
        await expect(page.locator('.book-detail:visible')).toHaveAttribute('data-book-id', book);
        await expect(page.locator('.book-transition-snapshot')).toHaveCount(0);
        await page.screenshot({path:info.outputPath('verified-detail.png')});
        await page.goBack();
        await expect(page).toHaveURL(base+'/');
        await expect(page.locator('.book-transition-snapshot')).toHaveCount(0);
        await page.goForward();
        await expect(page.locator('.book-detail:visible')).toHaveAttribute('data-book-id', book);
        await expect(page.locator('.book-transition-snapshot')).toHaveCount(0);
        expect(errors).toEqual([]);
      } finally {release();}
    });
  });
}
