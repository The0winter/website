import {test, expect, type Page} from '@playwright/test';

const base = process.env.READER_PAGES_BASE || 'http://127.0.0.1:3000';
const book = '000000000000000000000101';
const detail = `${base}/book/${book}`, readerUrl = `${detail}/${book}`;
const tools = (page: Page) => page.locator('.reader-tools');
const surface = (page: Page) => page.locator('.reader-pages-root:visible');
const active = (page: Page) => page.evaluate(() => Boolean(document.fullscreenElement));
const setting = (page: Page) => page.getByRole('group', {name: '全屏阅读'});

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem('has-seen-reading-hint', 'true');
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style'); style.textContent = 'nextjs-portal{display:none!important}'; document.head.append(style);
    });
  });
  await page.route('**/api/books/*/views', route => route.fulfill({json: {success: true, counted: false}}));
});
async function ready(page: Page) {
  await expect(surface(page)).toHaveAttribute('data-reader-ready', 'true');
  await expect(page.locator('.chapter-loading-page,.reader-fullscreen-cover')).toHaveCount(0);
}
async function openTools(page: Page) {
  if (await tools(page).getAttribute('aria-hidden') === 'true') await page.keyboard.press('m');
  await expect(tools(page)).toHaveAttribute('aria-hidden', 'false');
}
async function openSettings(page: Page) {
  if (await page.getByRole('dialog', {name: '阅读设置'}).isVisible()) return;
  await openTools(page);
  await tools(page).getByRole('button', {name: '设置', exact: true}).click();
  await expect(page.getByRole('dialog', {name: '阅读设置'})).toBeVisible();
}
async function choose(page: Page, enabled: boolean) {
  await setting(page).getByRole('button', {name: enabled ? '是' : '否', exact: true}).click();
  await expect.poll(() => active(page)).toBe(enabled);
  await expect(page.locator('.reader-fullscreen-cover')).toHaveCount(0);
  await expect(setting(page).getByRole('button', {name: enabled ? '是' : '否', exact: true})).toHaveAttribute('aria-pressed', 'true');
}

for (const mode of ['horizontal', 'vertical', 'scroll']) {
  test(`fullscreen preference survives ${mode} reading, menus, chapters and reload`, async ({page}) => {
    await page.setViewportSize({width: 390, height: 844});
    await page.addInitScript(mode => localStorage.setItem('reader_turnMode', JSON.stringify(mode)), mode);
    await page.goto(readerUrl); await ready(page);
    await expect(page.locator('.reader-return,.reader-status-top')).toHaveCount(0);
    await openSettings(page);
    await expect(setting(page).getByRole('button', {name: '是', exact: true})).toHaveAttribute('aria-pressed', 'true');
    await choose(page, true);
    await page.getByRole('button', {name: '关闭阅读设置'}).click();
    await page.keyboard.press('m');
    if (mode === 'scroll') {
      await surface(page).locator('.reader-text-window').evaluate(el => el.scrollTo({top: 700, behavior: 'instant'}));
      await expect.poll(() => surface(page).locator('.reader-text-window').evaluate(el => el.scrollTop)).toBe(700);
    } else {
      await page.keyboard.press(mode === 'horizontal' ? 'ArrowRight' : 'ArrowDown');
      await expect(surface(page).locator('.reader-progress span').first()).toHaveText(/^2\//);
    }
    await expect(page.locator('.reader-return')).toBeVisible();
    await openTools(page);
    await expect(tools(page).getByRole('button')).toHaveCount(3);
    await tools(page).getByRole('button', {name: '目录', exact: true}).click();
    const next = '000000000000000000000102';
    await page.getByRole('dialog', {name: '全部目录'}).locator(`a[href="/book/${book}/${next}"]`).click();
    await expect(surface(page)).toHaveAttribute('data-reader-chapter', next); await ready(page);
    expect(await active(page)).toBe(true);
    await openSettings(page); await choose(page, false);
    await page.getByRole('button', {name: '关闭阅读设置'}).click();
    await expect(page.getByRole('dialog', {name: '阅读设置'})).toHaveCount(0);
    await page.goBack(); await expect(page).toHaveURL(detail);
    await expect(page.locator('html')).not.toHaveAttribute('data-book-transition', /.+/);
    await page.locator('.read-now:visible').click(); await ready(page);
    expect(await active(page)).toBe(false);
    await page.reload(); await ready(page);
    await surface(page).locator('.reader-page-window').click({position: {x: 195, y: 420}});
    expect(await active(page)).toBe(false);
    await openSettings(page);
    await expect(setting(page).getByRole('button', {name: '否', exact: true})).toHaveAttribute('aria-pressed', 'true');
    await choose(page, true);
    await page.getByRole('button', {name: '关闭阅读设置'}).click();
    await page.evaluate(() => document.exitFullscreen());
    await surface(page).locator('.reader-page-window').click({position: {x: 195, y: 420}});
    expect(await active(page)).toBe(false);
  });
}

test('request rejection is recoverable and unsupported browsers explain the setting', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.goto(readerUrl); await ready(page); await openSettings(page);
  await page.evaluate(() => {
    const original = Element.prototype.requestFullscreen;
    Element.prototype.requestFullscreen = function() {Element.prototype.requestFullscreen = original; return Promise.reject(new TypeError('Denied'));};
  });
  await setting(page).getByRole('button', {name: '是', exact: true}).click();
  await expect(page.locator('.reader-navigation-error')).toContainText('未能切换全屏');
  await choose(page, true);
  await expect(page.locator('.reader-navigation-error')).toHaveCount(0);
  await page.reload(); await ready(page);
  await page.evaluate(() => {Object.defineProperty(document, 'fullscreenEnabled', {value: false, configurable: true}); document.dispatchEvent(new Event('fullscreenchange'));});
  await openSettings(page);
  await expect(setting(page)).toContainText('当前浏览器暂不支持全屏');
  await expect(setting(page).getByRole('button', {name: '是', exact: true})).toBeDisabled();
});

