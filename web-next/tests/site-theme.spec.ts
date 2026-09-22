import {test, expect as baseExpect, type Page} from '@playwright/test';

// The same read-only suite runs over an SSH preview and the public CDN.
const expect = baseExpect.configure({timeout:15000});

const base = process.env.THEME_TEST_BASE || 'http://127.0.0.1:3000';
const toggle = (page: Page) => page.locator('.site-theme-toggle:visible').first();

async function prepare(page: Page) {
  await page.addInitScript(() => localStorage.setItem('has-seen-reading-hint','true'));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (/google-analytics|googletagmanager/.test(url.hostname)) return route.abort();
    return route.continue();
  });
  // Synthetic account and shelf: the live acceptance never writes user data.
  const account={id:'000000000000000000000001', username:'主题验收', role:'reader'};
  await page.route('**/api/auth/session', route => route.fulfill({json: {user:account,profile:account}}));
  await page.route('**/api/users/*/library**', route => route.fulfill({json: []}));
  await page.route('**/api/books/*/reviews/mine', route => route.fulfill({json: null}));
}

for (const width of [320, 390, 1440]) {
  test(`system preference and manual theme span the site and reader at ${width}px`, async ({page}, testInfo) => {
    await prepare(page);
    await page.setViewportSize({width,height:844});
    await page.emulateMedia({colorScheme:'light'});
    await page.goto(base);
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
    const lightBackground=await page.locator('main').first().evaluate(el=>getComputedStyle(el).backgroundColor);
    const sun = toggle(page).locator('.site-theme-sun');
    await expect(sun).toBeVisible();
    if (width < 768) {
      const icon = await toggle(page).boundingBox();
      const avatar = await page.locator('.mh-topbar .mobile-account-link:visible').boundingBox();
      expect(icon!.x + icon!.width).toBeLessThanOrEqual(avatar!.x);
      expect(icon!.width).toBeGreaterThanOrEqual(44);
    }
    await page.emulateMedia({colorScheme:'dark'});
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle(page).locator('.site-theme-moon')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'system');
    await toggle(page).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    // Tailwind must honor manual light even while the system is dark.
    await expect(page.locator('main').first()).toHaveCSS('background-color',lightBackground);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.emulateMedia({colorScheme:'light'});
    await toggle(page).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.emulateMedia({colorScheme:'dark'});
    await page.emulateMedia({colorScheme:'light'});
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    if (width >= 768) await expect(page.locator('nav[data-site-chrome]')).toHaveCSS('background-color','rgb(36, 33, 30)');
    await page.screenshot({path:testInfo.outputPath('home-dark.png')});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    const books = await (await page.request.get(base+'/api/books?limit=3')).json();
    const book = books.find((row: {title:string}) => row.title !== '测试');
    const id = book.id || book._id;
    // Use an ordinary internal document link to also test full page navigation.
    await page.evaluate(href => {const a=document.createElement('a');a.href=href;document.body.append(a);a.click();}, '/book/'+id);
    await expect(page.locator('.book-detail')).toBeVisible();
    await expect.poll(() => page.evaluate(() => history.state?.bookNavigation?.bookId)).toBe(id);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    if (width >= 768) {
      await expect(page.locator('.book-hero h1')).toHaveCSS('color','rgb(232, 223, 213)');
      await expect(page.locator('.book-layout > .order-2')).toHaveCSS('background-color','rgb(36, 33, 30)');
    }
    await page.screenshot({path:testInfo.outputPath('detail-dark.png')});
    await page.getByRole('button',{name:width < 768 ? /^目录 / : /^查看完整目录/}).click();
    const catalog=page.getByRole('dialog',{name:'全部目录'});
    await expect(page.locator('.book-catalog-sheet:visible')).toHaveCSS('background-color','rgb(36, 33, 30)');
    await expect(page.locator('.book-catalog-sheet:visible')).toHaveCSS('transform','matrix(1, 0, 0, 1, 0, 0)');
    await expect(catalog.locator('.book-catalog-chapter[href]').first()).toBeVisible();
    await page.screenshot({path:testInfo.outputPath('catalog-dark.png')});
    await catalog.locator('.book-catalog-chapter[href]').first().click();
    const reader=page.locator('.reader-pages-root:visible');
    await expect(reader).toHaveAttribute('data-dark','true');
    await expect(reader).toHaveAttribute('data-reader-ready','true');
    await expect(reader.locator('.reader-page-surface')).toHaveCSS('background-color','rgb(26, 26, 26)');
    await expect(page.locator('.chapter-loading-page')).toHaveCount(0);
    await page.screenshot({path:testInfo.outputPath('reader-dark.png')});
    await page.keyboard.press('m');
    await page.locator('.reader-tools').getByRole('button',{name:'当前夜间模式，切换到日间模式'}).click();
    await expect(reader).toHaveAttribute('data-dark','false');
    await page.goBack();
    await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  });
}

