import {test, expect} from '@playwright/test';

const base = process.env.DETAIL_BASE || 'http://127.0.0.1:3000';
const book = process.env.DETAIL_BOOK || '000000000000000000000101';
const detail = `${base}/book/${book}`;

test.beforeEach(async ({page}) => {
  await page.setViewportSize({width:390, height:844});
  await page.addInitScript(() => {
    const calls = {copies:[] as string[], shares:[] as ShareData[]};
    Object.assign(window, {shareCalls:calls});
    Object.defineProperty(navigator, 'clipboard', {configurable:true, value:{writeText:async (text:string) => {calls.copies.push(text);}}});
    Object.defineProperty(navigator, 'share', {configurable:true, writable:true, value:async (data:ShareData) => {calls.shares.push(data);}});
    Object.defineProperty(navigator, 'canShare', {configurable:true, value:() => true});
    Object.defineProperty(navigator, 'connection', {value:{saveData:true, addEventListener(){}, removeEventListener(){}}});
  });
  await page.route('**/api/auth/session', route => route.fulfill({json:{user:null, profile:null}}));
  await page.route('**/api/books/*/views', route => route.fulfill({json:{success:true, counted:false}}));
});

for (const width of [320,390,430]) test(`sharing fits and copies the complete book title at ${width}px`, async ({page}, info) => {
  await page.setViewportSize({width,height:844});
  await page.goto(detail);
  const title = (await page.locator('.book-hero h1').innerText()).trim();
  const toggle = page.getByRole('button', {name:'分享书籍'});
  const search = (await page.getByRole('button', {name:'搜索书籍'}).boundingBox())!;
  const share = (await toggle.boundingBox())!;
  expect(share.x - search.x).toBe(44);
  await toggle.click();
  const panel = page.getByRole('dialog', {name:'分享这本书'});
  await expect(panel).toBeVisible();
  await expect(panel).toHaveCSS('transition-duration','0.4s, 0.4s, 0s');
  const content = `《${title}》 - 九天小说站 ${detail}`;
  await expect(page.getByRole('textbox', {name:'书名和分享链接'})).toHaveValue(content);
  await page.getByRole('button', {name:'复制',exact:true}).click();
  await expect(panel.getByRole('status')).toHaveText('书名和链接已复制');
  expect(await page.evaluate(() => (window as unknown as {shareCalls:{copies:string[]}}).shareCalls.copies)).toEqual([content]);
  await page.getByRole('button', {name:'分享到其他应用'}).click();
  expect(await page.evaluate(() => (window as unknown as {shareCalls:{shares:ShareData[]}}).shareCalls.shares)).toEqual([{title:`《${title}》 - 九天小说站`,text:`《${title}》 - 九天小说站`,url:detail}]);
  await expect.poll(() => panel.evaluate(element => Math.round(element.getBoundingClientRect().width))).toBe(Math.min(360,width-24));
  const box = (await panel.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(8);expect(box.x + box.width).toBeLessThanOrEqual(width-8);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  await page.screenshot({path:info.outputPath(`verified-share-${width}.png`)});
  if (width===390) {
    await page.evaluate(() => {document.documentElement.classList.add('dark');document.documentElement.dataset.theme='dark';});
    await page.screenshot({path:info.outputPath('verified-share-dark.png')});
  }
});

test('all dismissal methods consume only the share history entry', async ({page}) => {
  await page.goto(detail);
  const panel = page.getByRole('dialog', {name:'分享这本书'});
  for (const method of ['close','outside','page-back','native-back','escape','toggle']) {
    await page.getByRole('button', {name:'分享书籍'}).click();
    await expect(panel).toBeVisible();
    if (method==='close') await page.getByRole('button', {name:'关闭分享'}).click();
    if (method==='outside') await page.locator('.book-description').click();
    if (method==='page-back') await page.getByRole('link', {name:'返回精选'}).click();
    if (method==='native-back') await page.evaluate(() => history.back());
    if (method==='escape') await page.keyboard.press('Escape');
    if (method==='toggle') await page.getByRole('button', {name:'分享书籍'}).click();
    await expect(panel).not.toBeVisible();await expect(page).toHaveURL(detail);
  }
  await page.goBack();await expect(page).toHaveURL(`${base}/`);
});

test('share history restores and desktop resize removes the mobile overlay', async ({page}) => {
  await page.goto(detail);
  const panel=page.getByRole('dialog', {name:'分享这本书'});
  await page.getByRole('button', {name:'分享书籍'}).click();
  await expect(panel).toBeVisible();await page.goBack();await expect(panel).not.toBeVisible();
  await page.goForward();await expect(panel).toBeVisible();
  await page.reload();await expect(panel).toBeVisible();
  await expect(page.getByRole('textbox', {name:'书名和分享链接'})).toHaveValue(new RegExp(book));
  await page.setViewportSize({width:1440,height:900});
  await expect.poll(() => page.evaluate(() => Boolean(history.state?.bookNavigation?.share))).toBe(false);
  await page.setViewportSize({width:390,height:844});await expect(panel).not.toBeVisible();
  await page.goBack();await expect(page).toHaveURL(`${base}/`);
});

test('unsupported sharing and blocked clipboard keep manual copying available', async ({page}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', {value:undefined});
    Object.defineProperty(navigator, 'clipboard', {value:{writeText:async () => {throw new DOMException('Denied','NotAllowedError');}}});
    document.execCommand=() => false;
  });
  await page.goto(detail);await page.getByRole('button', {name:'分享书籍'}).click();
  await expect(page.getByRole('button', {name:'分享到其他应用'})).toBeDisabled();
  await page.getByRole('button', {name:'复制',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'请长按上方文字'})).toBeVisible();
  const input=page.getByRole('textbox', {name:'书名和分享链接'});
  await expect(input).toBeFocused();
  expect(await input.evaluate(element => {const input=element as HTMLInputElement; return input.selectionStart===0 && input.selectionEnd===input.value.length;})).toBe(true);
});