test('desktop retains its discoverable side control', async ({page}) => {
  await page.setViewportSize({width: 1440, height: 900});
  await page.goto(readerUrl); await ready(page);
  const sidebar = page.locator('aside');
  await sidebar.getByRole('button', {name: '全屏阅读'}).click();
  await expect.poll(() => active(page)).toBe(true);
  await sidebar.getByRole('button', {name: '退出全屏'}).click();
  await expect.poll(() => active(page)).toBe(false);
  await openTools(page);
  await expect(page.locator('.reader-return')).toBeVisible();
});

test('fullscreen reminder stays until explicitly dismissed and ignores the old automatic seen flag', async ({page}, info) => {
  await page.setViewportSize({width: 320, height: 844});
  await page.addInitScript(() => localStorage.setItem('reader_fullscreenHintSeen', 'true'));
  await page.goto(detail); await page.locator('.read-now:visible').click(); await ready(page);
  const hint = page.locator('.reader-fullscreen-hint');
  const dismiss = hint.getByRole('button', {name: '不再提醒', exact: true});
  await expect(dismiss).toBeInViewport({ratio: 1});
  expect(await dismiss.evaluate(el => {
    const box = el.getBoundingClientRect();
    return box.height >= 44 && el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  })).toBe(true);
  await page.waitForTimeout(5200);
  await expect(dismiss).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('reader_fullscreenHintDismissed'))).toBeNull();
  await page.screenshot({path: info.outputPath('verified-persistent-reminder-320.png')});
  await page.goBack(); await expect(page).toHaveURL(detail);
  await expect(page.locator('html')).not.toHaveAttribute('data-book-transition', /.+/);
  await page.locator('.read-now:visible').click(); await ready(page);
  await expect(dismiss).toBeVisible();
  await openSettings(page);
  await expect(hint).toHaveCount(0);
  await page.getByRole('button', {name: '关闭阅读设置'}).click();
  await expect(dismiss).toBeVisible();
  await dismiss.click();
  await expect(hint).toHaveCount(0);
  expect(await active(page)).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('reader_fullscreenHintDismissed'))).toBe('true');
  await page.reload(); await ready(page);
  await surface(page).locator('.reader-page-window').click({position: {x: 160, y: 400}});
  await expect.poll(() => active(page)).toBe(true);
  await expect(hint).toHaveCount(0);
});

test('failed chapters keep recovery controls accessible in fullscreen', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  const unavailable = '00000000000000000000010c';
  await page.route(`**/api/chapters/${unavailable}?navigation=1`, route => route.fulfill({status: 503, json: {message: '测试章节暂时不可用'}}));
  await page.goto(readerUrl); await ready(page); await openSettings(page); await choose(page, true);
  await page.getByRole('button', {name: '关闭阅读设置'}).click();
  await tools(page).getByRole('button', {name: '目录', exact: true}).click();
  await page.getByRole('dialog', {name: '全部目录'}).locator(`a[href="/book/${book}/${unavailable}"]`).click();
  const error = page.locator('.chapter-loading-page');
  await expect(error).toHaveAttribute('aria-busy', 'false');
  expect(await active(page)).toBe(true);
  const retry = error.getByRole('button', {name: '重试'});
  await expect(retry).toBeVisible();
  expect(await retry.evaluate(el => {
    const box = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  })).toBe(true);
});

