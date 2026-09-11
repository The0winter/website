import {test, expect} from '@playwright/test';

const book = '000000000000000000000101', chapter = '000000000000000000000102';
const base = 'http://127.0.0.1:3000';

for (const [theme, mode, width, pageWidth] of [
  ['cream', 'horizontal', 390, 1000], ['cream', 'vertical', 320, 1000],
  ['cream', 'scroll', 390, 1000], ['blue', 'horizontal', 390, 1000],
  ['dark', 'scroll', 390, 1000], ['cream', 'horizontal', 1440, 1000],
  ['cream', 'scroll', 768, 500],
] as const) {
  test(`the paper and ink stay visually stable as loading becomes ${theme} ${mode} text at ${width}px`, async ({browser}, testInfo) => {
    const context = await browser.newContext({viewport: {width, height: 844}, isMobile: width < 768, hasTouch: true});
    const page = await context.newPage();
    try {
      await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
      await page.addInitScript(({theme, mode, pageWidth}) => {
        localStorage.setItem('has-seen-reading-hint', 'true');
        localStorage.setItem('novelhub_theme', JSON.stringify(theme === 'dark' ? 'dark' : 'light'));
        localStorage.setItem('reader_themeColor', JSON.stringify(theme === 'dark' ? 'cream' : theme));
        localStorage.setItem('reader_turnMode', JSON.stringify(mode));
        localStorage.setItem('reader_pageWidth', JSON.stringify(pageWidth));
        // Pause at the real handoff commit so its pixels can be inspected.
        const nativeFrame = window.requestAnimationFrame.bind(window);
        const waiting: FrameRequestCallback[] = [];
        Object.assign(window, {releasePaper: () => {window.requestAnimationFrame = nativeFrame; waiting.splice(0).forEach(callback => nativeFrame(callback));}});
        window.requestAnimationFrame = callback => nativeFrame(time => {
          if (document.querySelector('.chapter-loading-page[data-text-revealed=true]')) waiting.push(callback);
          else callback(time);
        });
      }, {theme, mode, pageWidth});
      await page.goto(`${base}/book/${book}`);
      await page.getByRole('button', {name: width < 768 ? /^目录 / : /^查看完整目录/}).click();
      const hold = await page.addStyleTag({content: '.reader-entry-content[data-entry-pending=false] {opacity:0!important}'});
      await page.getByRole('dialog', {name: '全部目录'}).locator(`a[href="/book/${book}/${chapter}"]`).click();
      const loading = page.locator('.chapter-loading-page'), message = loading.locator('.chapter-loading-message');
      await expect(page.locator('.reader-entry-content')).toHaveAttribute('data-entry-pending', 'false');
      // Settle adjacent-chapter insertion before comparing reveal/cleanup
      // pixels. The natural-frame tests separately cover real loading timing.
      await expect(page.locator('.reader-pages-root')).toHaveAttribute('data-reader-previous', /.+/, {timeout: 15000});
      await expect(message).toBeInViewport();
      const paper = await loading.locator('.chapter-loading-sheet').boundingBox();
      // The margins contain only paper; any colour, texture, border or desktop
      // surround change is a screen flash even when the text is ready.
      const clips = [
        {x: paper!.x, y: 30, width: 12, height: 700},
        {x: paper!.x + paper!.width - 12, y: 30, width: 12, height: 700},
        ...(width > pageWidth ? [{x: 2, y: 30, width: 12, height: 700}] : []),
      ];
      const before = [];
      for (const clip of clips) before.push(await page.screenshot({clip}));
      const compare = async (actual: Buffer, expected: Buffer, label: string) => {
        const difference = actual.equals(expected) ? 0 : await page.evaluate(async ({actual, expected}) => {
          const read = async (base64: string) => {
            const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
            const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context = canvas.getContext('2d')!;
            context.drawImage(bitmap, 0, 0); bitmap.close();
            return {width: canvas.width, height: canvas.height, pixels: context.getImageData(0, 0, canvas.width, canvas.height).data};
          };
          const [a, b] = await Promise.all([read(actual), read(expected)]);
          if (a.width !== b.width || a.height !== b.height) return 255;
          let maximum = 0;
          for (let index = 0; index < a.pixels.length; index++) maximum = Math.max(maximum, Math.abs(a.pixels[index] - b.pixels[index]));
          return maximum;
        }, {actual: actual.toString('base64'), expected: expected.toString('base64')});
        // Chromium can round composited paper noise by one 8-bit colour level.
        // This still rejects a dark backdrop, shifted text, or changed ink.
        if (difference > 1) {
          await testInfo.attach(`${label}-before`, {body: expected, contentType: 'image/png'});
          await testInfo.attach(`${label}-after`, {body: actual, contentType: 'image/png'});
        }
        expect(difference, label).toBeLessThanOrEqual(1);
      };
      const original = await loading.elementHandle();
      await hold.evaluate(element => (element as HTMLElement).remove());
      await expect(loading).toHaveAttribute('data-text-revealed', 'true');
      await expect(message).toBeHidden();
      expect(await original!.evaluate(element => element.isConnected)).toBe(true);
      await expect(page.locator('.reader-text-window')).toBeVisible();
      await expect(page.locator('.reader-page-surface')).toHaveCSS('background-color', await loading.locator('.chapter-loading-sheet').evaluate(element => getComputedStyle(element).backgroundColor));
      const textAtReveal = await page.locator('.reader-text-window').screenshot();
      for (let index = 0; index < clips.length; index++) await compare(await page.screenshot({clip: clips[index]}), before[index], `retained paper strip ${index}`);
      await page.evaluate(() => (window as unknown as {releasePaper: () => void}).releasePaper());
      await expect(loading).toHaveCount(0);
      await compare(await page.locator('.reader-text-window').screenshot(), textAtReveal, 'text must not change antialiasing after its reveal');
      for (let index = 0; index < clips.length; index++) await compare(await page.screenshot({clip: clips[index]}), before[index], `final paper strip ${index}`);
      await page.keyboard.press('m');
      await expect(page.locator('.reader-tools')).toHaveAttribute('aria-hidden', 'false');
    } finally {await context.close();}
  });
}
