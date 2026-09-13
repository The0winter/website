import {test, expect, type Page} from '@playwright/test';

const base = process.env.MOBILE_SECTIONS_BASE || 'http://127.0.0.1:3000';
test.use({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});

async function setup(page: Page, path = '/') {
  const user = {id: '000000000000000000000001', username: '顶部固定验证', role: 'reader'};
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'connection', {value: {saveData: true, addEventListener() {}, removeEventListener() {}}});
    document.addEventListener('DOMContentLoaded', () => {const style = document.createElement('style'); style.textContent = 'nextjs-portal{display:none}'; document.head.append(style);});
    const animate = Element.prototype.animate;
    Element.prototype.animate = function(frames, options) {
      const animation = animate.call(this, frames, options);
      if (this.classList.contains('mobile-section-snapshot') && (window as unknown as {holdMotion: boolean}).holdMotion) {
        animation.pause(); animation.currentTime = Number(animation.effect!.getTiming().duration) / 2;
      }
      return animation;
    };
  });
  await page.route('**/api/auth/session', route => route.fulfill({json: {user, profile: user}}));
  await page.route('**/api/users/*/library?*', route => route.fulfill({json: [{bookId: '1', book: {id: '1', title: '固定顶部栏', author: '作者'}}]}));
  await page.route('**/api/forum/posts*', route => route.fulfill({json: []}));
  await page.goto(base + path);
  await expect(page.locator('.mobile-account-initial:visible')).toHaveText('顶');
  await page.evaluate(() => document.fonts.ready);
}

for (const width of [320, 390]) test(`${width}px the header pixels stay fixed while content moves and forum keeps its own search prompt`, async ({page, context}, info) => {
  await page.setViewportSize({width, height: 844});
  await setup(page);
  for (const [path, direction] of [['/library', -1], ['/', 1], ['/forum', 1], ['/', -1]] as const) {
    await expect(page.locator('.mobile-section-snapshot')).toHaveCount(0);
    const bar = await page.locator('.mh-topbar:visible').boundingBox();
    const clip = {x: 0, y: 0, width, height: Math.ceil(bar!.y + bar!.height)};
    const before = await page.screenshot({clip});
    const cdp = await context.newCDPSession(page), x = width * (direction > 0 ? .8 : .2), y = 320;
    await page.evaluate(() => Object.assign(window, {holdMotion: true}));
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y, id: 1}]});
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: x - direction * 50, y, id: 1}]});
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: x - direction * 140, y, id: 1}]});
    await expect(page.locator('html')).toHaveAttribute('data-mobile-section-transition', 'dragging');
    const during = await page.screenshot({clip});
    await test.info().attach('header-before-' + path, {body: before, contentType: 'image/png'});
    await test.info().attach('header-drag-' + path, {body: during, contentType: 'image/png'});
    expect(during.equals(before)).toBe(true);
    const geometry = await page.locator('.mobile-section-snapshot').evaluateAll(elements => elements.map(element => ({top: element.getBoundingClientRect().top, promoted: getComputedStyle(element).willChange})));
    expect(geometry.every(element => element.top >= clip.height && element.promoted === 'transform')).toBe(true);
    expect(await page.locator('.mobile-section-header').evaluate(element => element.getAnimations().length)).toBe(0);
    await page.screenshot({path: info.outputPath('fixed-header-drag-' + path.replaceAll('/', '_') + '.png')});
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
    await cdp.detach();
    await expect(page).toHaveURL(base + path);
    await expect(page.locator('.mh-topbar:visible input')).toHaveAttribute('placeholder', path === '/forum' ? '搜索问题或文章' : '搜索书名、作者');
    expect(await page.locator('.mh-topbar:visible').boundingBox()).toEqual(bar);
    await page.evaluate(() => Object.assign(window, {holdMotion: false}));
    await page.locator('.mobile-section-snapshot').evaluateAll(elements => elements.forEach(element => element.getAnimations().forEach(animation => animation.play())));
    await expect(page.locator('.mobile-section-header, .mobile-section-snapshot')).toHaveCount(0);
  }
});

for (const path of ['/', '/library', '/forum']) test(`${path} dragging avoids full-document clones and per-element style reads`, async ({page, context}) => {
  await setup(page, path);
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const budget = {styles: 0, bodyClones: 0};
    Object.assign(window, {motionBudget: budget});
    const computed = window.getComputedStyle;
    window.getComputedStyle = function(...args) {budget.styles++; return computed.apply(this, args);};
    const clone = Node.prototype.cloneNode;
    Node.prototype.cloneNode = function(...args) {if (this === document.body) budget.bodyClones++; return clone.apply(this, args);};
  });
  const cdp = await context.newCDPSession(page), x = path === '/forum' ? 60 : 330, sign = path === '/forum' ? 1 : -1, y = 320;
  await cdp.send('Emulation.setCPUThrottlingRate', {rate: 4});
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y, id: 1}]});
  for (const distance of [30, 70, 120, 90, 150]) {
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: x + sign * distance, y, id: 1}]});
    await page.waitForTimeout(16);
  }
  const budget = await page.evaluate(() => (window as unknown as {motionBudget: {styles: number; bodyClones: number}}).motionBudget);
  expect(budget.bodyClones).toBe(0);
  expect(budget.styles).toBeLessThan(20);
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchCancel', touchPoints: []});
  await cdp.detach();
  await expect(page.locator('.mobile-section-header, .mobile-section-snapshot')).toHaveCount(0);
});

test('the fixed header buttons and search stay usable after a cancelled swipe', async ({page, context}) => {
  await setup(page, '/forum');
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: 70, y: 320, id: 1}]});
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: 120, y: 320, id: 1}]});
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchCancel', touchPoints: []});
  await cdp.detach();
  await expect(page.locator('.mobile-section-header')).toHaveCount(0);
  await page.locator('.mh-topbar input').fill('测试问题');
  await expect(page.locator('.mh-topbar input')).toHaveValue('测试问题');
  await page.locator('.mh-logo:visible').tap();
  await expect(page).toHaveURL(base + '/');
  await expect(page.locator('.mobile-section-header')).toHaveCount(0);
  await page.locator('.mobile-account-link:visible').tap();
  await expect(page).toHaveURL(base + '/profile');
});
