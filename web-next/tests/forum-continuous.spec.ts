import {test, expect} from './fixtures/without-analytics';
import type {Page} from '@playwright/test';

const base = process.env.QA_TEST_BASE || 'http://127.0.0.1:3000';
const publicRun = base.startsWith('https://');
test.use({colorScheme:'light', reducedMotion:'reduce'});
async function entry(page:Page) {
  for (let index = 1; index <= 5; index++) {
    const response = await page.request.get(base + `/api/forum/posts?view=answers&page=${index}`);
    expect(response.ok()).toBeTruthy();
    const rows = await response.json();
    const row = rows.find((row:{topReply?:{source?:unknown}}) => row.topReply?.source);
    if (row) return row;
    if (!rows.length) break;
  }
  throw new Error('The licensed answer fixture is missing');
}
async function login(page:Page) {
  const csrf = await (await page.request.get(base + '/api/auth/csrf')).json();
  const headers = {origin:base,'x-csrf-token':csrf.csrfToken};
  expect((await page.request.post(base + '/api/auth/signin', {headers, data:{email:'reader@example.test', password:'Local-test-12345'}})).ok()).toBeTruthy();
  const sessionCsrf = await (await page.request.get(base + '/api/auth/csrf')).json();
  return {origin:base,'x-csrf-token':sessionCsrf.csrfToken};
}
test.beforeEach(async ({page}) => {
  await page.route('**/api/forum/posts/*/views', route => route.fulfill({json:{counted:false}}));
  await page.addInitScript(() => {Object.defineProperty(navigator, 'share', {configurable:true, value:undefined});});
});

for (const width of [320,390,1440]) {
  test(`${width}px continuous answers preserve bodies, current actions and reading position`, async ({page}, info) => {
    await page.setViewportSize({width,height:844});
    const errors:string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const row = await entry(page);
    const answerUrl = `${base}/forum/${row.entryId}?fromQuestion=${row.id}`;
    await page.goto(answerUrl);
    await expect(page.locator('.qa-answer').first()).toBeVisible();
    await page.locator('.qa-actionbar .qa-current-author').click();
    await expect(page.locator('.qa-load-more:disabled')).toHaveCount(0);
    if(await page.locator('.qa-load-more').isVisible())await page.locator('.qa-load-more').click();
    await expect(page.locator('.qa-answer')).toHaveCount(5);
    await page.getByRole('dialog').getByRole('button',{name:'关闭弹窗'}).click();
    const ids = await page.locator('.qa-answer').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-answer-id')));
    expect(ids[0]).toBe(row.entryId);
    await expect(page.locator('.qa-question h1')).toHaveText(row.title);
    await expect(page.locator('.qa-answer > h2')).toHaveCount(0);
    await expect(page.locator('.qa-body').first()).toHaveCSS('font-size','18px');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.screenshot({path:info.outputPath(`verified-reader-${width}.png`)});
    await page.getByRole('button',{name:'跳到下一篇回答'}).click();
    const bar = page.getByRole('group',{name:'当前回答操作'});
    await expect(bar).toHaveAttribute('data-active-answer', ids[1]!);
    expect(await page.locator('.qa-answer').count()).toBe(5);
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {configurable:true, value:{writeText:() => Promise.reject(new Error('Unavailable in this test'))}}));
    await page.getByRole('button',{name:'分享当前回答',exact:true}).click();
    await expect(page.getByRole('textbox',{name:'当前回答链接'})).toHaveValue(`${base}/forum/${ids[1]}?fromQuestion=${row.id}`);
    await page.getByRole('dialog',{name:'分享回答'}).getByRole('button',{name:'关闭弹窗'}).click();
    const before = await page.evaluate(() => scrollY);
    await page.getByRole('button',{name:'打开当前回答评论'}).click();
    const dialog = page.getByRole('dialog',{name:'回答评论'});
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.qa-dialog-subtitle')).toContainText(await page.locator('.qa-answer').nth(1).locator('.qa-author strong').innerText());
    await dialog.getByRole('button',{name:'关闭弹窗'}).click();
    expect(Math.abs(await page.evaluate(() => scrollY) - before)).toBeLessThan(3);
    await page.getByRole('button',{name:'阅读设置',exact:true}).filter({visible:true}).first().click();
    await page.getByRole('dialog').getByRole('button',{name:'20',exact:true}).click();
    await expect(page.locator('.qa-body').first()).toHaveCSS('font-size','20px');
    await page.getByRole('dialog').getByRole('button',{name:'18',exact:true}).click();
    await page.getByRole('dialog').getByRole('button',{name:'深色',exact:true}).click();
    await expect(page.locator('.qa-main')).toHaveCSS('background-color','rgb(28, 32, 38)');
    await page.getByRole('dialog').getByRole('button',{name:'浅色',exact:true}).click();
    await page.getByRole('dialog').getByRole('button',{name:'关闭弹窗'}).click();
    // Scroll through the page itself; the next-answer button is only a shortcut.
    await page.locator('.qa-answer').nth(2).locator('.qa-author').scrollIntoViewIfNeeded();
    await page.evaluate(() => {const node = document.querySelectorAll('.qa-answer')[2]; scrollTo(0,scrollY + node.getBoundingClientRect().top - 74);});
    await expect(bar).toHaveAttribute('data-active-answer', ids[2]!);
    const resumed = await page.evaluate(() => scrollY);
    await page.screenshot({path:info.outputPath(`verified-continuation-${width}.png`)});
    await page.getByRole('link',{name:'返回问答首页'}).click();
    await expect(page.locator('.forum-entry').first()).toBeVisible();
    await page.locator(`.forum-feed-panel[aria-hidden=false] [data-entry-id="${row.entryId}"] .forum-entry-title`).click();
    await expect(bar).toHaveAttribute('data-active-answer', ids[2]!);
    await expect.poll(async () => Math.abs(await page.evaluate(() => scrollY) - resumed)).toBeLessThan(4);
    await page.locator('.qa-actionbar .qa-current-author').click();
    await expect(page.getByRole('dialog').locator('.qa-directory-item')).toHaveCount(5);
    await page.getByRole('dialog').locator('.qa-directory-item').last().click();
    await expect(bar).toHaveAttribute('data-active-answer', ids[4]!);
    await expect(page.getByText('已读完这个问题的全部回答',{exact:true})).toBeAttached();
    expect(errors).toEqual([]);
  });
}

