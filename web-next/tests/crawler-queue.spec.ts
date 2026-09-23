import '../../tools/test-env.cjs';
import {test, expect} from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fork, type ForkOptions} from 'node:child_process';

test('manual collection accepts queued books and saved drafts while busy, with editing, pause and author confirmation', async ({page}) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crawler-queue-browser-'));
  const options: ForkOptions & {windowsHide: boolean} = {windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc']};
  const server = fork(path.resolve('tools/novel-crawler/tests/queue-fixture-server.mjs'), [], options);
  const ready = new Promise<string>((resolve, reject) => { server.once('message', (message: {url: string}) => resolve(message.url)); server.once('error', reject); });
  server.send({type: 'start', stateDir, outputDir: path.join(stateDir, 'out')});
  const screenshots = path.resolve('.runtime/task-artifacts/manual-queue'); fs.mkdirSync(screenshots, {recursive: true});
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const row = (title: string) => page.locator('#queue-list .queue-row').filter({has: page.locator('strong', {hasText: new RegExp(`^${title}$`)})});
  const add = async (title: string) => { await page.locator('#title').fill(title); await page.locator('#enqueue').click(); await expect(row(title)).toBeVisible(); };
  try {
    fs.writeFileSync(path.join(stateDir, 'hold-当前书'), '');
    await page.goto(await ready);
    // Start through the original manual search flow, then add to the queue while it runs.
    await page.locator('#title').fill('当前书'); await page.locator('#search').click();
    await expect(page.locator('#results')).toContainText('当前书'); await page.locator('#start').click();
    await expect(page.locator('#phase')).toHaveText('正在下载');
    await expect(page.locator('#search')).toBeDisabled();
    for (const id of ['title', 'author', 'website', 'enqueue', 'probe-only']) await expect(page.locator('#' + id)).toBeEnabled();
    await add('第二本'); await add('第三本'); await add('移除书');
    await page.getByRole('button', {name: '移除《移除书》', exact: true}).click(); await expect(row('移除书')).toHaveCount(0);
    await page.getByRole('button', {name: '上移《第三本》', exact: true}).click();
    await expect(page.locator('#queue-list .queue-row strong')).toHaveText(['第三本', '第二本']);
    await page.getByRole('button', {name: '编辑《第二本》', exact: true}).click();
    await page.locator('#queue-edit-book').fill('修改后的第二本'); await page.getByRole('button', {name: '保存修改', exact: true}).click();
    await expect(row('修改后的第二本')).toBeVisible();
    await page.locator('#title').fill('尚未加入的草稿'); await page.locator('#author').fill('草稿作者');
    await expect(page.locator('#draft-status')).toHaveText('输入已保存');
    await page.reload(); await expect(page.locator('#title')).toHaveValue('尚未加入的草稿'); await expect(page.locator('#author')).toHaveValue('草稿作者');
    await expect(page.locator('#task-title')).toContainText('当前书');
    for (const width of [1180, 390, 320]) {
      await page.setViewportSize({width, height: 920});
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), `overflow at ${width}`).toBe(false);
      await page.screenshot({path: path.join(screenshots, `final-running-${width}.png`), fullPage: true});
    }
    await page.locator('#queue-toggle').click(); await expect(page.locator('#queue-toggle')).toHaveText('继续队列');
    // Finishing a book must not overwrite or steal focus from the next draft.
    await page.locator('#title').focus(); fs.unlinkSync(path.join(stateDir, 'hold-当前书'));
    await expect(page.locator('#phase')).toHaveText('已完成'); await expect(page.locator('#title')).toBeFocused();
    await expect(page.locator('#title')).toHaveValue('尚未加入的草稿');
    expect(fs.readFileSync(path.join(stateDir, 'events.jsonl'), 'utf8').match(/"event":"start"/g)).toHaveLength(1);
    await page.locator('#queue-toggle').click(); await expect(page.locator('#queue-count')).toHaveText('0');
    await expect(page.locator('#queue-history-summary')).toHaveText('已完成 2 本');
    await page.locator('#author').fill(''); await add('同名书');
    await expect(row('同名书').locator('.queue-state')).toHaveText('待确认');
    await expect(page.locator('#queue-toggle')).toBeDisabled();
    await expect(page.locator('#interruption-dialog')).not.toBeVisible();
    await page.setViewportSize({width: 1180, height: 920});
    await page.screenshot({path: path.join(screenshots, 'final-author-choice.png'), fullPage: true});
    await page.getByRole('button', {name: '同名书 · 乙作者 — 选择并继续', exact: true}).click();
    await expect(page.locator('#queue-count')).toHaveText('0');
    await page.locator('#queue-history-summary').click();
    await expect(page.locator('#queue-history-list')).toContainText('乙作者');
    expect(errors).toEqual([]);
  } finally {
    const closed = new Promise(resolve => server.once('exit', resolve)); server.send({type: 'stop'}); await closed;
    expect(path.dirname(stateDir)).toBe(os.tmpdir()); fs.rmSync(stateDir, {recursive: true, force: true});
  }
});
