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

for (const width of [320, 390, 430, 1440]) test(`detail navigation fits at ${width}px`, async ({page}, info) => {
  await page.setViewportSize({width, height:844});
  const errors:string[]=[];page.on('pageerror', error => errors.push(error.message));
  await page.goto(detail);
  const actions = page.getByRole('navigation', {name:'详情页导航'});
  await expect(page.locator('.book-mobile-header')).toHaveCount(0);
  if (width < 768) {
    await expect(page.getByRole('combobox', {name:'搜索书名或作者'})).toHaveCount(0);
    await expect(page.locator('nav[data-site-chrome]')).not.toBeVisible();
    await expect(actions).toBeVisible();
    await expect(actions.getByRole('link')).toHaveCount(2);
    const logo = actions.getByRole('img', {name:'九天小说'});
    await expect(logo).toBeVisible();
    await expect.poll(() => logo.evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
    const nav = (await actions.boundingBox())!, cover = (await page.locator('.book-hero-cover').boundingBox())!;
    expect(nav.x).toBeGreaterThanOrEqual(0);expect(nav.y).toBeGreaterThanOrEqual(8);
    expect(nav.x + nav.width).toBeLessThanOrEqual(width);
    expect(nav.y + nav.height).toBeLessThanOrEqual(cover.y);
    await expect(actions.getByRole('button', {name:'搜索书籍'})).toBeVisible();
    await expect(page.getByRole('searchbox')).toHaveCount(0);
    for (const name of ['返回精选', '精选主页']) {
      const link = actions.getByRole('link', {name});
      await expect(link).toHaveAttribute('href', '/');
      const box = (await link.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);
      await link.focus();await expect(link).toBeFocused();
    }
    await page.locator('.mobile-catalog').click();
    await expect(page.getByRole('dialog', {name:'全部目录'})).toBeVisible();
    await page.getByRole('button', {name:'关闭目录'}).click();
    await expect(page.locator('.book-catalog-overlay')).toHaveCSS('visibility', 'hidden');
  } else {
    await expect(actions).not.toBeVisible();
    await expect(page.locator('nav[data-site-chrome]')).toBeVisible();
    await expect(page.getByRole('combobox', {name:'搜索书名或作者'})).toHaveCount(1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath(`verified-icons-${width}.png`)});
  if (width === 390) {
    await page.evaluate(() => {document.documentElement.classList.add('dark');document.documentElement.dataset.theme='dark';});
    await expect(actions).toHaveCSS('color', 'rgb(255, 250, 240)');
    await page.screenshot({path:info.outputPath('verified-icons-dark.png')});
  }
  expect(errors).toEqual([]);
});

for (const width of [320, 390, 430]) test(`detail search expands, dismisses and submits at ${width}px`, async ({page}, info) => {
  await page.setViewportSize({width, height:844});
  await page.route('**/api/books?*', route => {
    if (!new URL(route.request().url()).searchParams.has('q')) return route.continue();
    return route.fulfill({json:[{id:book, title:'导航测试', author:'导航验收'}]});
  });
  await page.goto(detail);
  const actions = page.getByRole('navigation', {name:'详情页导航'});
  const toggle = actions.getByRole('button', {name:'搜索书籍'});
  const input = actions.getByRole('combobox', {name:'搜索书名或作者'});
  const logo = (await actions.locator('.book-home-logo').boundingBox())!;
  const arrow = (await actions.locator('.book-home-back svg path').boundingBox())!;
  expect(Math.abs(arrow.y - logo.y)).toBeLessThanOrEqual(2);
  expect(Math.abs(arrow.y + arrow.height - logo.y - logo.height)).toBeLessThanOrEqual(2);
  const icon = (await toggle.locator('svg').boundingBox())!;
  expect(Math.abs(icon.y + icon.height / 2 - logo.y - logo.height / 2)).toBeLessThan(1);
  expect(width - icon.x - icon.width).toBeLessThanOrEqual(16);
  for (const dismiss of ['outside', 'page-back', 'native-back', 'escape', 'toggle']) {
    await toggle.click();
    await expect(input).toBeFocused();
    await input.fill('导航');
    const option = page.getByRole('option', {name:'导航测试 导航验收'});
    await expect(option).toBeVisible();
    const field = (await input.boundingBox())!;
    expect(field.width).toBeGreaterThan(90);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (dismiss === 'outside') {
      await page.screenshot({path:info.outputPath(`verified-search-${width}.png`)});
      await page.locator('.book-description').click();
    }
    if (dismiss === 'page-back') await actions.getByRole('link', {name:'返回精选'}).click();
    if (dismiss === 'native-back') await page.evaluate(() => history.back());
    if (dismiss === 'escape') await input.press('Escape');
    if (dismiss === 'toggle') await actions.getByRole('button', {name:'收起搜索'}).click();
    await expect(input).toHaveCount(0);
    await expect(page).toHaveURL(detail);
    await expect(toggle).toBeVisible();
  }
  // Repeated open/close must not accumulate extra Back steps.
  await toggle.click();
  await input.fill('导航');
  await input.press('Enter');
  await expect(page).toHaveURL(`${base}/search?q=${encodeURIComponent('导航')}`);
  await page.goBack();
  await expect(page).toHaveURL(detail);
  await expect(input).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(`${base}/`);
});

test('detail search suggestions consume their overlay before opening a book', async ({page}) => {
  await page.setViewportSize({width:390, height:844});
  await page.route('**/api/books?*', route => {
    if (!new URL(route.request().url()).searchParams.has('q')) return route.continue();
    return route.fulfill({json:[{id:book, title:'导航测试', author:'导航验收'}]});
  });
  await page.goto(detail);
  await page.getByRole('button', {name:'搜索书籍'}).click();
  await page.getByRole('combobox', {name:'搜索书名或作者'}).fill('导航');
  await page.getByRole('option', {name:'导航测试 导航验收'}).click();
  await expect(page.getByRole('button', {name:'搜索书籍'})).toBeVisible();
  await expect(page.getByRole('combobox', {name:'搜索书名或作者'})).toHaveCount(0);
  await page.locator('.mobile-catalog').click();
  await expect(page.getByRole('dialog', {name:'全部目录'})).toBeVisible();
  await page.evaluate(() => history.back());
  await expect(page.getByRole('dialog', {name:'全部目录'})).not.toBeVisible();
  await expect(page).toHaveURL(detail);
});

test('detail search survives Forward and reload, and closes when switching to desktop', async ({page}) => {
  await page.setViewportSize({width:390, height:844});
  await page.goto(detail);
  const input = page.locator('.book-detail-search input');
  await page.getByRole('button', {name:'搜索书籍'}).click();
  await expect(input).toBeFocused();
  await page.evaluate(() => history.back());
  await expect(input).toHaveCount(0);
  await page.evaluate(() => history.forward());
  await expect(input).toBeFocused();
  await page.reload();
  await expect(input).toBeVisible();
  await page.setViewportSize({width:1440, height:900});
  await expect(input).toHaveCount(0);
  await page.setViewportSize({width:390, height:844});
  await expect(page.getByRole('button', {name:'搜索书籍'})).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(`${base}/`);
});

// Both icons must select Featured even when the previous page was another list.
for (const source of ['/?view=category', '/search?q=导航']) for (const name of ['返回精选', '精选主页']) {
  test(`${name} selects Featured after opening a book from ${source}`, async ({page}) => {
    await page.setViewportSize({width:390, height:844});
    await page.route('**/api/books?*', route => {
      if (!new URL(route.request().url()).searchParams.has('q')) return route.continue();
      return route.fulfill({json:[{id:book, title:'导航测试', author:'导航验收'}]});
    });
    await page.goto(base + source);
    await expect.poll(() => page.evaluate(() => Boolean(history.state?.mobileRoot))).toBe(true);
    await page.locator(source.startsWith('/search') ? '.search-book' : '.mh-browse .mh-book').first().click();
    await expect(page.locator('.book-detail')).toBeVisible({timeout:15000});
    await page.getByRole('navigation', {name:'详情页导航'}).getByRole('link', {name}).click();
    await expect(page).toHaveURL(`${base}/`);
    await expect(page.locator('.mh-bottom a[data-section="home"]')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.mh-topbar:visible')).toHaveCount(1);
    await expect(page.locator('.book-detail:visible')).toHaveCount(0);
  });
}
