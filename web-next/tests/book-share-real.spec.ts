import {test, expect} from './fixtures/without-analytics';

const base = process.env.DETAIL_BASE || 'http://127.0.0.1:3000';
const book = process.env.DETAIL_BOOK || '000000000000000000000101';
test.use({hasTouch:true});

test('real browser capabilities, copying and mobile layout', async ({page, context, browser}, info) => {
  await page.setViewportSize({width:390,height:844});
  if (info.project.name === 'Chrome' || info.project.name === 'Edge') await context.grantPermissions(['clipboard-read','clipboard-write']);
  await page.route('**/api/auth/session', route => route.fulfill({json:{user:null,profile:null}}));
  await page.route('**/api/books/*/views', route => route.fulfill({json:{success:true,counted:false}}));
  const errors:string[]=[];page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/book/${book}`);
  // Next's streaming response can briefly include a hidden duplicate heading.
  await expect(page.locator('.book-hero h1')).toHaveCount(1);
  const title = (await page.locator('.book-hero h1').innerText()).trim();
  await page.getByRole('button', {name:'分享书籍'}).tap();
  const capabilities = await page.evaluate(() => {
    const data = {title:document.title,text:document.title,url:location.href};
    return {secure:window.isSecureContext,share:typeof navigator.share === 'function',canShare:typeof navigator.canShare === 'function' ? navigator.canShare(data) : null,clipboard:typeof navigator.clipboard?.writeText === 'function'};
  });
  const expected = `《${title}》 - 九天小说站 ${base}/book/${book}`;
  await expect(page.getByRole('textbox', {name:'书名和分享链接'})).toHaveValue(expected);
  await page.getByRole('button', {name:'复制',exact:true}).tap();
  await expect(page.locator('.book-share-message')).toHaveText('书名和链接已复制');
  let clipboardVerified = false;
  if (info.project.name === 'Chrome' || info.project.name === 'Edge') {
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected);
    clipboardVerified = true;
  }
  await expect(page.locator('.book-share-apps')).toBeEnabled();
  await expect(page.locator('.book-share-apps strong')).toHaveText(capabilities.share && capabilities.canShare !== false ? '分享到其他应用' : '复制后分享');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({path:info.outputPath('verified-real-browser.png')});
  await page.getByRole('button', {name:'关闭分享'}).tap();
  await expect(page.getByRole('dialog', {name:'分享这本书'})).not.toBeVisible();
  expect(errors).toEqual([]);
  await info.attach('real-browser-capabilities', {body:JSON.stringify({browser:info.project.name,version:browser.version(),capabilities,clipboardVerified,nativeShareSheetTested:false}),contentType:'application/json'});
});