test('a new visit ignores the old permanent setting and resets the manual choice',async ({page,context}) => {
  await prepare(page);
  await page.setViewportSize({width:390,height:844});
  await page.emulateMedia({colorScheme:'light'});
  await page.addInitScript(() => localStorage.setItem('novelhub_theme','"dark"'));
  await page.goto(base);
  await expect(toggle(page)).toHaveAttribute('aria-pressed','false');
  await toggle(page).click();
  await page.goto('about:blank');
  await page.goBack();
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference','system');
  await toggle(page).click();
  await page.close();
  const reopened=await context.newPage();
  await reopened.emulateMedia({colorScheme:'light'});
  await reopened.goto(base);
  await expect(toggle(reopened)).toHaveAttribute('aria-pressed','false');
});

test('storage denied still allows system and manual themes',async ({page}) => {
  await prepare(page);
  await page.emulateMedia({colorScheme:'dark'});
  await page.addInitScript(() => {
    Object.defineProperty(window,'sessionStorage',{get:()=>{throw new DOMException('Blocked','SecurityError');}});
  });
  await page.goto(base);
  await expect(toggle(page)).toHaveAttribute('aria-pressed','true');
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute('aria-pressed','false');
});

test('visiting the shelf preserves manual darkness',async ({page}) => {
  await prepare(page);
  await page.setViewportSize({width:390,height:844});
  await page.emulateMedia({colorScheme:'light'});
  await page.goto(base);
  await toggle(page).click();
  await page.addStyleTag({content:'nextjs-portal {display:none}'});
  await page.locator('.mh-bottom').getByRole('link',{name:'书架',exact:true}).click();
  await expect(page.locator('.library-page')).toBeVisible();
  await expect(toggle(page)).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.shelf-toolbar')).toHaveCSS('background-color','rgb(36, 33, 30)');
  await expect(page.locator('#shelf-content')).toHaveCSS('background-color','rgb(36, 33, 30)');
});

test('a dark reader paints dark before application JavaScript loads',async ({page}) => {
  await prepare(page);
  await page.emulateMedia({colorScheme:'dark'});
  const books=await (await page.request.get(base+'/api/books?limit=3')).json();
  const book=books.find((row:{title:string})=>row.title!=='测试');
  const id=book.id||book._id;
  const [chapter]=await (await page.request.get(`${base}/api/books/${id}/chapters?order=asc&limit=1`)).json();
  await page.route('**/*.js*',route=>route.abort());
  await page.goto(`${base}/book/${id}/${chapter.id}`,{waitUntil:'domcontentloaded'});
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await expect(page.locator('.reader-pages-root')).toHaveAttribute('data-dark','false');
  await expect(page.locator('.reader-page-surface')).toHaveCSS('background-color','rgb(26, 26, 26)');
  await expect(page.locator('.reader-frame')).toHaveCSS('background-image','none');
});