test('native cancellation stays quiet and share errors retain a copy option', async ({page}) => {
  await page.goto(detail);await page.getByRole('button', {name:'分享书籍'}).click();
  await page.evaluate(() => {navigator.share=async () => {throw new DOMException('Cancel','AbortError');};});
  await page.getByRole('button', {name:'分享到其他应用'}).click();
  const status=page.locator('.book-share-message');await expect(status).toBeEmpty();
  await page.evaluate(() => {navigator.share=async () => {throw new DOMException('Denied','NotAllowedError');};});
  await page.getByRole('button', {name:'分享到其他应用'}).click();
  await expect(status).toContainText('请复制上方书名和链接');
  await page.getByRole('button', {name:'复制',exact:true}).click();
  await expect(status).toHaveText('书名和链接已复制');
});

test('keyboard focus stays in the panel and reduced motion is respected', async ({page}) => {
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto(detail);await page.getByRole('button', {name:'分享书籍'}).click();
  await expect(page.getByRole('button', {name:'关闭分享'})).toBeFocused();
  await expect(page.locator('.book-share-panel')).toHaveCSS('transition-duration','0s');
  await page.keyboard.press('Shift+Tab');await expect(page.getByRole('button', {name:'分享到其他应用'})).toBeFocused();
  await page.keyboard.press('Tab');await expect(page.getByRole('button', {name:'关闭分享'})).toBeFocused();
  await page.keyboard.press('Escape');await expect(page.getByRole('button', {name:'分享书籍'})).toBeFocused();
});

test('rating count excludes baseline samples and sharing does not overlap search', async ({page}) => {
  await page.route('**/api/books/*/reviews?*', route => route.fulfill({json:[],headers:{'X-Total-Count':'2','X-Book-Rating':'4.3','X-Rating-Summary':JSON.stringify({readerCount:12,baselineCount:500})}}));
  await page.goto(detail);await expect(page.locator('.book-mobile-stats dt').last()).toHaveText('12人评分');
  await page.getByRole('button', {name:'搜索书籍'}).click();
  await expect(page.locator('.book-detail-search input')).toBeFocused();
  await page.getByRole('button', {name:'分享书籍'}).click();
  await expect(page.locator('.book-detail-search input')).toHaveCount(0);
  await page.getByRole('button', {name:'分享书籍'}).click();
  await expect(page.getByRole('dialog', {name:'分享这本书'})).toBeVisible();
  await page.getByRole('button', {name:'搜索书籍'}).click();
  await expect(page.getByRole('dialog', {name:'分享这本书'})).not.toBeVisible();
  await page.goBack();await expect(page).toHaveURL(`${base}/`);
});
