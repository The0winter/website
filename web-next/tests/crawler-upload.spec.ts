import '../../tools/test-env.cjs';
import {test, expect} from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fork, type ForkOptions} from 'node:child_process';

test('desktop upload button syncs the library, survives refresh, retries safely and fits narrow windows', async ({page}) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crawler-upload-browser-')), outputDir = path.join(stateDir, 'downloads');
  fs.mkdirSync(outputDir);
  const book = {title: '合成测试故事', author: '合成作者', sourceUrl: 'https://example.test/book/one', chapters: [{chapter_number: 1, title: '第1章 春日', content: '山路转过一片树林，河水向东流去。'.repeat(30)}]};
  fs.writeFileSync(path.join(outputDir, 'book.json'), JSON.stringify(book));
  const forkOptions: ForkOptions & {windowsHide: boolean} = {windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc']};
  const server = fork(path.resolve('tools/novel-crawler/tests/upload-fixture-server.mjs'), [], forkOptions);
  const ready = new Promise<string>((resolve, reject) => { server.once('message', (message: {url: string}) => resolve(message.url)); server.once('error', reject); });
  server.send({type: 'start', stateDir, outputDir});
  const screenshotDir = path.resolve('.runtime/test-tmp/upload-library-visual'); fs.mkdirSync(screenshotDir, {recursive: true});
  try {
    await page.goto(await ready);
    await expect(page.locator('#upload-library')).toBeEnabled();
    const colors = await page.locator('.library-actions button').evaluateAll(buttons => buttons.map(button => getComputedStyle(button).backgroundColor));
    expect(colors[0]).not.toEqual(colors[1]);
    for (const width of [1180, 768, 600, 420, 390, 320]) {
      await page.setViewportSize({width, height: 920});
      await expect(page.locator('#upload-library-label')).toHaveText('上传书库');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      expect(overflow, `horizontal overflow at ${width}`).toBe(false);
      const left = await page.locator('#update-library').boundingBox(), right = await page.locator('#upload-library').boundingBox();
      expect(right!.x).toBeGreaterThanOrEqual(left!.x + left!.width);
      if ([1180, 390].includes(width)) await page.screenshot({path: path.join(screenshotDir, `idle-${width}.png`), fullPage: true});
    }
    fs.writeFileSync(path.join(stateDir, 'hold-upload'), '');
    await page.locator('#upload-library').click();
    await expect(page.locator('#upload-library-label')).toHaveText('正在上传');
    await expect(page.locator('#update-library')).toBeDisabled();
    await expect(page.locator('#search')).toBeDisabled();
    await page.reload();
    await expect(page.locator('#upload-library-label')).toHaveText('正在上传');
    await page.locator('#stop').click();
    await expect(page.locator('#phase')).toHaveText('已停止');
    fs.unlinkSync(path.join(stateDir, 'hold-upload'));
    await expect(page.locator('#upload-library')).toBeEnabled();
    await page.locator('#upload-library').click();
    await expect(page.locator('#phase')).toHaveText('已完成');
    await expect(page.locator('#library-summary')).toContainText('新书 1 本');
    await expect(page.locator('#library-summary')).toContainText('新增 1 章');
    await page.reload();
    await expect(page.locator('#library-results')).toContainText('新书已上传');
    await page.locator('#upload-library').click();
    await expect(page.locator('#phase')).toHaveText('已完成');
    await expect(page.locator('#library-summary')).toContainText('已同步 1 本');
    await expect(page.locator('#library-summary')).toContainText('新增 0 章');
    await page.screenshot({path: path.join(screenshotDir, 'complete-320.png'), fullPage: true});
  } finally {
    const closed = new Promise(resolve => server.once('exit', resolve)); server.send({type: 'stop'}); await closed;
    expect(path.dirname(stateDir)).toBe(os.tmpdir()); fs.rmSync(stateDir, {recursive: true, force: true});
  }
});
