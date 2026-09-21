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
  await expect(root(page).locator('.reader-status-top')).toHaveAttribute('data-open', String(visible || page.viewportSize()!.width < 1024));
}

for (const width of [390, 1440]) {
  for (const catalog of width < 768 ? ['all'] : ['preview', 'all']) {
    test(`warm ${catalog} catalog keeps the reader covered until ready at ${width}px`, async ({page}) => {
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
          if (!detail?.getBoundingClientRect().width && !document.querySelector('[data-reader-ready="true"],.chapter-entry-snapshot,.chapter-loading-page')) frames.push('unready');
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
      // A loading page is intentional, including for cached fullscreen entry.
      expect(frames.filter(frame => frame !== 'loading')).toEqual([]);
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
      const header = await settings(page).locator('.reader-settings-header').evaluate(element => {
        const label = element.querySelector('span')!.getBoundingClientRect(), close = element.querySelector('button')!.getBoundingClientRect();
        return {labelY: label.y + label.height / 2, closeY: close.y + close.height / 2};
      });
      expect(header.labelY).toBeCloseTo(header.closeY, 1);
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

for (const width of [320, 390]) test(`mobile spacing steppers repaginate and persist side by side at ${width}px`, async ({page}, info) => {
  await page.setViewportSize({width, height: 844});
  await page.goto(reader); await expect(root(page)).toHaveAttribute('data-reader-ready', 'true');
  const open = async () => {
    if (await settings(page).isVisible()) return;
    await page.getByRole('button', {name: '阅读菜单', exact: true}).focus();
    await page.keyboard.press('Enter');
    await expectTools(page, true);
    await tools(page).getByRole('button', {name: '设置', exact: true}).click();
  };
  await open();
  const line = settings(page).getByRole('status', {name: '当前行距'});
  const paragraph = settings(page).getByRole('status', {name: '当前段距'});
  const adjust = (name: string) => settings(page).getByRole('button', {name, exact: true});
  await expect(line).toHaveText('1.4');
  await expect(paragraph).toHaveText('标准');
  const lineBox = await line.boundingBox(), paragraphBox = await paragraph.boundingBox();
  expect(lineBox!.y).toBeCloseTo(paragraphBox!.y, 1);
  await expect(settings(page)).toBeInViewport({ratio: 1});
  expect((await settings(page).boundingBox())!.height).toBeLessThan(844 / 2);
  expect(await settings(page).evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await expect(settings(page)).not.toContainText('行高');
  const spacing = () => page.locator('.reader-columns').evaluate(element => Number.parseFloat(getComputedStyle(element).lineHeight) / Number.parseFloat(getComputedStyle(element).fontSize));
  await expect.poll(spacing).toBeCloseTo(1.4, 2);
  await adjust('减小行距').click(); await expect(line).toHaveText('1.3');
  await adjust('减小行距').click(); await expect(line).toHaveText('1.2');
  await expect(adjust('减小行距')).toBeDisabled();
  await expect.poll(spacing).toBeCloseTo(1.2, 2);
  for (let step=0; step<6; step++) await adjust('增大行距').click();
  await expect(line).toHaveText('1.8'); await expect(adjust('增大行距')).toBeDisabled();
  await expect.poll(spacing).toBeCloseTo(1.8, 2);
  await expect(root(page)).toHaveAttribute('data-reader-ready', 'true');
  const paragraphGap = () => page.locator('.reader-columns p').first().evaluate(element => parseFloat(getComputedStyle(element).marginBottom));
  const standardGap = await paragraphGap();
  await adjust('减小段距').click(); await expect(paragraph).toHaveText('紧凑');
  await expect(adjust('减小段距')).toBeDisabled();
  await expect.poll(paragraphGap).toBeLessThan(standardGap);
  for (const label of ['标准', '中等', '宽疏']) {
    await adjust('增大段距').click(); await expect(paragraph).toHaveText(label);
  }
  await expect(adjust('增大段距')).toBeDisabled();
  await expect.poll(paragraphGap).toBeGreaterThan(standardGap);
  await page.screenshot({path: info.outputPath('verified-line-spacing.png')});
  await settings(page).getByRole('button', {name: '关闭阅读设置'}).click();
  await expect(settings(page)).toHaveCount(0);
  await page.reload(); await expect(root(page)).toHaveAttribute('data-reader-ready', 'true');
  await open(); await expect(line).toHaveText('1.8'); await expect(paragraph).toHaveText('宽疏');
  // Older in-range preferences remain available even between the former presets.
  await page.evaluate(() => localStorage.setItem('reader_lineHeight', '1.5'));
  await settings(page).getByRole('button', {name: '关闭阅读设置'}).click();
  await expect(settings(page)).toHaveCount(0);
  await page.reload(); await expect(root(page)).toHaveAttribute('data-reader-ready', 'true');
  await open(); await expect(line).toHaveText('1.5');
  await page.evaluate(() => localStorage.setItem('reader_lineHeight', '2.4'));
  await settings(page).getByRole('button', {name: '关闭阅读设置'}).click();
  await expect(settings(page)).toHaveCount(0);
  await page.reload(); await expect(root(page)).toHaveAttribute('data-reader-ready', 'true');
  await open(); await expect(line).toHaveText('1.4');
});
