import {test, expect} from '@playwright/test';

const url = 'http://127.0.0.1:3000/book/000000000000000000000101/000000000000000000000101';

for (const width of [320, 390, 430]) {
  test(`mobile paper follows the page and restores identical pixels at ${width}px`, async ({browser}, testInfo) => {
    const context = await browser.newContext({viewport: {width, height: 844}, reducedMotion: 'reduce'});
    const page = await context.newPage();
    try {
      await page.addInitScript(() => localStorage.setItem('has-seen-reading-hint', 'true'));
      await page.goto(url);
      const root = page.locator('.reader-pages-root:visible'), sheet = root.locator('.reader-page-window > .reader-page-surface');
      const number = sheet.locator('[data-reader-page]'), body = sheet.locator('.reader-columns');
      await expect(root).toHaveAttribute('data-reader-ready', 'true');
      await expect(body).toHaveCSS('font-size', '22px');
      await expect(body).toHaveCSS('line-height', '33px');
      await expect(body.locator('p').first()).toHaveCSS('margin-bottom', '15.84px');
      await page.addStyleTag({content: 'nextjs-portal{display:none!important}'});
      const clip = {x: 2, y: 100, width: 12, height: 600};
      const samePaper = async (expected: Buffer, label: string) => {
        const actual = await page.screenshot({clip});
        if (actual.equals(expected)) return;
        await testInfo.attach(`${label}-before`, {body: expected, contentType: 'image/png'});
        await testInfo.attach(`${label}-after`, {body: actual, contentType: 'image/png'});
        const difference = await page.evaluate(async ({actual, expected}) => {
          const pixels = async (base64: string) => {
            const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
            const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context = canvas.getContext('2d')!;
            context.drawImage(bitmap, 0, 0); bitmap.close();
            return context.getImageData(0, 0, canvas.width, canvas.height).data;
          };
          const [a, b] = await Promise.all([pixels(actual), pixels(expected)]);
          return a.reduce((maximum, value, index) => Math.max(maximum, Math.abs(value - b[index])), 0);
        }, {actual: actual.toString('base64'), expected: expected.toString('base64')});
        // Chromium can round a composited image by one 8-bit colour level.
        expect(difference, label).toBeLessThanOrEqual(1);
      };
      const first = await page.screenshot({clip});
      await page.screenshot({path: testInfo.outputPath('first-page.png')});
      await page.keyboard.press('ArrowRight');
      await expect(number).toHaveText(/^2\//);
      await expect(sheet).toHaveCSS('background-position', '-137px -211px');
      const second = await page.screenshot({clip});
      expect(second.equals(first), 'a new sheet samples a different texture').toBe(false);
      await page.screenshot({path: testInfo.outputPath('second-page.png')});
      await page.keyboard.press('ArrowLeft');
      await expect(number).toHaveText(/^1\//);
      await samePaper(first, 'turn back');
      await page.keyboard.press('ArrowRight');
      await expect(number).toHaveText(/^2\//);
      await samePaper(second, 'turn forward');
      await page.reload();
      await expect(number).toHaveText(/^2\//);
      await samePaper(second, 'reload');
      await page.goBack();
      await expect(page.locator('.book-detail')).toBeVisible();
      await page.getByRole('link', {name: '立即阅读', exact: true}).click();
      await expect(page.locator('.chapter-loading-sheet')).toHaveCSS('background-position', '-137px -211px');
      await expect(page.locator('.chapter-loading-page')).toHaveCount(0);
      await expect(number).toHaveText(/^2\//);
      await samePaper(second, 'resume from details');
    } finally {await context.close();}
  });
}

test('saved typography stays selected and paragraph spacing scales with large text', async ({browser}) => {
  const context = await browser.newContext({viewport: {width: 390, height: 844}});
  const page = await context.newPage();
  try {
    await page.addInitScript(() => {
      localStorage.setItem('has-seen-reading-hint', 'true');
      localStorage.setItem('reader_fontSizeNum', '30');
      localStorage.setItem('reader_lineHeight', '1.8');
      localStorage.setItem('reader_fontFamily', '"serif"');
      localStorage.setItem('reader_paraSpacing', '6');
    });
    await page.goto(url);
    const body = page.locator('.reader-pages-root:visible .reader-page-window > .reader-page-surface .reader-columns');
    await expect(body).toHaveCSS('font-size', '30px');
    await expect(body).toHaveCSS('line-height', '54px');
    await expect(body).toHaveCSS('font-family', '"Songti SC", SimSun, serif');
    await expect(body.locator('p').first()).toHaveCSS('margin-bottom', '32.4px');
  } finally {await context.close();}
});

test('desktop defaults and night paper remain quiet', async ({browser}) => {
  const context = await browser.newContext({viewport: {width: 1440, height: 900}});
  const page = await context.newPage();
  try {
    await page.addInitScript(() => {
      localStorage.setItem('has-seen-reading-hint', 'true');
      localStorage.setItem('novelhub_theme', '"dark"');
    });
    await page.goto(url);
    const root = page.locator('.reader-pages-root:visible');
    await expect(root).toHaveAttribute('data-dark', 'true');
    await expect(root.locator('.reader-columns')).toHaveCSS('line-height', '35.2px');
    await expect(root.locator('.reader-frame')).toHaveCSS('background-image', 'none');
    await page.setViewportSize({width: 390, height: 844});
    await expect(root.locator('.reader-frame')).toHaveCSS('background-image', 'none');
  } finally {await context.close();}
});
