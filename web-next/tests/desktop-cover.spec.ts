import {test,expect,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';

const base='http://127.0.0.1:3000';
async function write(page:Page,path:string,method:string,data:unknown){
  const csrf=await(await page.request.get(base+'/api/auth/csrf')).json();
  return page.request.fetch(base+path,{method,headers:{origin:base,'x-csrf-token':csrf.csrfToken,'Idempotency-Key':randomUUID()},data});
}
test.beforeEach(async({page})=>{
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  expect((await write(page,'/api/auth/signin','POST',{email:'admin@example.test',password:'Admin-test-12345'})).ok()).toBe(true);
});

test('desktop cover shortcut saves only the cover, previews at full size and refreshes both lists',async({page},info)=>{
  await page.setViewportSize({width:1440,height:1000});
  const title='封面验收'+Date.now();
  const description='需要完整保留的长简介。'.repeat(80);
  const created=await write(page,'/api/books','POST',{title,description});expect(created.ok()).toBe(true);
  const book=await created.json();
  const chapter=await write(page,'/api/chapters','POST',{bookId:book.id,title:'第一章',content:'更换封面不应该改动的章节正文。',chapter_number:1});expect(chapter.ok()).toBe(true);
  const chapters=await(await page.request.get(base+`/api/books/${book.id}/chapters`)).json();
  await page.goto(base+'/writer');
  const card=page.locator('.writer-work').filter({hasText:title});
  await expect(card.getByRole('button',{name:'更换封面',exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath('final-desktop-shortcut.png')});
  await card.getByRole('button',{name:'更换封面',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'更换封面',exact:true});
  await expect(dialog.locator('form')).toHaveAttribute('data-busy','false');
  await expect(dialog.getByLabel('书名',{exact:true})).toHaveCount(0);
  expect((await dialog.locator('.work-create-cover-preview').boundingBox())!.width).toBeGreaterThanOrEqual(200);
  const icon=await page.request.get(base+'/icon.png');expect(icon.ok()).toBe(true);
  await dialog.getByLabel('选择新封面',{exact:true}).setInputFiles({name:'cover.png',mimeType:'image/png',buffer:await icon.body()});
  await expect(dialog.getByRole('img',{name:'作品封面预览'})).toBeVisible();
  await expect.poll(()=>dialog.getByRole('img',{name:'作品封面预览'}).evaluate((img:HTMLImageElement)=>img.naturalWidth)).toBeGreaterThan(0);
  await dialog.getByRole('img',{name:'作品封面预览'}).evaluate((img:HTMLImageElement)=>img.decode());
  await page.screenshot({path:info.outputPath('final-desktop-cover-editor.png')});
  const patch=page.waitForRequest(request=>request.method()==='PATCH'&&request.url().endsWith('/api/books/'+book.id));
  await dialog.getByRole('button',{name:'保存封面',exact:true}).click();
  const body=(await patch).postDataJSON();expect(Object.keys(body)).toEqual(['cover_image']);
  await expect(dialog).toHaveCount(0);
  await expect(card.locator('.writer-work-cover img')).toBeVisible();
  const after=await(await page.request.get(base+'/api/books/'+book.id)).json();
  expect(after.description).toBe(description);expect(after.title).toBe(title);expect(after.cover_image).toBeTruthy();
  expect(await(await page.request.get(base+`/api/books/${book.id}/chapters`)).json()).toEqual(chapters);
  await page.getByRole('button',{name:'书籍总编辑',exact:true}).click();
  await page.getByPlaceholder('搜索书名或作者...').fill(title);
  const result=page.locator('div.group.items-start').filter({hasText:title}).last();
  await result.getByRole('button',{name:'更换封面',exact:true}).click();
  await expect(dialog.locator('form')).toHaveAttribute('data-busy','false');
  await dialog.getByRole('button',{name:'移除封面',exact:true}).click();
  await dialog.getByRole('button',{name:'保存封面',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await expect(result.locator('img')).toHaveCount(0);
  expect((await(await page.request.get(base+'/api/books/'+book.id)).json()).cover_image).toBe('');
});

test('mobile keeps its compact editing entry; desktop cover cancellation keeps the saved image',async({page},info)=>{
  const title='取消封面'+Date.now();
  const created=await write(page,'/api/books','POST',{title,description:'保留原资料。'});expect(created.ok()).toBe(true);
  const book=await created.json();
  await page.setViewportSize({width:390,height:844});await page.goto(base+'/writer');
  const card=page.locator('.writer-work').filter({hasText:title});
  await expect(card.getByRole('button',{name:'更换封面',exact:true})).not.toBeVisible();
  await card.getByLabel(`管理《${title}》`).click();await card.getByRole('button',{name:'编辑作品',exact:true}).click();
  const editor=page.getByRole('dialog',{name:'编辑作品',exact:true});
  await expect(editor.getByLabel('书名',{exact:true})).toHaveValue(title);
  await editor.getByRole('button',{name:'关闭编辑作品'}).click();await expect(editor).toHaveCount(0);
  await page.setViewportSize({width:1024,height:900});
  await card.getByRole('button',{name:'更换封面',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'更换封面',exact:true});
  await expect(dialog.locator('form')).toHaveAttribute('data-busy','false');
  const icon=await page.request.get(base+'/icon.png');
  await dialog.getByLabel('选择新封面',{exact:true}).setInputFiles({name:'cover.png',mimeType:'image/png',buffer:await icon.body()});
  let writes=0;page.on('request',request=>{if(request.method()==='PATCH'||request.url().includes('/api/upload/cover'))writes++;});
  page.once('dialog',d=>d.dismiss());await dialog.getByRole('button',{name:'取消',exact:true}).click();await expect(dialog).toBeVisible();
  page.once('dialog',d=>d.accept());await dialog.getByRole('button',{name:'取消',exact:true}).click();await expect(dialog).toHaveCount(0);
  expect(writes).toBe(0);expect((await(await page.request.get(base+'/api/books/'+book.id)).json()).cover_image).toBe('');
  await page.screenshot({path:info.outputPath('final-desktop-1024.png')});
  await page.setViewportSize({width:768,height:900});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const bounds=await card.getByRole('button',{name:'创作',exact:true}).boundingBox();expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(768);
});
