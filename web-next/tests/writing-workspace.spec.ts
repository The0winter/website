import {test, expect, type Page} from '@playwright/test';

// Safe for candidate/public UI verification: every account API is synthetic.
const base = process.env.CREATION_BASE_URL || 'http://127.0.0.1:3107';
const reference = 'm_writing-workspace-test';
async function setup(page: Page) {
  const state = {account: '000000000000000000000099', mutations: 0, fail: false, published: [] as string[]};
  await page.route('**/api/auth/session', route => route.fulfill({json: {user: {id: state.account, username: '清风', role: 'reader'}, profile: {id: state.account, username: '清风', role: 'reader'}}}));
  await page.route('**/api/auth/csrf', route => route.fulfill({json: {csrfToken: 'test'}}));
  await page.route('**/api/writer/works?**', route => route.fulfill({json: [{id: 'test-work', title: '山海来信', manuscriptKey: 'writing-workspace-test', visibility: 'private'}]}));
  await page.route('**/api/writer/workspace/**', async route => {
    if (route.request().method() !== 'GET') {
      state.mutations++; const body = route.request().postDataJSON();
      if (state.fail) return route.fulfill({status: 503, json: {error: '网络暂不可用，本地草稿仍保留'}});
      state.published.push(body.id); return route.fulfill({json: {bookId: '000000000000000000000088', chapterId: 'published'}});
    }
    return route.fulfill({json: {
      work: {reference, title: '山海来信', bookId: '000000000000000000000088', visibility: 'private'},
      cloudDrafts: [{id: 'manuscript-7', title: '海上的信', content: '曾经保存的旧草稿。', number: 8, updatedAt: '2026-09-14T08:00:00.000Z'}],
      published: [{id: '000000000000000000000011', title: '风起', number: 6, words: 1200, updatedAt: '2026-09-14T08:00:00.000Z'}],
      total: 1, maxNumber: 8, publishedDraftIds: state.published,
    }});
  });
  await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style'); style.textContent = 'nextjs-portal{display:none!important}'; document.head.append(style);
  }));
  return state;
}
async function localRows(page: Page) {
  return page.evaluate(() => new Promise<{title: string; content: string; number: number; revision: number}[]>((resolve, reject) => {
    const request = indexedDB.open('jiutian-writing');
    request.onsuccess = () => {const query = request.result.transaction('drafts').objectStore('drafts').getAll(); query.onsuccess = () => {resolve(query.result); request.result.close();}; query.onerror = reject;};
    request.onerror = reject;
  }));
}
for (const width of [320, 390, 1440]) test(`draft library and local editor at ${width}`, async ({page}, info) => {
  const state = await setup(page);
  await page.setViewportSize({width, height: 844});
  await page.emulateMedia({colorScheme: width === 390 ? 'dark' : 'light'});
  if (width < 768) {
    await page.goto(base); await page.getByRole('button', {name: '创作', exact: true}).click();
    await page.locator('.mw-book').getByRole('link', {name: '创作', exact: true}).click();
    await expect(page.locator('.mw-view')).toHaveAttribute('data-direction', 'left');
  } else {await page.goto(base + '/writer'); await page.locator('.writer-work').getByRole('button', {name: '创作', exact: true}).click();}
  await expect(page.getByRole('tab', {name: /草稿箱/})).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.writing-chapters')).toContainText('海上的信');
  await page.screenshot({path: info.outputPath('draft-library.png')});
  await page.getByRole('button', {name: '新建章节', exact: true}).click();
  const editor = page.getByRole('dialog', {name: '创建新章节', exact: true});
  await expect(editor.locator('h2')).toHaveText('第 9 章');
  await expect(editor.locator('input,textarea')).toHaveCount(2);
  await expect(page.getByLabel('书名', {exact: true})).toHaveCount(0);
  await page.getByLabel('章节名', {exact: true}).fill('潮声');
  await page.getByLabel('正文', {exact: true}).fill('海风穿过长街，带来远方的消息。\n\n她终于拆开了那封信。');
  await expect(page.locator('.writing-save-state')).toContainText('已保存到本机');
  expect(state.mutations).toBe(0);
  const first = (await localRows(page)).find(row => row.title === '潮声')!;
  await page.waitForTimeout(2400);
  expect((await localRows(page)).find(row => row.title === '潮声')!.revision).toBe(first.revision);
  const titleBox = await page.getByLabel('章节名', {exact: true}).boundingBox();
  const bodyBox = await page.getByLabel('正文', {exact: true}).boundingBox();
  expect(titleBox!.y + titleBox!.height).toBeLessThan(bodyBox!.y);
  expect(bodyBox!.height).toBeGreaterThan(300);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path: info.outputPath('chapter-editor.png')});
  await page.getByLabel('正文', {exact: true}).fill(first.content + '\n手动保存的结尾。');
  await page.getByRole('button', {name: '保存', exact: true}).click();
  await expect(page.locator('.writing-save-state')).toContainText('已保存到本机');
  await page.getByLabel('正文', {exact: true}).fill(first.content + '\n返回前最后输入的一句。');
  await page.goBack();
  await expect(editor).toHaveCount(0);
  await page.goForward();
  await expect(page.getByLabel('正文', {exact: true})).toHaveValue(first.content + '\n返回前最后输入的一句。');
  await page.goBack();
  await expect(editor).toHaveCount(0);
  await page.getByRole('button', {name: /09.*潮声/}).click();
  await expect(page.getByLabel('正文', {exact: true})).toHaveValue(first.content + '\n返回前最后输入的一句。');
  await page.getByRole('button', {name: '返回草稿箱'}).click();
  await expect(editor).toHaveCount(0);
  await page.getByRole('button', {name: '新建章节', exact: true}).click();
  await expect(editor.locator('h2')).toHaveText('第 10 章');
  await page.getByRole('button', {name: '返回草稿箱'}).click();
  await expect(editor).toHaveCount(0);
  await page.goto(base + '/writer?action=chapters&work=' + reference);
  await expect(page.locator('.writing-chapters')).toContainText('潮声');
  await expect(page.getByRole('tab', {name: /草稿箱/})).toContainText('3');
});

