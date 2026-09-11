import {test, expect} from '@playwright/test';

const book = '000000000000000000000101', chapter = '000000000000000000000102';
const base = 'http://127.0.0.1:3000';

for (const [theme, mode, width, pageWidth] of [
  ['cream', 'horizontal', 390, 1000], ['cream', 'vertical', 320, 1000],
  ['cream', 'scroll', 390, 1000], ['blue', 'horizontal', 390, 1000],
  ['dark', 'scroll', 390, 1000], ['cream', 'horizontal', 1440, 1000],
  ['cream', 'scroll', 768, 500],
] as const) {
  test(`the paper stays pixel-identical as loading text becomes ${theme} ${mode} text at ${width}px`, async ({browser}) => {
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
      const original = await loading.elementHandle();
      await hold.evaluate(element => (element as HTMLElement).remove());
      await expect(loading).toHaveAttribute('data-text-revealed', 'true');
      await expect(message).toBeHidden();
      expect(await original!.evaluate(element => element.isConnected)).toBe(true);
      await expect(page.locator('.reader-text-window')).toBeVisible();
      await expect(page.locator('.reader-page-surface')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      for (let index = 0; index < clips.length; index++) expect((await page.screenshot({clip: clips[index]})).equals(before[index]), `retained paper strip ${index}`).toBe(true);
      await page.evaluate(() => (window as unknown as {releasePaper: () => void}).releasePaper());
      await expect(loading).toHaveCount(0);
      for (let index = 0; index < clips.length; index++) expect((await page.screenshot({clip: clips[index]})).equals(before[index]), `final paper strip ${index}`).toBe(true);
      await page.keyboard.press('m');
      await expect(page.locator('.reader-tools')).toHaveAttribute('aria-hidden', 'false');
    } finally {await context.close();}
  });
}
