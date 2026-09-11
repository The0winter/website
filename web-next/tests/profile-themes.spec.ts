import {test, expect} from '@playwright/test';

test('profile appearance previews, cancels, retries and restores account choice', async ({page}) => {
  const account = {id:'000000000000000000000001',username:'装扮测试',email:'theme@example.test',role:'reader',profileTheme:'apricot'};
  let shouldFail = true, writes = 0;
  await page.route('**/api/auth/session',route=>route.fulfill({json:{user:account,profile:account}}));
  await page.route('**/api/auth/csrf',route=>route.fulfill({json:{csrfToken:'synthetic-csrf'}}));
  await page.route(`**/api/users/${account.id}`, async route => {
    writes++;
    if (shouldFail) return route.fulfill({status:503,json:{error:'暂时无法保存，请重试'}});
    expect(route.request().method()).toBe('PATCH');
    expect(route.request().postDataJSON()).toEqual({profileTheme:'sage'});
    account.profileTheme = 'sage';
    await route.fulfill({json:{success:true,user:account}});
  });
  await page.setViewportSize({width:390,height:844});
  await page.goto('http://127.0.0.1:3000/profile');
  const card=page.locator('.profile-card');
  await expect(card).toHaveAttribute('data-profile-theme','apricot');
  const backdrop = await page.locator('.profile-page').evaluate(el=>getComputedStyle(el).backgroundColor);
  const bottom = await page.locator('.mh-bottom').evaluate(el=>getComputedStyle(el).backgroundColor);
  await page.getByRole('button',{name:'装扮主页'}).click();
  await page.getByRole('radio',{name:/青竹/}).check();
  await expect(card).toHaveAttribute('data-profile-theme','sage');
  await expect(page.locator('.profile-page')).toHaveCSS('background-color',backdrop);
  await expect(page.locator('.mh-bottom')).toHaveCSS('background-color',bottom);
  await page.getByRole('button',{name:'取消',exact:true}).click();
  await expect(card).toHaveAttribute('data-profile-theme','apricot');
  expect(writes).toBe(0);
  await page.getByRole('button',{name:'装扮主页'}).click();
  await page.getByRole('radio',{name:/青竹/}).check();
  await page.getByRole('button',{name:'保存装扮'}).click();
  await expect(page.locator('#profile-appearance').getByRole('alert')).toHaveText('暂时无法保存，请重试');
  shouldFail=false;
  await page.getByRole('button',{name:'保存装扮'}).click();
  await expect(page.getByRole('status')).toHaveText('主页装扮已保存');
  await expect(page.locator('#profile-appearance')).toHaveCount(0);
  await page.reload();
  await expect(card).toHaveAttribute('data-profile-theme','sage');
  await page.getByRole('button',{name:'装扮主页'}).click();
  await page.getByRole('radio',{name:/雾蓝/}).check();
  await page.getByRole('radio',{name:/雾蓝/}).press('Escape');
  await expect(card).toHaveAttribute('data-profile-theme','sage');
  await expect(page.getByRole('button',{name:'装扮主页'})).toBeFocused();
  // Switching accounts must use that account's saved style, not the previous preview.
  account.id='000000000000000000000002'; account.profileTheme='rose';
  await page.reload();
  await expect(card).toHaveAttribute('data-profile-theme','rose');
});
