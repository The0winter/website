import {test,expect,type Page} from '@playwright/test';
const base='http://127.0.0.1:3000';
async function login(page:Page,password:string){
  await page.goto(base+'/login');
  await page.getByPlaceholder('请输入用户名').fill('隔离作者');
  await page.getByPlaceholder('请输入密码').fill(password);
  await page.getByRole('button',{name:'立即登录',exact:true}).click();
  await expect(page).toHaveURL(base+'/');
}
async function passwordChange(page:Page,previous:string,next:string){
  await page.goto(base+'/profile');
  await page.getByText('登录密码',{exact:true}).click();
  await page.getByPlaceholder('输入当前密码').fill(previous);
  await page.getByPlaceholder('设置新密码（至少8位）').fill(next);
  await page.getByPlaceholder('再次输入新密码').fill(next);
  await page.getByRole('button',{name:'确认修改',exact:true}).click();
  await expect(page).toHaveURL(base+'/login');
}
test('avatar roundtrip and password changes revoke previous browser sessions',async({page,context})=>{
  await page.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
  await login(page,'Local-test-12345');
  await page.goto(base+'/profile');
  const png=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=8;canvas.height=8;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#4488ff';ctx.fillRect(0,0,8,8);return canvas.toDataURL('image/png').split(',')[1];});
  await page.locator('input[type=file]').setInputFiles({name:'synthetic-avatar.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await expect(page.getByText('头像更新成功！',{exact:true})).toBeVisible();
  await page.reload();
  const avatar=page.getByRole('img',{name:'Avatar',exact:true});
  await expect(avatar).toHaveAttribute('src',/^\/api\/media\/[a-f0-9]{24}$/);
  await expect.poll(()=>avatar.evaluate(image=>(image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const oldSession=(await context.cookies()).find(cookie=>cookie.name==='session')!.value;
  await passwordChange(page,'Local-test-12345','Changed-test-67890');
  expect((await page.request.get(base+'/api/auth/session',{headers:{cookie:'session='+oldSession}})).status()).toBe(401);
  await login(page,'Changed-test-67890');
  await passwordChange(page,'Changed-test-67890','Local-test-12345');
  await login(page,'Local-test-12345');
});
