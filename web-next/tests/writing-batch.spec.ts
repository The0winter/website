import {test, expect, type Page, type Locator} from '@playwright/test';
import type {WritingDraft, WorkspaceSnapshot} from '../lib/writing-drafts';

const base = process.env.CREATION_BASE_URL || 'http://127.0.0.1:3121';
const reference = 'm_batch-test';
async function setup(page: Page, count = 3) {
  const user = {id: '000000000000000000000099', username: '清风', role: 'reader'};
  const state = {
    drafts: new Map(Array.from({length: count}, (_, i) => [`draft-${i + 1}`, {id: `draft-${i + 1}`, title: i === 0 ? '第一章 风起' : `来信${i + 1}`, content: `第${i + 1}章完整的云端正文。`, number: i + 1, revision: 0, cloudRevision: 1, updatedAt: '2026-09-14T08:00:00Z'} as WritingDraft])),
    published: [{id: 'published-1', title: '序章', number: 0, words: 123, updatedAt: '2026-09-14T08:00:00Z'}] as WorkspaceSnapshot['published'],
    receipts: [] as string[], mutations: [] as {id: string; method: string; body?: WritingDraft}[], failId: '', loseResponseId: '', deletedChapters: [] as (WorkspaceSnapshot['published'][number] & {deletedAt: string; trashUntil: string})[],
  };
  await page.route('**/api/auth/session', route => route.fulfill({json: {user, profile: user}}));
  await page.route('**/api/auth/csrf', route => route.fulfill({json: {csrfToken: 'test'}}));
  await page.route('**/api/writer/works?**', route => route.fulfill({json: [{id: 'batch-test', title: '山海来信', manuscriptKey: 'batch-test', visibility: 'private'}]}));
  await page.route('**/api/chapters/**', route => {
    const restoring = route.request().url().endsWith('/restore');
    const id = route.request().url().split('/').at(restoring ? -2 : -1)!;
    if (restoring) {const row = state.deletedChapters.find(row => row.id === id)!; state.published.push(row);state.deletedChapters = state.deletedChapters.filter(row => row.id !== id);return route.fulfill({json: {success: true}});}
    if (route.request().method() !== 'DELETE') return route.fulfill({status: 405});
    const row = state.published.find(row => row.id === id)!;state.deletedChapters.push({...row,deletedAt:new Date().toISOString(),trashUntil:new Date(Date.now()+7*86400000).toISOString()});
    state.mutations.push({id, method: 'DELETE'}); state.published = state.published.filter(row => row.id !== id);
    return route.fulfill({json: {success: true}});
  });
  await page.route('**/api/writer/workspace/**', route => {
    const req = route.request(), id = /\/drafts\/([^/?]+)/.exec(req.url())?.[1];
    const recycle = /\/trash\/drafts\/([^/]+)\/(delete|restore)$/.exec(req.url());
    if (recycle) {
      const id = recycle[1];state.mutations.push({id,method:req.method()});
      if (state.failId === id) return route.fulfill({status:503,json:{error:'网络暂不可用'}});
      const draft=state.drafts.get(id)!;const row={...draft,deleted:recycle[2]==='delete',cloudRevision:(draft.cloudRevision || 0)+1,deletedAt:new Date().toISOString(),trashUntil:new Date(Date.now()+7*86400000).toISOString()};state.drafts.set(id,row);return route.fulfill({json:row});
    }
    if (req.method() === 'GET' && id) return route.fulfill({json: {...state.drafts.get(id), contentLoaded: true}});
    if (req.method() !== 'GET') {
      const body = req.postDataJSON() as WritingDraft;
      state.mutations.push({id: body.id, method: req.method(), body});
      if (state.failId === body.id) return route.fulfill({status: 503, json: {error: '网络暂不可用'}});
      if (id) {
        const row = {...body, revision: 0, cloudRevision: (state.drafts.get(id)?.cloudRevision || 0) + 1, updatedAt: '2026-09-14T09:00:00Z'};
        state.drafts.set(id, row); return route.fulfill({json: row});
      }
      state.receipts.push(body.id);
      state.published.push({id: body.id, title: body.title, number: body.number, words: body.content.length, updatedAt: '2026-09-14T09:00:00Z'});
      if (state.loseResponseId === body.id) return route.fulfill({status: 503, json: {error: '响应中断'}});
      return route.fulfill({json: {bookId: 'book', chapterId: body.id}});
    }
    return route.fulfill({json: {work: {reference, title: '山海来信', bookId: null, visibility: 'private'},
      cloudDrafts: [...state.drafts.values()].filter(row => !state.receipts.includes(row.id)).map(row => ({...row, content: '', contentLoaded: false, words: row.content.length})),
      trash: [...[...state.drafts.values()].filter(row=>row.deleted).map(row=>({...row,id:`draft:${row.id}`,sourceId:row.id,kind:'draft',words:row.content.length})),...state.deletedChapters.map(row=>({...row,id:`chapter:${row.id}`,sourceId:row.id,kind:'chapter'}))],
      published: state.published, total: state.published.length, maxNumber: count, publishedDraftIds: state.receipts,
    }});
  });
  return state;
}
async function enter(page: Page, embedded = false) {
  if (embedded) {
    await page.goto(base); await page.getByRole('button', {name: '创作', exact: true}).click();
    await page.locator('.mw-book').getByRole('link', {name: '创作', exact: true}).click();
    await expect(page.locator('.mw-view-panel')).toHaveAttribute('data-ready', 'true');
  } else await page.goto(base + '/writer?action=chapters&work=' + reference);
  await expect(page.locator('#writing-drafts .writing-chapter').first()).toBeVisible();
}
async function hold(page: Page, row: Locator) {
  await row.click({trial: true}); const box = (await row.boundingBox())!;
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: box.x + box.width / 2, y: box.y + box.height / 2}]});
  await expect(page.locator('.writing-workspace')).toHaveAttribute('data-managing', 'true');
  await session.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  await session.detach();
}

