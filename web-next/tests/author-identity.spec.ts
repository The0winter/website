import {test,expect} from './fixtures/without-analytics';

const base=process.env.IDENTITY_BASE||'http://127.0.0.1:3000';
const author=process.env.IDENTITY_AUTHOR||'000000000000000000000032';
const expected=Number(process.env.IDENTITY_BOOK_COUNT||3);
const taken=process.env.IDENTITY_USERNAME||'隔离作者';

for(const width of [320,390,1440])test(`merged author and reserved username at ${width}px`,async({page},info)=>{
  await page.setViewportSize({width,height:900});
  await page.route('**/api/books/*/views',route=>route.fulfill({json:{success:true,counted:false}}));
  await page.goto(`${base}/author/${author}`);
  await expect(page.locator('.author-profile h1')).not.toBeEmpty();
  await expect(page.locator('.author-book')).toHaveCount(expected);
  await expect(page.locator('.author-section h2, .author-works h2').first()).toContainText(String(expected));
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('verified-author.png'),fullPage:true});
  await page.goto(base+'/register');
  await expect(page.locator('#register-username-hint')).toContainText('永久保留');
  await page.getByLabel('用户名',{exact:true}).fill(taken);
  await page.getByLabel('邮箱地址',{exact:true}).fill('identity-check@example.test');
  await page.getByLabel('邮箱验证码',{exact:true}).fill('123456');
  await page.getByLabel('密码',{exact:true}).fill('Not-a-real-account-123');
  await page.getByLabel('确认密码',{exact:true}).fill('Not-a-real-account-123');
  await page.getByRole('button',{name:'注册账号',exact:true}).click();
  await expect(page.locator('.register-error')).toHaveText('该用户名已被使用，请换一个');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('verified-registration.png'),fullPage:true});
});
