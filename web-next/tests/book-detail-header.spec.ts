import {test, expect} from '@playwright/test';

const base = process.env.DETAIL_BASE || 'http://127.0.0.1:3000';
const book = process.env.DETAIL_BOOK || '000000000000000000000101';
const detail = `${base}/book/${book}`;

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'connection', {value:{saveData:true, addEventListener(){}, removeEventListener(){}}});
  });
  await page.route('**/api/auth/session', route => route.fulfill({json:{user:null, profile:null}}));
});

for (const width of [320, 390, 430, 1440]) test(`detail has one usable navigation bar at ${width}px`, async ({page}, info) => {
  await page.setViewportSize({width, height:844});
  const errors:string[]=[];page.on('pageerror', error => errors.push(error.message));
  await page.goto(detail);
  const mobile = page.locator('.book-mobile-header');
  const header = width < 768 ? mobile : page.locator('nav[data-site-chrome]');
  await expect(header).toBeVisible();
  await expect(page.getByRole('combobox', {name:'搜索书名或作者'})).toHaveCount(1);
  if (width < 768) {
    await expect(page.locator('nav[data-site-chrome]')).not.toBeVisible();
    await expect(header.getByRole('link', {name:'九天小说首页'})).toBeVisible();
    await expect(header.getByRole('link', {name:'个人中心'})).toBeVisible();
    const top = await header.boundingBox(), hero = await page.locator('.book-hero').boundingBox();
    expect(top!.x).toBe(0);expect(top!.width).toBe(width);
    expect(hero!.y).toBeGreaterThanOrEqual(top!.y + top!.height);
    await page.evaluate(() => scrollTo(0, 240));
    await expect.poll(async () => (await header.boundingBox())!.y).toBe(0);
    await page.evaluate(() => scrollTo(0, 0));
    await expect(page.locator('.book-stat-value').first()).toHaveCSS('font-size', '18px');
    await expect(page.locator('.book-stat-value').first()).toHaveCSS('letter-spacing', /^(normal|0px)$/);
  } else {
    await expect(mobile).not.toBeVisible();
  }
  const toggle = header.getByRole('button', {name:/切换到夜间模式/});
  await toggle.click();await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await header.getByRole('button', {name:/切换到日间模式/}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath(`verified-header-${width}.png`)});
  expect(errors).toEqual([]);
});

test('detail search suggestions stay above the cover and submit to full search', async ({page}) => {
  await page.setViewportSize({width:390, height:844});
  await page.route('**/api/books?*', route => {
    if (!new URL(route.request().url()).searchParams.has('q')) return route.continue();
    return route.fulfill({json:[{id:book, title:'顶部导航搜索测试', author:'导航验收'}]});
  });
  await page.goto(detail);
  const header = page.locator('.book-mobile-header');
  const input = header.getByRole('combobox', {name:'搜索书名或作者'});
  await input.fill('导航');
  const option = header.getByRole('option', {name:'顶部导航搜索测试 导航验收'});
  await expect(option).toBeVisible();
  expect(await option.evaluate(element => {
    const r=element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));
  })).toBe(true);
  await input.press('Escape');await expect(header.getByRole('listbox')).toHaveCount(0);
  await input.press('Enter');await expect(page).toHaveURL(`${base}/search?q=${encodeURIComponent('导航')}`);
  await page.goBack();await expect(page.locator('.book-mobile-header')).toBeVisible();
});

test('detail logo, account entry and catalog work with the new header', async ({page}) => {
  await page.setViewportSize({width:390, height:844});
  await page.goto(detail);
  await page.locator('.mobile-catalog').click();
  await expect(page.getByRole('dialog', {name:'全部目录'})).toBeVisible();
  await page.getByRole('button', {name:'关闭目录'}).click();
  await page.locator('.book-mobile-header').getByRole('link', {name:'九天小说首页'}).click();
  await expect(page).toHaveURL(`${base}/`);
  await expect(page.locator('.mh-topbar:visible')).toHaveCount(1);
  // The shared home link returns to the existing home entry in browser history.
  await page.goForward();await expect(page.locator('.book-mobile-header')).toBeVisible();
  await page.locator('.book-mobile-header').getByRole('link', {name:'个人中心'}).click();
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
});