for (const width of [320, 390, 1440]) test(`compact chapter rows and animated management at ${width}`, async ({page}, info) => {
  await page.setViewportSize({width, height: 844}); await setup(page, 24);
  if (width === 390) await page.emulateMedia({colorScheme: 'dark'});
  await enter(page, width < 768);
  const first = page.locator('#writing-drafts .writing-chapter').first();
  await first.click({trial: true});
  const rowBox = (await first.boundingBox())!;
  expect(rowBox.height).toBeLessThanOrEqual(80);
  await expect(page.getByText('每分钟自动同步', {exact: true})).toHaveCount(0);
  await expect(page.locator('.writing-chapter-number,.writing-delete')).toHaveCount(0);
  await expect(page.getByRole('button', {name:'批量管理',exact:true})).toHaveCount(0);
  await expect(first.locator('strong')).toHaveCSS('font-size','17px');
  await expect(first.locator('small')).toHaveCSS('font-size','13px');
  await expect(first.locator('time')).toHaveCSS('font-size','12px');
  await expect(first.locator('time')).not.toContainText('最后编辑');
  await expect(page.locator('#writing-drafts strong').last()).toHaveText('第1章 风起');
  const time = (await first.locator('time').boundingBox())!;
  expect(time.x + time.width).toBeCloseTo(rowBox.x + rowBox.width, 0);
  if (width < 768) {
    const heading = (await page.locator('.writing-heading h2').boundingBox())!, tabs = (await page.getByRole('tablist').boundingBox())!;
    expect(tabs.y - heading.y - heading.height).toBeLessThanOrEqual(12);
    const add = page.getByRole('button', {name: '新建章节', exact: true});
    const before = (await add.boundingBox())!;
    expect(before.x + before.width / 2).toBeCloseTo(width / 2, 0); expect(before.y).toBeGreaterThan(740);
    await page.locator('.mw-view-body').evaluate(el => {el.scrollTop = 500;});
    await expect.poll(async () => (await add.boundingBox())!.y).toBeCloseTo(before.y, 0);
    await page.locator('.mw-view-body').evaluate(el => {el.scrollTop = 0;});
  }
  await page.screenshot({path: info.outputPath('chapters.png')});
  await page.locator('#writing-drafts li').first().getByRole('button', {name:/更多/}).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem')).toHaveCount(2);
  const menuBox = (await menu.boundingBox())!;
  expect(menuBox.x).toBeGreaterThanOrEqual(0); expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(width);
  await page.screenshot({path: info.outputPath('chapter-menu.png')});
  await page.keyboard.press('Escape'); await expect(menu).toHaveCount(0);
  await hold(page, first);
  await expect(first).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.writing-editor')).toHaveCount(0);
  const selection = first.locator('.writing-selection');
  await expect.poll(() => selection.evaluate(el => el.getBoundingClientRect().width)).toBe(32);
  const bar = page.getByRole('region', {name: '章节批量管理'});
  await expect(bar).toBeVisible();
  if (width === 390) expect(await bar.evaluate(el => getComputedStyle(el).transitionDuration)).toContain('0.28s');
  await page.locator('#writing-drafts .writing-chapter').nth(1).click();
  await expect(page.locator('#writing-drafts .writing-chapter').nth(1)).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('已选 2 章', {exact: true})).toBeVisible();
  await page.screenshot({path: info.outputPath('selection.png')});
  await page.goBack(); await expect(page.locator('.writing-workspace')).toHaveAttribute('data-managing', 'false');
  await expect(page.locator('.writing-heading h2')).toHaveText('山海来信');
  await first.click(); await expect(page.getByLabel('正文', {exact: true})).toHaveValue('第24章完整的云端正文。');
});

