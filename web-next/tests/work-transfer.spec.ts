import {test,expect} from './fixtures/without-analytics';
const base=process.env.TRANSFER_BASE_URL||'http://127.0.0.1:3198';
async function login(page:import('@playwright/test').Page,name='reader'){
  const csrf=await (await page.request.get(base+'/api/auth/csrf')).json();
  const response=await page.request.post(base+'/api/auth/signin',{headers:{origin:base,'x-csrf-token':csrf.csrfToken},data:{email:`${name}@transfer.test`,password:'Transfer-test-123'}});
  expect(response.ok()).toBeTruthy();
}
for(const width of [320,390,1440])test(`transfer submission and cover statistics at ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:844});await login(page);
  if(width<768){
    await page.goto(base);await page.getByRole('button',{name:'创作',exact:true}).click();
    const center=page.getByRole('dialog',{name:'创作中心',exact:true});
    await expect(center.getByRole('link',{name:/作品搬运/})).toBeVisible();await expect(center.getByRole('link',{name:/作品数据/})).toHaveCount(0);
    await center.getByRole('button',{name:'查看《山林来信》数据'}).click();
    await expect(page.locator('.ws-intro')).toHaveText('山林来信');await expect(page.locator('.ws-cards').first()).toContainText('42');
    await page.getByRole('button',{name:'返回创作中心',exact:true}).click();await expect(page.locator('.mw-view')).toHaveCount(0);
    await center.getByRole('link',{name:/作品搬运/}).click();
  }else await page.goto(base+'/writer?action=transfer');
  const panel=page.getByRole('region',{name:'作品搬运',exact:true});
  await expect(panel.getByLabel('原作者',{exact:true})).toBeVisible();
  await panel.getByLabel('原作者',{exact:true}).fill('原作者');await panel.getByLabel('书名',{exact:true}).fill(`山海之间${width}`);
  await panel.getByLabel('作品文件',{exact:true}).setInputFiles({name:'book.exe',mimeType:'application/octet-stream',buffer:Buffer.from('not text')});
  await expect(panel.getByRole('alert')).toContainText('TXT');await expect(panel.getByRole('button',{name:'提交审核',exact:true})).toBeDisabled();
  await panel.getByLabel('作品文件',{exact:true}).setInputFiles({name:'山海之间.txt',mimeType:'text/plain',buffer:Buffer.from('第一章 风起\n第一章的正文。\n第二章 林间\n<script>window.pwned=true</script>')});
  await page.screenshot({path:info.outputPath('final-form.png'),fullPage:true});
  expect(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await panel.getByRole('button',{name:'提交审核',exact:true}).click();
  await expect(panel.locator('.wt-notice')).toContainText('提交成功');
  await expect(panel.locator('.wt-records').getByRole('heading',{name:`山海之间${width}`,exact:true})).toBeVisible();
  await expect(panel.locator('.wt-records')).toContainText('待审核');
  await page.screenshot({path:info.outputPath('final-submitted.png'),fullPage:true});
});
test('admin previews literal text and reviews a submission',async({page},info)=>{
  await login(page,'admin');await page.setViewportSize({width:390,height:844});await page.goto(base+'/writer?action=transfer');
  await page.getByRole('tab',{name:'搬运审核',exact:true}).click();await page.getByRole('button',{name:'查看投稿',exact:true}).first().click();
  await expect(page.locator('.wt-preview pre')).toContainText('<script>');expect(await page.evaluate(()=>Object.hasOwn(window,'pwned'))).toBe(false);
  await page.screenshot({path:info.outputPath('final-review.png'),fullPage:true});
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'审核通过并收录',exact:true}).click();await expect(page.locator('.wt-notice')).toContainText('作品已完整收录');
});
