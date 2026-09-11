import {test, expect} from '@playwright/test';

const base = 'http://127.0.0.1:3000', book = '000000000000000000000101';
const chapter = '000000000000000000000102';
test.use({viewport: {width: 390, height: 844}, hasTouch: true});
test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem('has-seen-reading-hint', 'true');
    localStorage.setItem('reader_themeColor', '"blue"');
    Object.defineProperty(navigator, 'connection', {value: {saveData: true, addEventListener() {}, removeEventListener() {}}});
  });
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
});

for (const [state, style] of [['displaced', 'transform:translateX(100vw)'], ['transparent', 'opacity:0']] as const) {
  test(`loading paper remains opaque while a measured reader is ${state}`, async ({page}) => {
    await page.goto(`${base}/book/${book}`);
    await page.getByRole('button', {name: /^目录 /}).click();
    const hold = await page.addStyleTag({content: `.reader-entry-content {${style}!important}`});
    await page.getByRole('dialog', {name: '全部目录'}).locator(`a[href="/book/${book}/${chapter}"]`).tap();
    const loading = page.locator('.chapter-loading-page');
    await expect(loading.getByRole('status')).toHaveText('第2章 山间来信正在加载');
    await expect(page.locator('.reader-pages-root')).toHaveAttribute('data-reader-ready', 'true');
    await page.waitForTimeout(250);
    await expect(loading).toBeVisible();
    await expect(loading.locator('.chapter-loading-sheet')).toHaveCSS('background-color', 'rgb(227, 237, 252)');
    await hold.evaluate(element => (element as HTMLElement).remove());
    await expect(loading).toHaveCount(0);
    await expect(page.locator('.reader-pages-root:visible')).toHaveAttribute('data-reader-chapter', chapter);
  });
}

test('the same loading paper covers layout changes caused by unlocking the reader', async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('reader_turnMode', '"scroll"'));
  await page.goto(`${base}/book/${book}`);
  await page.getByRole('button', {name: /^目录 /}).click();
  // Exercise the last commit: enabling the reader can still change its layout.
  const hold = await page.addStyleTag({content: '.reader-entry-content[data-entry-pending=false] {transform:translateX(28px)!important}'});
  await page.getByRole('dialog', {name: '全部目录'}).locator(`a[href="/book/${book}/${chapter}"]`).tap();
  const loading = page.locator('.chapter-loading-page');
  const original = await loading.elementHandle();
  await expect(page.locator('.reader-entry-content')).toHaveAttribute('data-entry-pending', 'false');
  await page.waitForTimeout(200);
  await expect(loading).toBeVisible();
  expect(await original!.evaluate(element => element.isConnected && element === document.querySelector('.chapter-loading-page'))).toBe(true);
  await page.screenshot({path: '../artifacts/loading-reveal-paper-390.png'});
  const frames = page.evaluate(() => new Promise<{paper: boolean; reader: boolean; x?: number}[]>(resolve => {
    const frames: {paper: boolean; reader: boolean; x?: number}[] = [];
    let remaining = 40;
    const sample = () => {
      const top = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
      frames.push({paper: Boolean(top?.closest('.chapter-loading-page')), reader: Boolean(top?.closest('.reader-pages-root')),
        x: document.querySelector('.reader-frame')?.getBoundingClientRect().x});
      if (--remaining) requestAnimationFrame(sample); else resolve(frames);
    }; requestAnimationFrame(sample);
  }));
  await hold.evaluate(element => (element as HTMLElement).remove());
  const recorded = await frames;
  expect(recorded.some(frame => frame.reader)).toBe(true);
  expect(recorded.every(frame => frame.paper || frame.reader && frame.x === 0)).toBe(true);
  await expect(loading).toHaveCount(0);
  await page.screenshot({path: '../artifacts/loading-reveal-ready-390.png'});
});