test('batch publish confirms, preserves failed drafts, and retries only unfinished chapters', async ({page}) => {
  const state = await setup(page); await enter(page);
  await page.getByRole('tabpanel').locator('.writing-chapter').first().focus(); await page.keyboard.press('Shift+F10'); await page.getByRole('tabpanel').locator('.writing-chapter').first().click();
  await page.getByRole('button', {name: '全选', exact: true}).click();
  const publish = page.getByRole('region', {name: '章节批量管理'}).getByRole('button', {name: '发布', exact: true});
  await publish.click(); const dialog = page.getByRole('dialog', {name: '发布选中的 3 章？'});
  await expect(dialog).toContainText('作品也会公开'); expect(state.mutations).toHaveLength(0);
  await dialog.getByRole('button', {name: '取消', exact: true}).click(); expect(state.mutations).toHaveLength(0);
  state.failId = 'draft-2'; await publish.click(); await dialog.getByRole('button', {name: '确认发布'}).click();
  await expect(page.locator('.writing-error')).toContainText('已发布 1 章');
  expect(state.receipts).toEqual(['draft-1']);
  await expect(page.getByText('已选 2 章', {exact: true})).toBeVisible();
  await expect(page.locator('#writing-drafts .writing-chapter')).toHaveCount(2);
  state.failId = ''; await publish.click(); await page.getByRole('button', {name: '确认发布'}).click();
  await expect(page.getByRole('tab', {name: /已发布/})).toHaveAttribute('aria-selected', 'true');
  expect(state.receipts).toEqual(['draft-1', 'draft-2', 'draft-3']);
  expect(state.mutations.filter(row => row.method === 'POST').map(row => row.body?.content)).toEqual(['第1章完整的云端正文。', '第2章完整的云端正文。', '第2章完整的云端正文。', '第3章完整的云端正文。']);
  await page.getByRole('tab', {name: /草稿箱/}).click(); await expect(page.locator('#writing-drafts .writing-chapter')).toHaveCount(0);
});

test('batch deletion needs confirmation and failed cloud deletes remain visible', async ({page}) => {
  const state = await setup(page); await enter(page);
  await page.getByRole('tabpanel').locator('.writing-chapter').first().focus(); await page.keyboard.press('Shift+F10'); await page.getByRole('tabpanel').locator('.writing-chapter').first().click(); await page.getByRole('button', {name: '全选', exact: true}).click();
  const remove = page.getByRole('region', {name: '章节批量管理'}).getByRole('button', {name: '删除', exact: true});
  await remove.click(); await page.getByRole('button', {name: '取消', exact: true}).click(); expect(state.mutations).toHaveLength(0);
  state.failId = 'draft-1'; await remove.click(); await page.getByRole('button', {name: '确认删除'}).click();
  await expect(page.locator('.writing-error')).toContainText('已删除 0 章'); await expect(page.locator('#writing-drafts .writing-chapter')).toHaveCount(3);
  state.failId = ''; await remove.click(); await page.getByRole('button', {name: '确认删除'}).click();
  await expect(page.locator('.writing-workspace')).toHaveAttribute('data-managing', 'false');
  await expect(page.locator('#writing-drafts .writing-chapter')).toHaveCount(0); expect(state.published).toHaveLength(1);
  await page.getByRole('tab', {name: /已发布/}).click();
  await page.getByRole('tabpanel').locator('.writing-chapter').first().focus(); await page.keyboard.press('Shift+F10'); await page.getByRole('tabpanel').locator('.writing-chapter').first().click(); await page.getByRole('button', {name: '全选', exact: true}).click();
  await expect(page.getByRole('region', {name: '章节批量管理'}).getByRole('button', {name: '已发布'})).toBeDisabled();
  await remove.click(); await expect(page.getByRole('dialog')).toContainText('暂时下架');
  await page.getByRole('button', {name: '确认删除'}).click(); await expect(page.locator('#writing-published .writing-chapter')).toHaveCount(0);
  expect(state.mutations.filter(row => row.method === 'DELETE')).toHaveLength(1);
});

