import {test, expect, type Page} from '@playwright/test';

const base = process.env.CREATION_BASE_URL || 'http://127.0.0.1:3118';
const account = {id: '000000000000000000000099', username: '返回测试', role: 'reader'};
const book = {id: '000000000000000000000199', title: '山海来信', author_id: account.id};
const center = (page: Page) => page.locator('.mw-dialog');

test.beforeEach(async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.route('**/api/auth/session', route => route.fulfill({json: {user: account, profile: account}}));
  await page.route('**/api/auth/csrf', route => route.fulfill({json: {csrfToken: 'history-test'}}));
  await page.route('**/api/writer/works?**', route => route.fulfill({json: [book]}));
  await page.route('**/api/books/' + book.id, route => route.fulfill({json: {...book, description: '用于返回检查的作品简介。'}}));
  await page.route('**/api/writer/statistics?**', route => route.fulfill({json: {points: [], totalViews: 0, historyStart: '2026-09-14', hasPrevious: false, hasNext: false}}));
  await page.route('**/api/writer/workspace/**', route => {
    if (route.request().method() === 'PUT') {
      const data = route.request().postDataJSON();
      return route.fulfill({json: {...data, cloudRevision: data.revision + 1, contentLoaded: true}});
    }
    return route.fulfill({json: {
    work: {reference: 'b_' + book.id, title: book.title, bookId: book.id, visibility: 'public'},
    cloudDrafts: [{id: 'history-draft', title: '风起', content: '反复返回后仍保留的正文。', number: 1, cloudRevision: 1, contentLoaded: true}],
    published: [], total: 0, maxNumber: 1, publishedDraftIds: [],
  }});
  });
  await page.addInitScript(() => {
    const events: unknown[] = [];
    Object.assign(window, {writerHistoryTrace: events});
    window.addEventListener('popstate', () => events.push({kind: 'pop', time: performance.now(), state: history.state, overflow: document.body.style.overflow}), true);
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style'); style.textContent = 'nextjs-portal{display:none!important}'; document.head.append(style);
    });
  });
});

async function launch(page: Page) {
  await page.goto(base);
  await page.getByRole('button', {name: '创作', exact: true}).click();
  await expect(center(page)).toHaveAttribute('data-ready', 'true');
}
async function editor(page: Page) {
  await launch(page);
  await center(page).getByRole('link', {name: '创作', exact: true}).click();
  await page.locator('.writing-chapter').click();
  await expect(page.getByLabel('正文', {exact: true})).toBeVisible();
}

test('native Back repeatedly returns each child to its retained creation center', async ({page}, info) => {
  test.setTimeout(120000);
  await launch(page);
  const marker = await page.evaluate(() => history.state.mobileWriter);
  const actions = ['新建作品', '创作', '作品数据'];
  for (let index = 0; index < 36; index++) {
    await center(page).getByRole('link', {name: new RegExp('^' + actions[index % actions.length])}).click();
    if (index % 2) await expect(page.locator('.mw-view-panel')).toHaveAttribute('data-ready', 'true');
    await page.goBack();
    await expect(page.locator('.mw-view')).toHaveCount(0);
    await expect(center(page)).toBeVisible();
    expect(await page.evaluate(() => history.state.mobileWriter)).toBe(marker);
    await expect(center(page).locator('.mw-scroll')).not.toHaveAttribute('inert');
  }
  await page.goBack();
  await expect(center(page)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  await info.attach('history', {body: JSON.stringify(await page.evaluate(() => (window as Window & {writerHistoryTrace?: unknown[]}).writerHistoryTrace ?? [])), contentType: 'application/json'});
});

test('rapid native Back out of an editor leaves the home page interactive and unlocked', async ({page}) => {
  await editor(page);
  await page.evaluate(() => history.go(-3));
  await expect(center(page)).toHaveCount(0);
  await expect(page.locator('.writing-editor')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  await page.getByRole('button', {name: '创作', exact: true}).click();
  await expect(center(page)).toBeVisible();
});

test('native Back out of metadata editing releases its lock only after the center exits', async ({page}) => {
  await launch(page);
  await page.getByLabel(`管理《${book.title}》`).click();
  await page.getByRole('button', {name: '编辑作品', exact: true}).click();
  await expect(page.getByRole('dialog', {name: '编辑作品', exact: true})).toBeVisible();
  await expect(page.locator('.work-edit-dialog form')).toHaveAttribute('data-busy', 'false');
  await page.goBack();
  await expect(page.locator('.work-edit-dialog')).toHaveCount(0);
  await expect(center(page)).toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  await page.goBack();
  await expect(center(page)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
});

test('the third browser close request does not silently close the retained dialog', async ({page}, info) => {
  await launch(page);
  const cancellations: boolean[] = [];
  await page.exposeFunction('recordWriterCancel', (cancelable: boolean) => cancellations.push(cancelable));
  await center(page).evaluate(dialog => dialog.addEventListener('cancel', event => {
    void (window as Window & {recordWriterCancel?: (cancelable: boolean) => Promise<void>}).recordWriterCancel?.(event.cancelable);
  }));
  try {
    for (let index = 0; index < 6; index++) {
      await center(page).getByRole('link', {name: index % 2 ? '创作' : /新建作品/, exact: index % 2 === 1}).click();
      await expect(page.locator('.mw-view-panel')).toHaveAttribute('data-ready', 'true');
      await page.keyboard.press('Escape');
      await expect(page.locator('.mw-view')).toHaveCount(0);
      await expect(center(page)).toBeVisible();
      expect(await center(page).evaluate(dialog => (dialog as HTMLDialogElement).open)).toBe(true);
    }
  } finally {await info.attach('native-cancel-events', {body: JSON.stringify(cancellations), contentType: 'application/json'});}
});

test('a non-cancelable native dialog close cannot leave an invisible locked center', async ({page}) => {
  await launch(page);
  await center(page).getByRole('link', {name: /新建作品/}).click();
  await expect(page.locator('.mw-view-panel')).toHaveAttribute('data-ready', 'true');
  await center(page).evaluate(element => {
    // Older engines may ignore closedby and force the native close regardless
    // of preventDefault. Deliver both events in their browser-defined order.
    element.dispatchEvent(new Event('cancel', {cancelable: false}));
    (element as HTMLDialogElement).close();
  });
  await expect(page.locator('.mw-view')).toHaveCount(0);
  await expect(center(page)).toBeVisible();
  await page.goBack();
  await expect(center(page)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
});

test('native Forward during center dismissal cancels closing instead of orphaning the history entry', async ({page}) => {
  await launch(page);
  await page.evaluate(() => {
    window.addEventListener('popstate', () => setTimeout(() => history.forward(), 30), {once: true});
    history.back();
  });
  await expect(center(page)).toHaveAttribute('data-closing', 'true');
  await expect.poll(() => page.evaluate(() => Boolean(history.state.mobileWriter))).toBe(true);
  await expect(center(page)).not.toHaveAttribute('data-closing', 'true');
  await center(page).getByRole('link', {name: /新建作品/}).click();
  await expect(page.getByLabel('书名', {exact: true})).toBeVisible();
});

test('a repeated UI Back request during one child dismissal traverses only one level', async ({page}) => {
  await launch(page);
  await center(page).getByRole('link', {name: /作品数据/}).click();
  await page.getByRole('button', {name: '返回创作中心', exact: true}).evaluate(button => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  await expect(page.locator('.mw-view')).toHaveCount(0);
  await expect(center(page)).toBeVisible();
});
