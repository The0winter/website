import {test,expect} from './fixtures/without-analytics';

const base=process.env.PROFILE_BASE || 'http://127.0.0.1:3157';
const user='000000000000000000000011';
const book='000000000000000000000101';
for(const width of [390,1440]) {
  test(`public profile opens from a comment and hides private data at ${width}px`,async({page},info)=>{
    await page.setViewportSize({width,height:900});
    await page.goto(`${base}/book/${book}`);
    await page.getByRole('link',{name:'查看山间读者的主页',exact:true}).click();
    await expect(page).toHaveURL(`${base}/user/${user}`);
    await expect(page.getByRole('heading',{name:'山间读者',exact:true})).toBeVisible();
    await expect(page.getByText('加入时间',{exact:true})).toBeVisible();
    await expect(page.locator('[data-testid=public-profile]')).not.toContainText('邮箱');
    expect(await page.content()).not.toContain('never-public@example.test');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:info.outputPath(`verified-profile-${width}.png`),fullPage:true});
    await page.getByRole('button',{name:'返回',exact:true}).click();
    await expect(page).toHaveURL(`${base}/book/${book}`);
    const html=await (await page.request.get(`${base}/user/${user}`)).text();
    expect(html).not.toContain('never-public@example.test');
    expect(html).not.toContain('"email"');
  });
}

test('unknown profile has an honest not-found view',async({page})=>{
  await page.goto(`${base}/user/000000000000000000999999`);
  await expect(page.getByRole('heading',{name:'书友主页暂不可用'})).toBeVisible();
});

test('review editor counts Unicode characters and blocks 141 characters',async({page})=>{
  await page.goto(`${base}/login`);
  await page.getByPlaceholder('请输入用户名').fill('山间读者');
  await page.getByPlaceholder('请输入密码').fill('Local-test-12345');
  await page.getByRole('button',{name:'立即登录',exact:true}).click();
  await expect(page).toHaveURL(base+'/');
  await page.goto(`${base}/book/${book}`);
  await page.getByRole('button',{name:'写书评',exact:true}).click();
  const editor=page.locator('#book-review-content');
  await expect(editor).toBeVisible();
  await editor.fill('阅'.repeat(139)+'😀');
  await expect(page.locator('#book-review-limit')).toHaveText('140/140 字');
  await expect(page.getByRole('button',{name:'发表评论',exact:true})).toBeEnabled();
  await editor.fill('阅'.repeat(140)+'😀');
  await expect(page.locator('#book-review-limit')).toContainText('141/140');
  await expect(page.getByRole('button',{name:'发表评论',exact:true})).toBeDisabled();
  await editor.fill('已精简的测试短评。');
  await page.getByRole('button',{name:'发表评论',exact:true}).click();
  await expect(page.locator('.book-review-content').first()).toHaveText('已精简的测试短评。');
});