test('pagination recovers from failure, keeps a deep-linked answer unique, and restores after reload', async ({page}) => {
  test.skip(publicRun, 'Synthetic writing is restricted to the isolated local database.');
  await page.setViewportSize({width:390,height:844});
  const headers = await login(page);
  const created = await page.request.post(base + '/api/forum/posts', {headers, data:{type:'question',title:'连续阅读分页验证 '+Date.now()+'？',content:'分页与阅读恢复的合成问题。'}});
  expect(created.ok()).toBeTruthy();
  const question = await created.json();
  const ids:string[] = [];
  for (let index = 0; index < 24; index++) {
    const response = await page.request.post(`${base}/api/forum/posts/${question.id}/replies`, {headers, data:{content:Array.from({length:20}, (_, paragraph) => `<p>第 ${index + 1} 位书友的回答，第 ${paragraph + 1} 段。阅读完毕后应当直接接下一篇完整回答，不重复标题。</p>`).join('')}});
    expect(response.ok()).toBeTruthy(); ids.push((await response.json()).id);
  }
  await page.goto(`${base}/forum/${ids[0]}?fromQuestion=${question.id}`);
  await expect(page.locator('.qa-answer')).toHaveCount(1);
  await page.locator('.qa-actionbar .qa-current-author').click();
  await page.locator('.qa-load-more').click();
  await expect(page.locator('.qa-answer')).toHaveCount(6);
  await page.getByRole('dialog').getByRole('button',{name:'关闭弹窗'}).click();
  await page.route(`**/api/forum/posts/${question.id}/replies?page=2&limit=5`, route => route.fulfill({status:503,json:{error:'临时不可用'}}), {times:1});
  await page.locator('.qa-stream-end').scrollIntoViewIfNeeded();
  await expect(page.locator('.qa-stream-end [role=alert]')).toBeVisible();
  await expect(page.locator('.qa-answer')).toHaveCount(6);
  await page.locator('.qa-stream-end').getByRole('button',{name:'重试'}).click();
  await expect(page.locator('.qa-answer')).toHaveCount(11);
  await page.locator('.qa-actionbar .qa-current-author').click();
  for(const count of [16,21,24]) {
    await page.locator('.qa-load-more').click();
    await expect(page.locator('.qa-answer')).toHaveCount(count);
  }
  await page.getByRole('dialog').getByRole('button',{name:'关闭弹窗'}).click();
  await expect(page.locator('.qa-answer')).toHaveCount(24);
  const rendered = await page.locator('.qa-answer').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-answer-id')));
  expect(new Set(rendered).size).toBe(24);
  expect(new Set(rendered)).toEqual(new Set(ids));
  await page.locator('.qa-answer').last().scrollIntoViewIfNeeded();
  await page.evaluate(() => {const nodes=document.querySelectorAll('.qa-answer');scrollTo(0,scrollY+nodes[nodes.length-1].getBoundingClientRect().top-70);});
  const active = await page.locator('.qa-answer').last().getAttribute('data-answer-id');
  await expect(page.locator('.qa-actionbar')).toHaveAttribute('data-active-answer',active!);
  const before = await page.evaluate(() => scrollY);
  await page.reload();
  await expect(page.locator('.qa-answer')).toHaveCount(24);
  await expect(page.locator('.qa-actionbar')).toHaveAttribute('data-active-answer',active!);
  expect(Math.abs(await page.evaluate(() => scrollY)-before)).toBeLessThan(4);
});

test('answer composer keeps its draft and has no title field', async ({page}) => {
  test.skip(publicRun, 'No production writes.');
  const row = await entry(page); await login(page);
  await page.goto(`${base}/forum/${row.entryId}?fromQuestion=${row.id}`);
  await page.locator('.qa-topbar').getByRole('button',{name:'写回答'}).click();
  const dialog = page.getByRole('dialog',{name:'写回答'});
  await expect(dialog.locator('input')).toHaveCount(0);
  await dialog.getByRole('textbox',{name:'回答内容'}).fill('这是一段待继续填写的回答。');
  await dialog.getByRole('button',{name:'关闭弹窗'}).click();
  await page.reload();
  await page.locator('.qa-topbar').getByRole('button',{name:'写回答'}).click();
  await expect(dialog.getByRole('textbox',{name:'回答内容'})).toHaveValue('这是一段待继续填写的回答。');
});
