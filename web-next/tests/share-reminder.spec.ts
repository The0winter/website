import {test,expect} from './fixtures/without-analytics';
const base=process.env.REVIEW_BASE||'http://127.0.0.1:3157',book=process.env.REVIEW_BOOK||'000000000000000000000101';
for(const width of [320,390])test(`reading for half an hour invites sharing on return at ${width}px`,async({page},info)=>{
  await page.setViewportSize({width,height:844});
  await page.addInitScript(()=>{localStorage.setItem('has-seen-reading-hint','true');});
  await page.route('**/api/books/*/views',r=>r.fulfill({json:{counted:false}}));
  await page.goto(`${base}/book/${book}`);
  await expect(page.locator('.book-share-reminder')).toHaveCount(0);
  await page.getByRole('link',{name:'立即阅读',exact:true}).click();
  await expect(page.locator('.reader-pages-root:visible')).toHaveAttribute('data-reader-ready','true');
  // Advance wall-clock time without speeding up animations or waiting thirty real minutes.
  await page.evaluate(()=>{const now=Date.now;Date.now=()=>now()+30*60*1000+1000;});
  await page.goBack();await expect(page).toHaveURL(`${base}/book/${book}`);
  const bubble=page.locator('.book-share-reminder');await expect(bubble).toBeVisible();
  await expect(bubble).toHaveCSS('opacity','1');
  await expect(bubble).toContainText('喜欢的话，请多多分享');
  const bounds=(await bubble.boundingBox())!;expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(width);
  await page.screenshot({path:info.outputPath(`verified-share-reminder-${width}.png`)});
  await bubble.getByRole('button',{name:/喜欢的话/}).click();await expect(page.getByRole('dialog',{name:'分享这本书'})).toBeVisible();await expect(bubble).toHaveCount(0);
  await page.getByRole('button',{name:'关闭分享',exact:true}).click();
  await page.reload();await expect(bubble).toHaveCount(0);
});
test('short reading and desktop do not show a share invitation',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto(`${base}/book/${book}`);
  await page.getByRole('link',{name:'立即阅读',exact:true}).click();await expect(page.locator('.reader-pages-root:visible')).toHaveAttribute('data-reader-ready','true');
  await page.goBack();await expect(page).toHaveURL(`${base}/book/${book}`);await page.waitForTimeout(1100);await expect(page.locator('.book-share-reminder')).toHaveCount(0);
  await page.setViewportSize({width:1440,height:900});
  await page.evaluate(book=>sessionStorage.setItem('book-share-reading:v1',JSON.stringify({[book]:{ms:1800000,updated:Date.now()}})),book);
  await page.reload();await page.waitForTimeout(1100);await expect(page.locator('.book-share-reminder')).toHaveCount(0);
});