for (const width of [320, 390]) {
  test(`text and all bottom controls stay in safe areas at ${width}px and on rotation`, async ({page}, info) => {
    await page.setViewportSize({width, height: 844});
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', {insets: {top: 48, bottom: 34, left: 0, right: 0}});
    await page.goto(detail); await page.locator('.read-now:visible').click(); await ready(page);
    for (const landscape of [false, true]) {
      if (landscape) {
        await page.setViewportSize({width: 844, height: width});
        await cdp.send('Emulation.setSafeAreaInsetsOverride', {insets: {top: 0, bottom: 24, left: 48, right: 16}});
      }
      await openTools(page);
      await expect(tools(page)).toBeInViewport({ratio: 1});
      await expect(page.locator('.reader-status-top[data-compact=true] .reader-return')).toBeVisible();
      await expect.poll(() => page.locator('.reader-text-window').evaluate(el => el.getBoundingClientRect().top)).toBe(landscape ? 24 : 72);
      const bounds = await tools(page).getByRole('button').evaluateAll(elements => elements.map(el => {
        const box = el.getBoundingClientRect();
        return {left: box.left, right: box.right, bottom: box.bottom, height: box.height,
          hit: el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))};
      }));
      expect(bounds).toHaveLength(3);
      for (const box of bounds) {
        expect(box.left).toBeGreaterThanOrEqual(landscape ? 48 : 16);
        expect(box.right).toBeLessThanOrEqual(landscape ? 828 : width - 16);
        expect(box.bottom).toBeLessThanOrEqual((landscape ? width : 844) - (landscape ? 24 : 34));
        expect(box.height).toBeGreaterThanOrEqual(44); expect(box.hit).toBe(true);
      }
      await page.screenshot({path: info.outputPath(`verified-${landscape ? 'landscape' : 'portrait'}-controls.png`)});
      await openSettings(page);
      await expect(page.getByRole('dialog', {name: '阅读设置'})).toBeInViewport({ratio: 1});
      await expect(setting(page)).toBeInViewport({ratio: 1});
      await page.screenshot({path: info.outputPath(`verified-${landscape ? 'landscape' : 'portrait'}-settings.png`)});
      await page.getByRole('button', {name: '关闭阅读设置'}).click();
    }
  });
}

test('fullscreen starts only after the loading paper has covered the outgoing page', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.addInitScript(() => {
    const original = Element.prototype.requestFullscreen;
    const requests: unknown[] = []; Object.assign(window, {fullscreenRequests: requests});
    let coveredFrames = 0;
    const sample = () => {
      const cover = document.querySelector('.chapter-loading-page');
      const box = cover?.getBoundingClientRect();
      if (box && Math.abs(box.left) < 1 && box.width >= innerWidth && !document.querySelector('.chapter-entry-snapshot')) coveredFrames++;
      else coveredFrames = 0;
      requestAnimationFrame(sample);
    }; requestAnimationFrame(sample);
    Element.prototype.requestFullscreen = function(options) {
      const cover = document.querySelector('.chapter-loading-page');
      requests.push({coveredFrames, opacity: cover ? getComputedStyle(cover).opacity : null, revealed: cover?.getAttribute('data-text-revealed')});
      return original.call(this, options);
    };
  });
  await page.goto(detail); await page.locator('.read-now:visible').click(); await ready(page);
  expect(await active(page)).toBe(true);
  const requests = await page.evaluate(() => (window as unknown as {fullscreenRequests: {coveredFrames: number; opacity: string; revealed: string}[]}).fullscreenRequests);
  expect(requests).toHaveLength(1);
  expect(requests[0].coveredFrames).toBeGreaterThanOrEqual(1);
  expect(requests[0].opacity).toBe('1'); expect(requests[0].revealed).toBe('false');
});

test('Back before the loading slide finishes cancels the deferred fullscreen request', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.goto(detail);
  await page.locator('.read-now:visible').click();
  await page.goBack();
  await expect(page).toHaveURL(detail);
  await expect(page.locator('.chapter-loading-page')).toHaveCount(0);
  await page.waitForTimeout(600);
  expect(await active(page)).toBe(false);
});
