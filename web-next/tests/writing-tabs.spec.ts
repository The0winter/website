import {test, expect, type Page} from '@playwright/test';

const base = process.env.CREATION_BASE_URL || 'http://127.0.0.1:3119';
const account = {id: '000000000000000000000099', username: '清风', role: 'reader'};
const title = '山海来信';
async function setup(page: Page) {
  await page.route('**/api/auth/session', route => route.fulfill({json: {user: account, profile: account}}));
  await page.route('**/api/auth/csrf', route => route.fulfill({json: {csrfToken: 'test'}}));
  await page.route('**/api/writer/works?**', route => route.fulfill({json: [{id: 'tabs-test', title, manuscriptKey: 'tabs-test', visibility: 'private'}]}));
  await page.route('**/api/writer/workspace/**', route => route.fulfill({json: {
    work: {reference: 'm_tabs-test', title, visibility: 'private'},
    cloudDrafts: [{id: 'tabs-draft', title: '海上的信', content: '草稿正文', number: 2, updatedAt: '2026-09-14T08:00:00.000Z'}],
    published: [{id: '000000000000000000000011', title: '风起', number: 1, words: 1200}],
    total: 1, maxNumber: 2, publishedDraftIds: [],
  }}));
}
async function drag(page: Page, dx: number, dy = 0) {
  const box = (await page.locator('.writing-tab-panels').boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + 180;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, {steps: 8});
  await page.mouse.up();
}
for (const width of [320, 390, 430, 1440]) test(`writing header and equal tabs with drag navigation at ${width}`, async ({page}, info) => {
  await page.setViewportSize({width, height: 844}); await setup(page);
  await page.goto(base);
  let arrow: string | undefined;
  if (width < 768) {
    await page.getByRole('button', {name: '创作', exact: true}).click();
    arrow = await page.locator('.mw-back svg').innerHTML();
    await page.locator('.mw-book').getByRole('link', {name: '创作', exact: true}).click();
  } else {
    await page.goto(base + '/writer?action=chapters&work=m_tabs-test');
  }
  await expect(page.locator('.writing-heading h2')).toHaveText(title);
  if (width < 768) await expect(page.locator('.mw-view-panel')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#writing-drafts')).toContainText('海上的信');
  if (width < 768) {
    const heading = (await page.locator('.writing-heading h2').boundingBox())!;
    expect(heading.x + heading.width / 2).toBeCloseTo(width / 2, 0);
    const back = page.locator('.writing-heading button');
    expect(await back.locator('svg').innerHTML()).toBe(arrow);
    await expect(back).toHaveCSS('border-top-width', '0px');
    await expect(back.locator('svg')).toHaveAttribute('width', '21');
  }
  const list = (await page.getByRole('tablist').boundingBox())!;
  const draft = page.getByRole('tab', {name: /草稿箱/}), published = page.getByRole('tab', {name: /已发布/});
  for (const tab of [draft, published]) expect((await tab.boundingBox())!.width).toBeCloseTo(list.width / 3, 0);
  await drag(page, -22); await expect(draft).toHaveAttribute('aria-selected', 'true');
  await drag(page, 5, 75); await expect(draft).toHaveAttribute('aria-selected', 'true');
  await drag(page, -90); await expect(published).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel')).toHaveCount(1);
  await expect(page.getByRole('tabpanel')).toContainText('风起');
  await expect(page.locator('.writing-editor')).toHaveCount(0);
  await drag(page, -90); await expect(page.getByRole('tab', {name: /回收站/})).toHaveAttribute('aria-selected', 'true');
  await drag(page, 90); await expect(published).toHaveAttribute('aria-selected', 'true');
  await drag(page, 90); await expect(draft).toHaveAttribute('aria-selected', 'true');
  await published.click(); await expect(published).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowLeft'); await expect(draft).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => page.locator('#writing-drafts').evaluate(el => new DOMMatrix(getComputedStyle(el).transform).m41)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path: info.outputPath('writing-tabs.png')});
  if (width < 768) {await page.getByRole('button', {name: '返回创作中心', exact: true}).click(); await expect(page.locator('.mw-view')).toHaveCount(0);}
});

test('real touch follows the finger, cancels cleanly and does not open a dragged chapter', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844}); await setup(page);
  await page.goto(base + '/writer?action=chapters&work=m_tabs-test');
  const chapter = page.locator('#writing-drafts .writing-chapter'); await expect(chapter).toBeVisible();
  // Raw CDP input needs stable coordinates after the workspace's entrance animation.
  await chapter.click({trial: true});
  const box = (await chapter.boundingBox())!;
  const session = await page.context().newCDPSession(page);
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', px = x, py = y) => session.send('Input.dispatchTouchEvent', {type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{x: px, y: py}]});
  await touch('touchStart'); await touch('touchMove', x - 65);
  await expect.poll(() => page.locator('#writing-drafts').evaluate(el => new DOMMatrix(getComputedStyle(el).transform).m41)).toBeLessThan(-40);
  await touch('touchCancel');
  await expect(page.getByRole('tab', {name: /草稿箱/})).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => page.locator('#writing-drafts').evaluate(el => new DOMMatrix(getComputedStyle(el).transform).m41)).toBe(0);
  await touch('touchStart'); await touch('touchMove', x - 90); await touch('touchEnd');
  await expect(page.getByRole('tab', {name: /已发布/})).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.writing-editor')).toHaveCount(0);
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.getByRole('tab', {name: /草稿箱/}).click();
  await expect(chapter).toBeVisible();
  await chapter.click(); await expect(page.locator('.writing-editor')).toBeVisible();
});
