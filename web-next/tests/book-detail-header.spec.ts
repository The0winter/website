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
    const nav = (await actions.boundingBox())!, cover = (await page.locator('.book-hero-cover').boundingBox())!;
    expect(nav.x).toBeGreaterThanOrEqual(8);expect(nav.y).toBeGreaterThanOrEqual(8);
    expect(nav.x + nav.width).toBeLessThan(width / 2);
    expect(nav.y + nav.height).toBeLessThanOrEqual(cover.y);
    const search = page.locator('.book-detail-search');
    await expect(search.getByRole('searchbox', {name:'搜索书名或作者'})).toBeVisible();
    await expect(search).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    const searchBox = (await search.boundingBox())!;
    expect(Math.abs(searchBox.x + searchBox.width / 2 - width / 2)).toBeLessThan(1);
    expect(searchBox.x).toBeGreaterThan(nav.x + nav.width);
    expect(searchBox.y + searchBox.height).toBeLessThan(cover.y);
    for (const name of ['返回精选', '精选主页']) {
      const link = actions.getByRole('link', {name});
      await expect(link).toHaveAttribute('href', '/');
      const box = (await link.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(36);expect(box.height).toBeGreaterThanOrEqual(44);
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
    await expect(actions).toHaveCSS('color', 'rgba(255, 250, 240, 0.6)');
    await page.screenshot({path:info.outputPath('verified-icons-dark.png')});
  }
  expect(errors).toEqual([]);
});

for (const method of ['Enter', 'button']) test(`detail search submits with ${method}`, async ({page}) => {
  await page.setViewportSize({width:method === 'Enter' ? 320 : 390, height:844});
  await page.route('**/api/books?*', route => {
    if (!new URL(route.request().url()).searchParams.has('q')) return route.continue();
    return route.fulfill({json:[]});
  });
  await page.goto(detail);
  const search = page.locator('.book-detail-search'), input = search.getByRole('searchbox');
  await input.fill(' 夜无疆 & 辰东 ');
  if (method === 'Enter') await input.press('Enter');
  else await search.getByRole('button', {name:'搜索', exact:true}).click();
  await expect(page).toHaveURL(`${base}/search?${new URLSearchParams({q:'夜无疆 & 辰东'})}`);
  await expect(page.getByRole('searchbox', {name:'搜索书名或作者'})).toHaveValue('夜无疆 & 辰东');
  await page.goBack();
  await expect(page.locator('.book-detail')).toBeVisible({timeout:15000});
  await input.fill('');
  await search.getByRole('button', {name:'搜索', exact:true}).click();
  await expect(page).toHaveURL(`${base}/search`);
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
    await page.locator(source.startsWith('/search') ? '.search-book' : '.mh-browse .mh-book').first().click();
    await expect(page.locator('.book-detail')).toBeVisible({timeout:15000});
    await page.getByRole('navigation', {name:'详情页导航'}).getByRole('link', {name}).click();
    await expect(page).toHaveURL(`${base}/`);
    await expect(page.locator('.mh-bottom a[data-section="home"]')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.mh-topbar:visible')).toHaveCount(1);
    await expect(page.locator('.book-detail:visible')).toHaveCount(0);
  });
}