test('local drafts survive network failure and are isolated by account', async ({page}) => {
  const state = await setup(page);
  await page.goto(base + '/writer?action=chapters&work=' + reference);
  await page.getByRole('button', {name: '新建章节', exact: true}).click();
  await page.getByLabel('章节名', {exact: true}).fill('只有当前账号能看到');
  await page.getByLabel('正文', {exact: true}).fill('离线也不能丢失的正文');
  await page.getByRole('button', {name: '保存', exact: true}).click();
  await expect(page.locator('.writing-save-state')).toContainText('已保存到本机');
  await page.getByRole('button', {name: '返回草稿箱'}).click();
  await page.route('**/api/writer/workspace/**', route => route.fulfill({status: 503, json: {error: 'offline'}}));
  await page.reload();
  await expect(page.getByText('当前离线，仍可在本机继续写作；联网后再发布。')).toBeVisible();
  await page.locator('.writing-chapter').filter({hasText:'只有当前账号能看到'}).click();
  await expect(page.getByLabel('正文', {exact: true})).toHaveValue('离线也不能丢失的正文');
  await page.getByRole('button', {name: '返回草稿箱'}).click();
  state.account = '000000000000000000000098';
  await page.reload();
  await expect(page.locator('.writing-chapters')).toHaveCount(0);
  expect(state.mutations).toBe(0);
});

test('publishing failure retains local content; retry publishes exactly that chapter', async ({page}) => {
  const state = await setup(page); state.fail = true;
  await page.goto(base + '/writer?action=chapters&work=' + reference);
  await page.getByRole('button', {name: '新建章节', exact: true}).click();
  await page.getByLabel('正文', {exact: true}).fill('准备好发布的正文。');
  page.on('dialog', dialog => dialog.accept());
  await page.getByRole('button', {name: '发布', exact: true}).click();
  await expect(page.locator('.writing-error')).toContainText('本地草稿仍保留');
  await expect(page.getByLabel('正文', {exact: true})).toHaveValue('准备好发布的正文。');
  state.fail = false;
  await page.getByRole('button', {name: '发布', exact: true}).click();
  await expect(page.locator('.writing-editor')).toHaveCount(0);
  await expect(page.getByRole('tab', {name: /已发布/})).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', {name: /草稿箱/}).click();
  await expect(page.locator('.writing-chapters li')).toHaveCount(1);
  expect(state.mutations).toBe(2);
});

test('storage errors keep the editor open and allow a text backup', async ({page}) => {
  await setup(page);
  await page.goto(base + '/writer?action=chapters&work=' + reference);
  await page.getByRole('button', {name: '新建章节', exact: true}).click();
  await expect(page.getByLabel('正文', {exact: true})).toBeVisible();
  await page.evaluate(() => {IDBObjectStore.prototype.put = () => {throw new DOMException('Quota', 'QuotaExceededError');};});
  await page.getByLabel('正文', {exact: true}).fill('存储已满时也必须留在页面中的正文。');
  await page.getByRole('button', {name: '保存', exact: true}).click();
  await expect(page.locator('.writing-error')).toContainText('本地保存失败');
  await page.getByRole('button', {name: '返回草稿箱'}).click();
  await expect(page.locator('.writing-editor')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', {name: '下载备份'}).click();
  expect((await download).suggestedFilename()).toBe('第9章-草稿.txt');
});

test('another tab cannot silently overwrite a saved draft', async ({page, context}) => {
  await setup(page);
  await page.goto(base + '/writer?action=chapters&work=' + reference);
  await page.getByRole('button', {name: '新建章节', exact: true}).click();
  await page.getByLabel('章节名', {exact: true}).fill('两个页面');
  await page.getByLabel('正文', {exact: true}).fill('共同的起点。');
  await page.getByRole('button', {name: '保存', exact: true}).click();
  await expect(page.locator('.writing-save-state')).toContainText('已保存到本机');
  const second = await context.newPage(); await setup(second);
  await second.goto(base + '/writer?action=chapters&work=' + reference);
  await second.locator('.writing-chapter').filter({hasText: '两个页面'}).click();
  await page.getByLabel('正文', {exact: true}).fill('第一个页面保存的新正文。');
  await page.getByRole('button', {name: '保存', exact: true}).click();
  await expect(page.locator('.writing-save-state')).toContainText('已保存到本机');
  await second.getByLabel('正文', {exact: true}).fill('第二个页面还在写的内容。');
  await second.getByRole('button', {name: '保存', exact: true}).click();
  await expect(second.locator('.writing-error')).toContainText('另一页面更新');
  expect((await localRows(page)).find(row => row.title === '两个页面')!.content).toBe('第一个页面保存的新正文。');
  await expect(second.getByLabel('正文', {exact: true})).toHaveValue('第二个页面还在写的内容。');
  await second.close();
  await page.reload();
  await expect(page.getByLabel('正文', {exact: true})).toHaveValue('第一个页面保存的新正文。');
});
