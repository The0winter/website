import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const base='http://127.0.0.1:3000';
test('captured verification mail completes browser registration and administrator ban/unban',async({page,browser})=>{
  await page.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
  const unique=Date.now(),username=`注册回归${unique}`,email=`signup-${unique}@example.test`;
  await page.goto(base+'/register');
  await page.getByPlaceholder('用户名',{exact:true}).fill(username);
  await page.getByPlaceholder('邮箱地址',{exact:true}).fill(email);
  await page.getByRole('button',{name:/获取验证码|发送验证码/}).click();
  let code='';
  await expect.poll(async()=>{const messages: {email:string;code:string}[]=JSON.parse(await fs.readFile(path.resolve('../.runtime/development-mail.json'),'utf8'));code=messages.find(message=>message.email===email)?.code||'';return code.length;}).toBe(6);
  await page.getByPlaceholder('邮箱验证码',{exact:true}).fill(code);
  await page.getByPlaceholder('密码',{exact:true}).fill('Signup-test-12345');
  await page.getByPlaceholder('确认密码',{exact:true}).fill('Signup-test-12345');
  await page.getByRole('button',{name:'注册',exact:true}).click();
  await expect(page).toHaveURL(base+'/');
  await page.reload();
  expect((await page.request.get(base+'/api/auth/session')).status()).toBe(200);
  const admin=await browser.newPage();
  await admin.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
  admin.on('dialog',dialog=>dialog.accept());
  try{
    await admin.goto(base+'/login');await admin.getByPlaceholder('请输入用户名').fill('隔离管理员');await admin.getByPlaceholder('请输入密码').fill('Admin-test-12345');await admin.getByRole('button',{name:'立即登录',exact:true}).click();await expect(admin).toHaveURL(base+'/');
    await admin.goto(base+'/writer');await admin.getByRole('button',{name:'超级控制台',exact:true}).click();
    await admin.getByPlaceholder('搜索用户名或邮箱...').fill(email);
    const row=admin.getByRole('row').filter({hasText:email});
    await row.getByRole('button',{name:'封号',exact:true}).click();
    await expect(row.getByText('已封禁',{exact:true})).toBeVisible();
    expect((await page.request.get(base+'/api/auth/session')).status()).toBe(401);
    await row.getByRole('button',{name:'解封',exact:true}).click();
    await expect(row.getByText('正常',{exact:true})).toBeVisible();
    expect((await page.request.get(base+'/api/auth/session')).status()).toBe(401);
    await page.goto(base+'/login');await page.getByPlaceholder('请输入用户名').fill(username);await page.getByPlaceholder('请输入密码').fill('Signup-test-12345');await page.getByRole('button',{name:'立即登录',exact:true}).click();await expect(page).toHaveURL(base+'/');
  }finally{await admin.close();}
});
