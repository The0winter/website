import {test, expect, type Page} from '@playwright/test';

const base = process.env.FEATURED_BASE || 'http://127.0.0.1:3000';
const preference = 'mobile-home:pinned-category:v1';
test.use({hasTouch: true});
test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'connection', {value: {saveData: true, addEventListener() {}, removeEventListener() {}}});
    document.addEventListener('DOMContentLoaded', () => {const style = document.createElement('style'); style.textContent = 'nextjs-portal{display:none}'; document.head.append(style);});
  });
});
const primary = (page: Page) => page.getByRole('group', {name: '小说分类', exact: true});
const more = (page: Page) => page.getByRole('dialog', {name: '更多分类'});

for (const width of [320, 390]) test(`two rows keep a chosen overflow category second across selection and reload at ${width}px`, async ({page}, info) => {
  await page.setViewportSize({width, height: 844});
  await page.goto(base + '/?view=category');
  const buttons = primary(page).getByRole('button');
  await expect(buttons).toHaveCount(10);
  await expect(buttons.first()).toHaveText('全部');
  await expect(buttons.last()).toHaveText('更多分类');
  const tops = await buttons.evaluateAll(nodes => nodes.map(node => Math.round(node.getBoundingClientRect().top)));
  expect([...new Set(tops)]).toHaveLength(2);
  expect(tops.filter(top => top === tops[0])).toHaveLength(5);
  await expect(primary(page).getByRole('button', {name: '武侠', exact: true})).toHaveCount(0);
  await page.screenshot({path: info.outputPath('verified-categories-compact.png')});
  await buttons.last().click();
  await expect(more(page)).toBeVisible();
  await expect(more(page).getByRole('group').getByRole('button')).toHaveCount(8);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  await page.screenshot({path: info.outputPath('verified-categories-more.png')});
  await more(page).getByRole('button', {name: '武侠', exact: true}).click();
  await expect(more(page)).not.toBeVisible();
  await expect(buttons.nth(1)).toHaveText('武侠');
  await expect(buttons.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL(/category=%E6%AD%A6%E4%BE%A0/);
  await expect(page.getByRole('heading', {name: '武侠作品', exact: true})).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  expect(await page.evaluate(key => localStorage.getItem(key), preference)).toBe('武侠');
  await buttons.first().click();
  await expect(buttons.nth(1)).toHaveText('武侠');
  await page.reload();
  await expect(buttons.nth(1)).toHaveText('武侠');
  await page.getByRole('button', {name: '返回精选'}).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-book-transition', /.+/);
  await page.locator('.mh-shortcuts').getByRole('button', {name: '分类', exact: true}).click();
  await expect(buttons.nth(1)).toHaveText('武侠');
  await expect(page.locator('html')).not.toHaveAttribute('data-book-transition', /.+/);
  await buttons.last().click();
  await more(page).getByRole('button', {name: '轻小说', exact: true}).click();
  await expect(buttons.nth(1)).toHaveText('轻小说');
  await expect(buttons).toHaveCount(10);
  await page.reload();
  await expect(buttons.nth(1)).toHaveText('轻小说');
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await expect(buttons.first()).toHaveCSS('background-color', 'rgb(46, 40, 35)');
  await page.screenshot({path: info.outputPath('verified-categories-pinned-dark.png')});
  await buttons.last().click();
  await expect(more(page).getByRole('button', {name: '武侠', exact: true})).toBeVisible();
  await page.screenshot({path: info.outputPath('verified-categories-more-dark.png')});
  await page.keyboard.press('Escape');
  await expect(more(page)).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('invalid saved categories are ignored and unavailable storage still allows a session pin', async ({page}) => {
  await page.setViewportSize({width: 320, height: 844});
  await page.addInitScript(key => {
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
    Storage.prototype.getItem = function(name) {return name === key ? '失效的分类' : get.call(this, name);};
    Storage.prototype.setItem = function(name, value) {if (name === key) throw new DOMException('Storage disabled', 'QuotaExceededError'); set.call(this, name, value);};
  }, preference);
  await page.goto(base + '/?view=category');
  await expect(primary(page).getByRole('button').nth(1)).toHaveText('玄幻');
  await primary(page).getByRole('button', {name: '更多分类', exact: true}).click();
  await more(page).getByRole('button', {name: '诸天无限', exact: true}).click();
  await expect(primary(page).getByRole('button').nth(1)).toHaveText('诸天无限');
  await primary(page).getByRole('button', {name: '全部', exact: true}).click();
  await expect(primary(page).getByRole('button').nth(1)).toHaveText('诸天无限');
  await expect(primary(page).getByRole('button')).toHaveCount(10);
});

test('a short shelf drag moves before release and does not snap back or switch sections', async ({page, context}, info) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.goto(base);
  const shelf = page.locator('.mobile-home:visible .mh-shelf').first();
  await shelf.scrollIntoViewIfNeeded();
  const box = (await shelf.boundingBox())!, x = 250, y = box.y + 45;
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y, id: 1}]});
  for (const dx of [10, 20, 30, 40, 50, 60]) {
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: x - dx, y, id: 1}]});
    await page.waitForTimeout(30);
  }
  const whileHeld = await shelf.evaluate(el => el.scrollLeft);
  expect(whileHeld).toBeGreaterThan(15);
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  await cdp.detach();
  await expect(shelf).toHaveCSS('scroll-snap-type', 'none');
  await expect.poll(() => shelf.evaluate(el => el.scrollLeft)).toBeGreaterThan(15);
  await expect(page).toHaveURL(base + '/');
  await page.screenshot({path: info.outputPath('verified-short-drag.png')});
});
