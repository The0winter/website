import {test, expect, type Page} from '@playwright/test';

const base = 'http://127.0.0.1:3000', book = '000000000000000000000101';
const last = '00000000000000000000010c';
const detail = `${base}/book/${book}`, reader = `${detail}/${book}`;
const root = (page: Page) => page.locator('.reader-pages-root:visible');
const settings = (page: Page) => page.getByRole('dialog', {name: '阅读设置'});
const tools = (page: Page) => page.locator('.reader-tools');

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem('has-seen-reading-hint', 'true');
    window.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style'); style.textContent = 'nextjs-portal{display:none!important}'; document.head.append(style);
    });
  });
  await page.route('**/api/books/*/views', route => route.fulfill({json: {success: true, counted: false}}));
});

async function expectTools(page: Page, visible: boolean) {
  await expect(tools(page)).toHaveAttribute('aria-hidden', String(!visible));
  await expect(root(page).locator('.reader-status-top')).toHaveAttribute('data-open', String(visible));
}

for (const width of [390, 1440]) {
  for (const catalog of width < 768 ? ['all'] : ['preview', 'all']) {
    test(`warm ${catalog} catalog opens the reader directly without a loading flash at ${width}px`, async ({page}) => {
      await page.setViewportSize({width, height: 844});
      // Warm the route once, then exercise the same catalog link from details.
      await page.goto(detail);
      const select = async () => {
        if (catalog === 'all') await page.getByRole('button', {name: width < 768 ? /^目录 / : /^查看完整目录/}).click();
        const scope = catalog === 'all' ? page.getByRole('dialog', {name: '全部目录'}) : page.getByRole('region', {name: '章节目录'});
        await scope.locator(`a[href="/book/${book}/${last}"]:visible`).click();
      };
      await select();
      await expect(root(page)).toHaveAttribute('data-reader-chapter', last);
      await expect(page.locator('.chapter-loading-page')).toHaveCount(0);
      await page.goBack();
      await expect(page).toHaveURL(detail);
      await expect(page.locator('html')).not.toHaveAttribute('data-book-transition', /.+/);
      await page.evaluate(() => {
        const frames: string[] = []; Object.assign(window, {entryFrames: frames, stopEntryFrames: false});
        const sample = () => {
          const loader = document.querySelector('.chapter-loading-sheet');
          if (loader && getComputedStyle(loader).visibility !== 'hidden') frames.push('loading');
          if (document.querySelector('.book-transition-snapshot')) frames.push('snapshot');
          const detail = document.querySelector('.book-detail');
          if (!detail?.getBoundingClientRect().width && !document.querySelector('[data-reader-ready="true"],.chapter-entry-snapshot')) frames.push('unready');
          if ((window as unknown as {stopEntryFrames: boolean}).stopEntryFrames) return;
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      const routeRequests: string[] = [];
      page.on('request', request => {if (request.url().includes('_rsc=')) routeRequests.push(new URL(request.url()).pathname);});
      await select();
      await expect(root(page)).toHaveAttribute('data-reader-chapter', last);
      await expect(root(page)).toHaveAttribute('data-reader-ready', 'true');
      await expect(page.locator('.chapter-loading-page')).toHaveCount(0);
      await expect(page.locator('.chapter-entry-snapshot')).toHaveCount(0);
      const frames = await page.evaluate(() => {Object.assign(window, {stopEntryFrames: true}); return (window as unknown as {entryFrames: string[]}).entryFrames;});
      expect(frames).toEqual([]);
      expect(routeRequests.every(path => path === `/book/${book}/${last}`)).toBe(true);
      await page.goBack(); await expect(page).toHaveURL(detail);
      await expect(page.locator('.book-detail:visible')).toBeVisible();
    });
  }
  for (const mode of ['horizontal', 'vertical', 'scroll']) {
    test(`settings preserve both bars until reading resumes in ${mode} at ${width}px`, async ({page}) => {
      await page.setViewportSize({width, height: 844});
      await page.addInitScript(mode => localStorage.setItem('reader_turnMode', JSON.stringify(mode)), mode);
      await page.goto(reader); await expect(root(page)).toHaveAttribute('data-reader-ready', 'true');
      await page.keyboard.press('m'); await expectTools(page, true);
      const openSettings = async () => {
        await tools(page).getByRole('button', {name: '设置', exact: true}).click();
        await expect(settings(page)).toBeVisible(); await expectTools(page, true);
      };
      await openSettings();
      await page.screenshot({path: `../artifacts/reader-interactions-settings-${width}-${mode}.png`});
      await expect(settings(page).locator('.reader-mode-setting p')).toHaveCount(0);
      await expect(settings(page)).not.toContainText('滑动或点击');
      await settings(page).getByRole('button', {name: '宋体', exact: true}).click();
      await settings(page).getByRole('button', {name: '上下滚屏', exact: true}).click();
      await expectTools(page, true);
      const label = mode === 'horizontal' ? '左右翻页' : mode === 'vertical' ? '上下翻页' : '上下滚屏';
      await settings(page).getByRole('button', {name: label, exact: true}).click();
      await settings(page).getByRole('button', {name: '关闭阅读设置'}).click();
      await expect(settings(page)).toHaveCount(0); await expectTools(page, true);
      await openSettings(); await page.goBack();
      await expect(settings(page)).toHaveCount(0); await expectTools(page, true);
      // A tap on the reading surface closes the bars.
      await page.locator('.reader-page-window').click({position: {x: Math.min(width, 1000) / 2, y: 250}});
      await expectTools(page, false);
      await page.keyboard.press('m'); await expectTools(page, true);
      if (mode === 'scroll') {
        const area = await page.locator('.reader-scroll-window').boundingBox();
        await page.mouse.move(area!.x + area!.width / 2, area!.y + 200); await page.mouse.wheel(0, 500);
      } else await page.keyboard.press(mode === 'vertical' ? 'ArrowDown' : 'ArrowRight');
      await expectTools(page, false);
      await page.keyboard.press('m'); await openSettings();
      // Dismissing settings by tapping the exposed reading area resumes reading too.
      await page.locator('[data-reader-settings-backdrop]').click({position: {x: width / 2, y: 65}});
      await expect(settings(page)).toHaveCount(0); await expectTools(page, false);
      await expect(page).toHaveURL(reader);
    });
  }
}
