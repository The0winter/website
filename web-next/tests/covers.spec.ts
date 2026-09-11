import {test,expect} from '@playwright/test';
import sharp from '../../server/node_modules/sharp';
const base=process.env.COVER_TEST_BASE_URL||'http://127.0.0.1:3000';
if(!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base))throw Error('Cover tests require a local synthetic database');

test('create, replace, failed replacement and removal preserve the correct cover',async({page})=>{
 const file={name:'cover.png',mimeType:'image/png',buffer:await sharp({create:{width:480,height:640,channels:3,background:'#87956c'}}).png().toBuffer()};
 const title=`封面回归 ${Date.now()}`;
 page.on('dialog',dialog=>dialog.accept());
 await page.goto(base+'/login');
 await page.getByPlaceholder('请输入用户名').fill('隔离作者');
 await page.getByPlaceholder('请输入密码').fill('Local-test-12345');
 await page.getByRole('button',{name:'立即登录'}).click();await expect(page).toHaveURL(base+'/');
 await page.goto(base+'/writer');await page.getByRole('button',{name:/创建新书|新建/}).click();
 await page.getByPlaceholder('请输入书名').fill(title);
 async function crop(label:string){
  await page.getByLabel(label).setInputFiles(file);
  await expect(page.getByRole('heading',{name:'调整封面 (3:4)'})).toBeVisible();
  await page.waitForFunction(()=>{const image=document.querySelector<HTMLImageElement>('.reactEasyCrop_Image');return image?.complete&&image.naturalWidth>0;});
  await page.getByRole('button',{name:'确定',exact:true}).click();
 }
 await crop('上传新书封面');await expect(page.getByText('裁剪并上传成功',{exact:true})).toBeVisible({timeout:60000});
 const created=page.waitForResponse(r=>r.url().endsWith('/api/books')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'立即创建'}).click();const response=await created;expect(response.status()).toBe(201);const book=await response.json();expect(book.cover_image).toBeTruthy();
 await page.goto(base+'/book/'+book.id);
 await page.waitForFunction(url=>[...document.images].some(i=>i.src===new URL(url,location.origin).href&&i.complete&&i.naturalWidth>0),book.cover_image);
 await page.goto(base+'/writer');
 await page.locator('div.group.items-start').filter({has:page.getByRole('heading',{name:title,exact:true})}).getByRole('button',{name:'管理',exact:true}).click();
 await page.locator('details').first().locator('summary').click();
 await crop('更换书籍封面');await expect(page.getByText('封面已更新并自动保存',{exact:true})).toBeVisible({timeout:60000});
 const saved=await (await page.request.get(base+'/api/books/'+book.id)).json();expect(saved.cover_image).not.toBe(book.cover_image);
 await page.route('**/api/upload/cover?purpose=book',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'封面存储暂不可用，请稍后重试'})}));
 await crop('更换书籍封面');await expect(page.getByText('封面存储暂不可用，请稍后重试',{exact:true})).toBeVisible();
 expect((await (await page.request.get(base+'/api/books/'+book.id)).json()).cover_image).toBe(saved.cover_image);
 await page.getByRole('button',{name:'取消',exact:true}).click();
 await page.getByTitle('移除封面').click();await expect(page.getByText('封面已移除',{exact:true})).toBeVisible();
 expect((await (await page.request.get(base+'/api/books/'+book.id)).json()).cover_image).toBe('');
});
