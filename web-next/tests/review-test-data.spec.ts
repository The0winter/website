import {test,expect} from './fixtures/without-analytics';

const base=process.env.REVIEW_TEST_BASE || 'http://127.0.0.1:3157';
const book=process.env.REVIEW_TEST_BOOK || '000000000000000000000101';
const total=Number(process.env.REVIEW_TEST_TOTAL || 22);
for(const width of [390,1440]) {
  test(`labeled test comments paginate and open a private-safe profile at ${width}px`,async({page},info)=>{
    await page.setViewportSize({width,height:900});
    await page.goto(`${base}/book/${book}`);
    const panel=page.locator('#reviews-panel');
    await expect(panel.locator('.book-review')).toHaveCount(20);
    await expect(panel.locator('.book-review-test-badge')).toHaveCount(20);
    await expect(panel.locator('.book-review-test-notice')).toContainText('不计入本书评分');
    await page.locator('#reviews-section').scrollIntoViewIfNeeded();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:info.outputPath(`verified-comments-${width}.png`)});
    await panel.getByRole('button',{name:'下一页',exact:true}).click();
    await expect(panel.locator('.book-review')).toHaveCount(total-20);
    await expect(panel.locator('.book-review-test-badge')).toHaveCount(1);
    await expect(panel.getByRole('button',{name:'下一页',exact:true})).toBeDisabled();
    await panel.getByRole('button',{name:'上一页',exact:true}).click();
    await expect(panel.locator('.book-review')).toHaveCount(20);
    const link=panel.locator('.book-review-profile-link').first();
    const href=await link.getAttribute('href');
    await link.click();
    await expect(page).toHaveURL(base+href);
    await expect(page.locator('.public-profile-role')).toHaveText('测试账号');
    await expect(page.locator('.public-profile-identity h1')).toContainText('（测试）');
    await expect(page.locator('.public-profile-page')).not.toContainText('邮箱');
    const html=await (await page.request.get(base+href)).text();
    expect(html).not.toContain('@review-test.invalid');
    expect(html).not.toContain('testBatch');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:info.outputPath(`verified-test-profile-${width}.png`),fullPage:true});
    await page.getByRole('button',{name:'返回',exact:true}).click();
    await expect(page).toHaveURL(`${base}/book/${book}`);
  });
}
