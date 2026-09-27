import {test, expect} from './fixtures/without-analytics';

const base = process.env.READER_TABLET_BASE || 'http://127.0.0.1:3000';
const book = process.env.READER_TABLET_BOOK || '000000000000000000000101';
const chapter = process.env.READER_TABLET_CHAPTER || '000000000000000000000102';

for (const [width, height, touch, clippedScrollWidth] of [
  [768, 1024, true], [820, 1180, true], [1024, 1366, true],
  [1194, 834, true], [1366, 1024, true], [390, 844, true], [1440, 900, false],
  [820, 1180, true, true],
] as const) {
  test.describe(`${touch ? 'touch' : 'mouse'} ${width}x${height}${clippedScrollWidth ? ' clipped column measurement' : ''}`, () => {
    test.use({viewport:{width, height}, hasTouch:touch, isMobile:touch});
    test('side taps turn one page, and cross chapters only at the boundary', async ({page}, info) => {
      await page.addInitScript(clipped => {
        localStorage.setItem('has-seen-reading-hint', 'true');
        localStorage.setItem('reader_turnMode', JSON.stringify('horizontal'));
        if (clipped) {
          const native = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollWidth')!.get!;
          Object.defineProperty(Element.prototype, 'scrollWidth', {configurable:true, get() {
            return this.classList.contains('reader-columns') ? this.clientWidth : native.call(this);
          }});
        }
      }, Boolean(clippedScrollWidth));
      await page.route('**/api/books/*/views', route => route.fulfill({json:{success:true,counted:false}}));
      await page.goto(`${base}/book/${book}/${chapter}`);
      const reader = page.locator('.reader-pages-root:visible');
      const window = reader.locator('.reader-page-window');
      const number = window.locator('> .reader-page-surface [data-reader-page]');
      await expect(reader).toHaveAttribute('data-reader-ready', 'true');
      await expect(page.locator('.chapter-loading-page')).toHaveCount(0);
      await expect(number).toHaveText(/^1\/(?:[2-9]|\d{2,})$/);
      const total = Number((await number.innerText()).split('/')[1]);
      const tap = async (side: 'left' | 'right' | 'center') => {
        const rect = (await window.boundingBox())!;
        const position = {x:rect.width * (side === 'left' ? .12 : side === 'right' ? .88 : .5), y:rect.height * .55};
        if (touch) await page.touchscreen.tap(rect.x + position.x, rect.y + position.y);
        else await page.mouse.click(rect.x + position.x, rect.y + position.y);
      };
      for (const [side, target] of [['right', 2], ['right', 3], ['left', 2], ['left', 1]] as const) {
        await tap(side);
        await expect(number).toHaveText(`${target}/${total}`);
        await expect(reader).toHaveAttribute('data-reader-chapter', chapter);
        await expect(page).toHaveURL(`${base}/book/${book}/${chapter}`);
      }
      await tap('center');
      await expect(page.locator('.reader-tools')).toHaveAttribute('aria-hidden', 'false');
      await tap('center');
      await expect(page.locator('.reader-tools')).toHaveAttribute('aria-hidden', 'true');
      const previous = await reader.getAttribute('data-reader-previous');
      const next = await reader.getAttribute('data-reader-next');
      expect(previous).toBeTruthy(); expect(next).toBeTruthy();
      await tap('left');
      await expect(reader).toHaveAttribute('data-reader-chapter', previous!);
      await expect.poll(async () => {
        const [current, last] = (await number.innerText()).split('/').map(Number);
        return current === last && last > 1;
      }).toBe(true);
      await tap('right');
      await expect(reader).toHaveAttribute('data-reader-chapter', chapter);
      await expect(number).toHaveText(`1/${total}`);
      for (let target = 2; target <= total; target++) {
        await tap('right');
        await expect(number).toHaveText(`${target}/${total}`);
        await expect(reader).toHaveAttribute('data-reader-chapter', chapter);
      }
      await page.screenshot({path:info.outputPath('verified-last-page.png')});
      await tap('right');
      await expect(reader).toHaveAttribute('data-reader-chapter', next!);
      await expect(number).toHaveText(/^1\//);
    });
  });
}