test('scrolling cancels long press; reduced motion and tab changes clear selection', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844}); await setup(page, 24); await enter(page, true);
  const first = page.locator('#writing-drafts .writing-chapter').first(); await first.click({trial: true});
  const box = (await first.boundingBox())!, x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, y + 40, {steps: 4}); await page.waitForTimeout(600); await page.mouse.up();
  await expect(page.locator('.writing-workspace')).toHaveAttribute('data-managing', 'false'); await expect(page.locator('.writing-editor')).toHaveCount(0);
  await page.emulateMedia({reducedMotion: 'reduce'}); await hold(page, first);
  await expect(page.locator('.writing-batch-bar')).toHaveCSS('transition-duration', '0s');
  await page.getByRole('tab', {name: /已发布/}).click();
  await expect(page.locator('.writing-workspace')).toHaveAttribute('data-managing', 'false');
  await expect(page.getByRole('tab', {name: /已发布/})).toHaveAttribute('aria-selected', 'true');
});

test('an empty chapter stops batch publication without losing it or later drafts', async ({page}) => {
  const state = await setup(page); state.drafts.get('draft-2')!.content = '  ';
  await enter(page); await page.getByRole('tabpanel').locator('.writing-chapter').first().focus(); await page.keyboard.press('Shift+F10'); await page.getByRole('tabpanel').locator('.writing-chapter').first().click();
  await page.getByRole('button', {name: '全选', exact: true}).click();
  await page.getByRole('region', {name: '章节批量管理'}).getByRole('button', {name: '发布', exact: true}).click();
  await page.getByRole('button', {name: '确认发布'}).click();
  await expect(page.locator('.writing-error')).toContainText('正文为空');
  expect(state.receipts).toEqual(['draft-1']);
  await expect(page.locator('#writing-drafts .writing-chapter')).toHaveCount(2);
  await expect(page.getByText('已选 2 章', {exact: true})).toBeVisible();
  await page.getByRole('button', {name: '完成', exact: true}).click();
  await page.locator('#writing-drafts .writing-chapter').filter({hasText: '第2章'}).click();
  await expect(page.getByLabel('正文', {exact: true})).toHaveValue('  ');
});

test('a lost publication response reconciles the receipt before retrying remaining chapters', async ({page}) => {
  const state = await setup(page); state.loseResponseId = 'draft-1'; await enter(page);
  await page.getByRole('tabpanel').locator('.writing-chapter').first().focus(); await page.keyboard.press('Shift+F10'); await page.getByRole('tabpanel').locator('.writing-chapter').first().click(); await page.getByRole('button', {name: '全选', exact: true}).click();
  const publish = page.getByRole('region', {name: '章节批量管理'}).getByRole('button', {name: '发布', exact: true});
  await publish.click(); await page.getByRole('button', {name: '确认发布'}).click();
  await expect(page.getByText('已选 2 章', {exact: true})).toBeVisible();
  await expect(page.locator('.writing-error')).toContainText('已发布 1 章');
  await publish.click(); await page.getByRole('button', {name: '确认发布'}).click();
  await expect(page.getByRole('tab', {name: /已发布/})).toHaveAttribute('aria-selected', 'true');
  expect(state.receipts).toEqual(['draft-1', 'draft-2', 'draft-3']);
});

test('single chapter menu recycles and restores a draft with its original content', async ({page}, info) => {
  await page.setViewportSize({width:390,height:844});
  const state = await setup(page); await enter(page, true);
  await page.locator('#writing-drafts li').last().getByRole('button', {name:/更多/}).click();
  await page.getByRole('menuitem', {name:'删除',exact:true}).click();
  await expect(page.getByRole('dialog', {name:'删除选中的 1 章？'})).toContainText('七天内可复原');
  await page.getByRole('button', {name:'确认删除'}).click();
  await expect(page.locator('#writing-drafts li')).toHaveCount(2);
  expect(state.drafts.get('draft-1')?.content).toBe('第1章完整的云端正文。');
  await page.getByRole('tab', {name:/回收站/}).click();
  await expect(page.locator('#writing-trash li')).toHaveCount(1);
  await expect(page.locator('#writing-trash li')).toContainText('后自动清除');
  await page.screenshot({path:info.outputPath('recycle-bin.png')});
  await page.locator('#writing-trash li').getByRole('button', {name:/更多/}).click();
  await page.getByRole('menuitem', {name:'复原'}).click(); await page.getByRole('button', {name:'确认复原'}).click();
  await expect(page.locator('#writing-trash li')).toHaveCount(0);
  await page.getByRole('tab', {name:/草稿箱/}).click();
  await page.locator('#writing-drafts .writing-chapter').last().click();
  await expect(page.getByLabel('正文', {exact:true})).toHaveValue('第1章完整的云端正文。');
});
