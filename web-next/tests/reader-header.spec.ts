import {test, expect, type Page} from '@playwright/test';

const base = process.env.READER_PAGES_BASE || 'http://127.0.0.1:3000';
const book = '000000000000000000000101', next = '000000000000000000000102';
const detail = `${base}/book/${book}`;
const root = (page: Page) => page.locator('.reader-pages-root:visible');
const header = (page: Page) => root(page).locator('.reader-status-top[data-compact=true]');
const number = (page: Page) => root(page).locator('.reader-page-window > .reader-page-surface [data-reader-page]');
async function ready(page: Page) {
  await expect(root(page)).toHaveAttribute('data-reader-ready', 'true');
  await expect(page.locator('.chapter-loading-page,.reader-fullscreen-cover')).toHaveCount(0);
}
test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem('reader_fullscreen', 'true');
    localStorage.setItem('has-seen-reading-hint', 'true');
    localStorage.setItem('reader_fullscreenHintDismissed', 'true');
  });
  await page.route('**/api/books/*/views', route => route.fulfill({json: {success: true, counted: false}}));
});

for (const mode of ['horizontal', 'vertical', 'scroll']) {
  test(`fullscreen header follows first page, saved position and chapters in ${mode}`, async ({page}, info) => {
    await page.setViewportSize({width: 390, height: 844});
    await page.addInitScript(mode => localStorage.setItem('reader_turnMode', JSON.stringify(mode)), mode);
    await page.goto(detail); await page.locator('.read-now:visible').click(); await ready(page);
    const label = header(page).locator('.reader-return span');
    await expect(label).toHaveText('隔离测试：山海行记');
    const geometry = () => root(page).evaluate(el => {
      const text = el.querySelector('.reader-text-window')!, body = text.querySelector('.reader-columns')!;
      const box = text.getBoundingClientRect();
      return {x: box.x, y: box.y, width: box.width, height: box.height, scrollHeight: text.scrollHeight,
        columns: body.scrollWidth, page: el.querySelector('.reader-page-window > .reader-page-surface [data-reader-page]')!.textContent};
    });
    const before = await geometry();
    // Removing the added header recreates the previous text layout exactly.
    await header(page).evaluate(el => {el.style.display = 'none';});
    expect(await geometry()).toEqual(before);
    await header(page).evaluate(el => {el.style.display = '';});
    expect(await geometry()).toEqual(before);
    await page.screenshot({path: info.outputPath(`verified-${mode}-first.png`)});
    if (mode === 'scroll') {
      await root(page).locator('.reader-text-window').evaluate(el => el.scrollTo({top: el.clientHeight * 1.5, behavior: 'instant'}));
    } else await page.keyboard.press(mode === 'horizontal' ? 'ArrowRight' : 'ArrowDown');
    await expect(number(page)).toHaveText(/^2\//);
    await expect(label).toHaveText('第1章 山间来信');
    await page.screenshot({path: info.outputPath(`verified-${mode}-second.png`)});
    // Return and re-enter to exercise restoration and the real return link.
    await header(page).getByRole('link').click(); await expect(page).toHaveURL(detail);
    await expect(page.locator('html')).not.toHaveAttribute('data-book-transition', /.+/);
    await page.locator('.read-now:visible').click(); await ready(page);
    await expect(number(page)).toHaveText(/^2\//);
    await expect(label).toHaveText('第1章 山间来信');
    if (mode === 'scroll') {
      await root(page).locator('.reader-text-window').evaluate(el => {
        const chapter = el.querySelector('[data-scroll-chapter="000000000000000000000102"]')!;
        el.scrollTo({top: chapter.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop, behavior: 'instant'});
      });
    } else await page.keyboard.press('Control+ArrowRight');
    await expect(root(page)).toHaveAttribute('data-reader-chapter', next); await ready(page);
    await expect(number(page)).toHaveText(/^1\//);
    await expect(label).toHaveText('隔离测试：山海行记');
    if (mode === 'scroll') {
      await root(page).locator('.reader-text-window').evaluate(el => el.scrollBy({top: el.clientHeight + 5, behavior: 'instant'}));
    } else await page.keyboard.press(mode === 'horizontal' ? 'ArrowRight' : 'ArrowDown');
    await expect(label).toHaveText('第2章 山间来信');
  });
}

for (const safeArea of [0, 48]) {
  test(`header fits existing whitespace with ${safeArea}px top safe area`, async ({page}, info) => {
    await page.setViewportSize({width: 320, height: 844});
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', {insets: {top: safeArea, bottom: 34, left: 0, right: 0}});
    await page.goto(detail); await page.locator('.read-now:visible').click(); await ready(page);
    for (const landscape of [false, true]) {
      if (landscape) {
        await page.setViewportSize({width: 844, height: 320});
        await cdp.send('Emulation.setSafeAreaInsetsOverride', {insets: {top: 0, bottom: 24, left: 48, right: 16}});
      }
      await expect(header(page)).toBeVisible();
      await expect.poll(() => root(page).locator('.reader-text-window').evaluate(el => el.getBoundingClientRect().top)).toBe(landscape ? 24 : safeArea + 24);
      await header(page).locator('span').evaluate(el => {el.textContent = '用于验证很长的章节名称不会遮住正文也不会换行的标题'.repeat(8);});
      const bounds = await header(page).evaluate(el => {
        const box = el.getBoundingClientRect(), link = el.querySelector('a')!, hit = link.getBoundingClientRect();
        const label = el.querySelector('span')!, text = el.parentElement!.querySelector('.reader-text-window')!.getBoundingClientRect();
        return {top: box.top, bottom: box.bottom, left: box.left, right: box.right, textTop: text.top,
          labelTop: label.getBoundingClientRect().top, iconTop: el.querySelector('svg')!.getBoundingClientRect().top,
          linkHeight: hit.height, ellipsis: getComputedStyle(label).textOverflow, overflow: label.scrollWidth > label.clientWidth,
          clickable: link.contains(document.elementFromPoint(hit.x + 8, hit.y + hit.height / 2))};
      });
      expect(bounds.top).toBe(landscape ? 0 : safeArea);
      expect(bounds.bottom).toBeLessThanOrEqual(bounds.textTop);
      expect(bounds.left).toBeGreaterThanOrEqual(landscape ? 48 : 20);
      expect(bounds.right).toBeLessThanOrEqual(landscape ? 828 : 300);
      expect(bounds.linkHeight).toBe(24);
      expect(bounds.labelTop).toBeGreaterThanOrEqual(bounds.top);
      expect(bounds.labelTop).toBeLessThan(bounds.top + 2);
      expect(bounds.iconTop).toBeGreaterThanOrEqual(bounds.top);
      expect(bounds.ellipsis).toBe('ellipsis'); expect(bounds.overflow).toBe(true); expect(bounds.clickable).toBe(true);
      await page.screenshot({path: info.outputPath(`verified-safe-${safeArea}-${landscape ? 'landscape' : 'portrait'}.png`)});
    }
  });
}
