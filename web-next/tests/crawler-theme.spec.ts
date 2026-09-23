import '../../tools/test-env.cjs';
import {test, expect, type Page} from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fork, type ForkOptions} from 'node:child_process';

async function checkContrast(page: Page, selectors: string[]) {
  for (const selector of selectors) {
    const ratios = await page.locator(selector).evaluateAll(elements => elements.filter(element => element.getClientRects().length).map(element => {
      const luminance = (value: string) => {
        const rgb = value.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
        return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
      };
      let ancestor: Element | null = element, background = '';
      while (ancestor) {
        background = getComputedStyle(ancestor).backgroundColor;
        if (background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent') break;
        ancestor = ancestor.parentElement;
      }
      const text = luminance(getComputedStyle(element).color), surface = luminance(background);
      return (Math.max(text, surface) + .05) / (Math.min(text, surface) + .05);
    }));
    for (const ratio of ratios) expect(ratio, selector).toBeGreaterThanOrEqual(4.5);
  }
}

test('desktop night mode stays readable during collection and survives refresh, source changes and a new server port', async ({page}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crawler-theme-'));
  const options: ForkOptions & {windowsHide: boolean} = {windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc']};
  async function start() {
    const process = fork(path.resolve('tools/novel-crawler/tests/queue-fixture-server.mjs'), [], options);
    const ready = new Promise<string>((resolve, reject) => { process.once('message', (message: {url: string}) => resolve(message.url)); process.once('error', reject); });
    process.send({type: 'start', stateDir: dir, outputDir: path.join(dir, 'out')});
    return {process, url: await ready};
  }
  let app = await start();
  async function close() { const closed = new Promise(resolve => app.process.once('exit', resolve)); app.process.send({type: 'stop'}); await closed; }
  const screenshots = path.resolve('.runtime/task-artifacts/crawler-dark-mode'); fs.mkdirSync(screenshots, {recursive: true});
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const theme = page.locator('#theme-toggle');
  const savedTheme = () => JSON.parse(fs.readFileSync(path.join(dir, 'desktop-settings.json'), 'utf8')).theme;
  try {
    await page.goto(app.url);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await theme.click(); await expect(theme).toHaveAccessibleName('切换到日间模式'); await expect(theme).toBeEnabled();
    expect(savedTheme()).toBe('dark');
    // Source history writes must preserve the separate appearance preference.
    fs.writeFileSync(path.join(dir, 'hold-当前书'), '');
    await page.locator('#title').fill('当前书'); await page.locator('#search').click();
    await expect(page.locator('#results')).toContainText('当前书'); await page.locator('#start').click();
    await expect(page.locator('#phase')).toHaveText('正在下载');
    await page.locator('#title').fill('下一本'); await page.locator('#enqueue').click();
    await expect(page.locator('#queue-count')).toHaveText('1');
    expect(savedTheme()).toBe('dark');
    await checkContrast(page, ['h1', 'h2', 'label[for=title]', '.book-result strong', '.book-result small', '#task-message', '#phase', '.queue-state', '.queue-source', '#queue-summary', '#enqueue', '#theme-toggle', '#stop', '#feedback', '.queue-row-actions button:not(:disabled)']);
    for (const width of [1180, 800, 768, 600, 390, 320]) {
      await page.setViewportSize({width, height: 920});
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), `overflow at ${width}`).toBe(false);
      const toggle = await theme.boundingBox(); expect(toggle!.x + toggle!.width).toBeLessThanOrEqual(width);
      if ([1180, 390].includes(width)) await page.screenshot({path: path.join(screenshots, `final-dark-${width}.png`), fullPage: true});
    }
    await page.getByRole('button', {name: '编辑《下一本》', exact: true}).click();
    await expect(page.locator('#queue-edit-dialog')).toBeVisible();
    await checkContrast(page, ['#queue-edit-title', '#queue-edit-form label', '#queue-edit-book', '#queue-edit-form .primary']);
    await page.screenshot({path: path.join(screenshots, 'final-dark-dialog-320.png'), fullPage: true});
    await page.locator('#queue-edit-cancel').click();
    await page.reload(); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    // An unsaved choice is rolled back and reported, not claimed as persistent.
    await page.route('**/api/theme', route => route.fulfill({status: 400, contentType: 'application/json', body: JSON.stringify({error: '合成保存故障'})}));
    await theme.click(); await expect(page.locator('#feedback')).toContainText('外观设置未保存');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.unroute('**/api/theme');
    await theme.click(); await expect(theme).toHaveAccessibleName('切换到夜间模式'); await expect(theme).toBeEnabled();
    expect(savedTheme()).toBe('light');
    await page.setViewportSize({width: 1180, height: 920});
    await page.screenshot({path: path.join(screenshots, 'final-light-1180.png'), fullPage: true});
    await theme.click(); await expect(theme).toBeEnabled(); expect(savedTheme()).toBe('dark');
    await close(); app = await start();
    const html = await (await page.request.get(new URL(app.url).origin)).text();
    expect(html).toContain('data-theme="dark"');
    await page.goto(app.url); await expect(theme).toHaveAccessibleName('切换到日间模式');
    await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
    expect(errors).toEqual([]);
  } finally {
    if (app.process.exitCode === null) await close();
    expect(path.dirname(dir)).toBe(os.tmpdir()); fs.rmSync(dir, {recursive: true, force: true});
  }
});
